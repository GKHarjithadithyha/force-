import { describe, expect, it } from 'vitest';
import { SequenceTracker } from '../src/index.js';
import { T0, feedRows, makePipeline, packet, profile } from './helpers.js';

describe('sequence classification', () => {
  it('first, then in order, with wrap', () => {
    const s = new SequenceTracker();
    expect(s.classify(65534, 100).kind).toBe('first');
    expect(s.classify(65535, 150)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 50 });
    expect(s.classify(0, 200)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 50 });
    expect(s.classify(1, 250)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 50 });
  });

  it('counts missing packets', () => {
    const s = new SequenceTracker();
    s.classify(10, 0);
    expect(s.classify(14, 200)).toEqual({ kind: 'ok', lostBefore: 3, dtMs: 200 });
  });

  it('drops duplicates and late packets without moving the baseline', () => {
    const s = new SequenceTracker();
    s.classify(10, 1000);
    s.classify(11, 1050);
    s.classify(13, 1150); // 12 missing
    expect(s.classify(13, 1150).kind).toBe('duplicate');
    expect(s.classify(12, 1100).kind).toBe('late'); // reordered
    expect(s.classify(14, 1200)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 50 });
  });

  it('device time going backwards is a restart', () => {
    const s = new SequenceTracker();
    s.classify(500, 100_000);
    s.classify(501, 100_050);
    expect(s.classify(0, 40).kind).toBe('restart');
    expect(s.classify(1, 90)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 50 });
  });

  it('a restart within seconds of the previous boot is not mistaken for a late packet', () => {
    const s = new SequenceTracker();
    s.classify(3, 3000);
    s.classify(4, 3050);
    s.classify(5, 3100);
    expect(s.classify(0, 100).kind).toBe('restart'); // seq 5 steps back, time 3 s back
  });

  it('a restart after 5 s of uptime (100 packets) is a restart, not 100 late packets', () => {
    const s = new SequenceTracker();
    s.classify(99, 4950);
    s.classify(100, 5000);
    expect(s.classify(0, 0).kind).toBe('restart');
  });

  it('seq reset with time moving forward is also a restart', () => {
    const s = new SequenceTracker();
    s.classify(30000, 1_000_000);
    expect(s.classify(2, 1_000_050).kind).toBe('restart');
  });

  it('device time wrap is not a restart', () => {
    const s = new SequenceTracker();
    s.classify(1, 4294967290);
    expect(s.classify(2, 40)).toEqual({ kind: 'ok', lostBefore: 0, dtMs: 46 });
  });
});

describe('fault cases through the pipeline (Architecture section 12)', () => {
  it('malformed packets are counted and dropped, and never reach the calculation', () => {
    const { pipe, got } = makePipeline();
    expect(pipe.pushPacket(new Uint8Array(14), T0)).toBe('malformed'); // before any session
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    expect(pipe.pushPacket(new Uint8Array(3), T0 + 10)).toBe('malformed');
    const bad = packet(1, 50, 5000, 200);
    new DataView(bad.buffer).setUint16(6, 50_000, true);
    expect(pipe.pushPacket(bad, T0 + 50)).toBe('malformed'); // voltage out of range
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    const q = pipe.snapshot({ nowMs: T0, connection: 'streaming' }).quality;
    expect(q.detail.malformedPackets).toBe(3);
    expect(q.droppedPackets).toBe(3);
    expect(got.raws).toHaveLength(2); // only valid samples are logged
  });

  it('duplicates and late packets are dropped, counted, and not stored', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    pipe.pushPacket(packet(3, 150, 5000, 200), T0 + 150);
    expect(pipe.pushPacket(packet(3, 150, 5000, 200), T0 + 151)).toBe('duplicate');
    expect(pipe.pushPacket(packet(2, 100, 5000, 200), T0 + 152)).toBe('late');
    const s = pipe.snapshot({ nowMs: T0, connection: 'streaming' });
    expect(s.quality.detail.duplicatePackets).toBe(1);
    expect(s.quality.detail.latePackets).toBe(1);
    expect(s.quality.droppedPackets).toBe(2);
    expect(got.raws).toHaveLength(3);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(0.15, 12); // 1 W x 150 ms, unaffected
  });

  it('a device restart closes the session, opens a new one, records the gap and names both', () => {
    const { pipe, got } = makePipeline();
    feedRows(pipe, [
      [100_000, 5000, 200],
      [100_050, 5000, 200],
      [100_100, 5000, 200],
    ]);
    const first = pipe.sessionId;
    const result = pipe.pushPacket(packet(0, 20, 5000, 200), T0 + 5000);
    expect(result).toBe('restart');
    expect(got.closed).toHaveLength(1);
    expect(got.closed[0]!.id).toBe(first);
    expect(got.opened).toHaveLength(2);
    expect(pipe.sessionId).not.toBe(first);
    expect(got.gaps).toEqual([{ startMs: T0 + 100, endMs: T0 + 5000, cause: 'device_restart' }]);
    const s = pipe.snapshot({ nowMs: T0 + 5000, connection: 'streaming' });
    const note = s.alerts.find((a) => a.kind === 'device_restart');
    expect(note?.message).toContain(first as string);
    expect(note?.message).toContain(pipe.sessionId as string);
    // the new session starts clean, the old one's energy moves into the all-time total (M6)
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.metrics.totalEnergyWh).toBeCloseTo(0.1 / 3600, 12);
  });

  it('a stale stream followed by resume leaves the session open and reports the gap', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.notifyStale();
    pipe.pushPacket(packet(60, 3000, 5000, 200), T0 + 3000);
    expect(got.closed).toHaveLength(0);
    expect(got.gaps).toEqual([{ startMs: T0, endMs: T0 + 3000, cause: 'stale' }]);
  });

  it('sensor fault flag: no measurement is used, the interval is excluded, an alert is raised', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    pipe.pushPacket(packet(2, 100, 0, 0, 0x01), T0 + 100);
    const mid = pipe.snapshot({ nowMs: T0 + 100, connection: 'streaming' });
    expect(mid.alerts.some((a) => a.kind === 'sensor_fault')).toBe(true);
    expect(mid.metrics.voltageV).toBe(5); // last real value is not replaced by the fault zeros
    pipe.pushPacket(packet(3, 150, 5000, 200), T0 + 150);
    const s = pipe.snapshot({ nowMs: T0 + 150, connection: 'streaming' });
    expect(s.alerts.some((a) => a.kind === 'sensor_fault')).toBe(false);
    expect(s.quality.recordedMs).toBe(50); // only 0 -> 50 counted
    expect(s.quality.excludedGapMs).toBe(100); // 50 -> 150 spans the fault
    expect(got.gaps).toEqual([{ startMs: T0 + 50, endMs: T0 + 150, cause: 'stale' }]);
  });

  it('sensor limit (M19): from the device flag or current at the limit; energy still counted', () => {
    const { pipe } = makePipeline();
    pipe.pushPacket(packet(0, 0, 10_000, 3200), T0); // at the 3200 mA limit
    pipe.pushPacket(packet(1, 50, 10_000, 3200), T0 + 50);
    let s = pipe.snapshot({ nowMs: T0 + 50, connection: 'streaming' });
    expect(s.metrics.sensorLimitReached).toBe(true);
    expect(s.alerts.some((a) => a.kind === 'sensor_limit')).toBe(true);
    expect(s.quality.detail.clippedSamples).toBe(2);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(32 * 0.05, 12); // still integrated
    // flag from the device with current below the limit
    const b = makePipeline();
    b.pipe.pushPacket(packet(0, 0, 5000, 100, 0x02), T0);
    s = b.pipe.snapshot({ nowMs: T0, connection: 'streaming' });
    expect(s.metrics.sensorLimitReached).toBe(true);
  });

  it('limit override in the profile replaces the Device Info limit', () => {
    const withOverride = makePipeline({
      deviceSensorLimitMa: 3200,
      profile: profile({ sensorLimitOverrideMa: 1000 }),
    });
    withOverride.pipe.pushPacket(packet(0, 0, 5000, 1500), T0);
    expect(
      withOverride.pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.sensorLimitReached,
    ).toBe(true);
    const without = makePipeline({ deviceSensorLimitMa: 3200 });
    without.pipe.pushPacket(packet(0, 0, 5000, 1500), T0);
    expect(
      without.pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.sensorLimitReached,
    ).toBe(false);
  });

  it('low sample rate (below 20 Hz) marks step counting unreliable and warns', () => {
    const { pipe } = makePipeline();
    feedRows(
      pipe,
      Array.from({ length: 60 }, (_, i): [number, number, number] => [i * 100, 5000, 0]),
    ); // 10 Hz
    const s = pipe.snapshot({ nowMs: T0 + 6000, connection: 'streaming' });
    expect(s.metrics.sampleRateHz).toBeCloseTo(10, 5);
    expect(s.quality.detail.stepsUnreliable).toBe(true);
    expect(s.alerts.some((a) => a.kind === 'low_sample_rate')).toBe(true);
  });

  it('measured rate at 20 Hz and 50 Hz is reported and not flagged', () => {
    for (const hz of [20, 50]) {
      const { pipe } = makePipeline();
      feedRows(
        pipe,
        Array.from({ length: hz * 5 + 1 }, (_, i): [number, number, number] => [
          i * (1000 / hz),
          5000,
          0,
        ]),
      );
      const s = pipe.snapshot({ nowMs: T0 + 5000, connection: 'streaming' });
      expect(s.metrics.sampleRateHz).toBeCloseTo(hz, 5);
      expect(s.quality.detail.stepsUnreliable).toBe(false);
    }
  });

  it('no_data alert after the configured silence while the link is expected to stream', () => {
    const { pipe } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    expect(
      pipe
        .snapshot({ nowMs: T0 + 1000, connection: 'streaming' })
        .alerts.some((a) => a.kind === 'no_data'),
    ).toBe(false);
    expect(
      pipe
        .snapshot({ nowMs: T0 + 6000, connection: 'stale' })
        .alerts.some((a) => a.kind === 'no_data'),
    ).toBe(true);
    expect(
      pipe
        .snapshot({ nowMs: T0 + 6000, connection: 'idle' })
        .alerts.some((a) => a.kind === 'no_data'),
    ).toBe(false);
  });

  it('no_generation alert after the configured idle time', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, [
      [0, 5000, 0],
      [50, 5000, 0],
    ]);
    const a = pipe.snapshot({ nowMs: T0 + 30_000, connection: 'streaming' });
    expect(a.alerts.some((x) => x.kind === 'no_generation')).toBe(false);
    const b = pipe.snapshot({ nowMs: T0 + 61_000, connection: 'streaming' });
    expect(b.alerts.some((x) => x.kind === 'no_generation')).toBe(true);
  });

  it('clock drift between device and arrival time is noted but never used for integration', () => {
    const { pipe } = makePipeline({ checkClockDrift: true });
    // device runs at 20 Hz; arrival times run 5% slower than device time
    let seq = 0;
    for (let i = 0; i <= 1300; i++) {
      pipe.pushPacket(packet(seq++, i * 50, 5000, 200), T0 + i * 52.5);
    }
    const s = pipe.snapshot({ nowMs: T0 + 70_000, connection: 'streaming' });
    expect(s.alerts.some((a) => a.kind === 'clock_drift')).toBe(true);
    expect(s.quality.recordedMs).toBe(65_000); // integration used device time only
  });

  it('stop() closes the session; the next packet after stop starts a new one', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    const summary = pipe.close();
    expect(summary?.status).toBe('closed');
    expect(summary?.endedAt).toBe(T0 + 50);
    expect(pipe.snapshot({ nowMs: T0, connection: 'idle' }).sessionId).toBeNull();
    pipe.pushPacket(packet(2, 100, 5000, 200), T0 + 100);
    expect(got.opened).toHaveLength(2);
  });
});
