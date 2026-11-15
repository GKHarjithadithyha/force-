import { describe, expect, it } from 'vitest';
import { T0, constant, feedRows, makePipeline, packet, profile } from './helpers.js';

const snap = (pipe: ReturnType<typeof makePipeline>['pipe'], connection = 'streaming' as const) =>
  pipe.snapshot({ nowMs: T0 + 1_000_000, connection });

describe('energy (M5): integer maths, trapezoid, device time', () => {
  it('constant 1 W for 10 s is exactly 10 J', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(201, 50, 5000, 200)); // 5 V x 200 mA = 1 W, 200 intervals of 50 ms
    const s = snap(pipe);
    expect(s.metrics.sessionEnergyJ).toBe(10);
    expect(s.metrics.sessionEnergyWh).toBe(10 / 3600);
    expect(s.quality.recordedMs).toBe(10_000);
    expect(s.metrics.avgPowerW).toBe(1);
    expect(s.metrics.peakPowerW).toBe(1);
  });

  it('uses the average of neighbouring powers (trapezoid): 0 W to 2 W over 1 s is 1 J', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, [
      [0, 1000, 0],
      [1000, 1000, 2000],
    ]);
    expect(snap(pipe).metrics.sessionEnergyJ).toBe(1);
  });

  it('mV x mA is exact microwatts: 12345 mV x 6789 mA over 1 ms', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, [
      [0, 12345, 2000],
      [1, 12345, 2000],
    ]);
    // 24.69 W for 1 ms = 0.02469 J exactly; the integer path has no rounding error
    expect(snap(pipe).metrics.sessionEnergyJ).toBe((12345 * 2000 * 2 * 1) / 2e9);
  });

  it('an interval of exactly 1000 ms is integrated; 1001 ms is excluded and reported', () => {
    const a = makePipeline();
    feedRows(a.pipe, [
      [0, 5000, 200],
      [1000, 5000, 200],
    ]);
    expect(snap(a.pipe).metrics.sessionEnergyJ).toBe(1);
    expect(a.got.gaps).toHaveLength(0);

    const b = makePipeline();
    feedRows(b.pipe, [
      [0, 5000, 200],
      [1001, 5000, 200],
    ]);
    const s = snap(b.pipe);
    expect(s.metrics.sessionEnergyJ).toBe(0); // never filled
    expect(s.quality.excludedGapMs).toBe(1001);
    expect(s.quality.recordedMs).toBe(0);
    expect(b.got.gaps).toEqual([{ startMs: T0, endMs: T0 + 1001, cause: 'stale' }]);
  });

  it('negative power counts as zero in energy, is counted, and the sample is still charted', () => {
    const { pipe, got } = makePipeline();
    feedRows(pipe, [
      [0, 5000, -100],
      [50, 5000, -100],
      [100, 5000, -100],
    ]);
    const s = snap(pipe);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.metrics.powerW).toBe(0);
    expect(s.quality.detail.negativePowerSamples).toBe(3);
    expect(s.metrics.currentMa).toBe(-100); // stored as received
    expect(got.chart).toBe(3);
  });

  it('power the device sent is only a cross-check: a mismatch over 1% is counted', () => {
    const { pipe } = makePipeline();
    // hand-built packet: 5 V x 200 mA = 1000 mW, but the device claims 2000 mW
    const p = packet(0, 0, 5000, 200);
    new DataView(p.buffer).setUint32(10, 2000, true);
    pipe.pushPacket(p, T0);
    expect(snap(pipe).quality.detail.powerMismatchSamples).toBe(1);
    // rounding-sized differences are not mismatches
    const q = makePipeline();
    q.pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    expect(snap(q.pipe).quality.detail.powerMismatchSamples).toBe(0);
  });

  it('energy accumulates exactly across minute buckets and long sessions (BigInt fold)', () => {
    const { pipe, got } = makePipeline();
    // 10 minutes at 10 W (20 V x 500 mA), 50 ms steps
    feedRows(pipe, constant(12_001, 50, 20_000, 500));
    const s = snap(pipe);
    expect(s.metrics.sessionEnergyJ).toBe(6000); // 10 W x 600 s
    expect(got.minutes.length).toBeGreaterThanOrEqual(10);
    const sum =
      got.minutes.reduce((a, m) => a + m.energyNj2, 0) + (pipe.peekMinute()?.energyNj2 ?? 0);
    expect(sum / 2e9).toBe(6000);
  });

  it('total energy (M6) adds earlier real sessions; peak (M8) and average (M7) follow', () => {
    const { pipe } = makePipeline({ priorEnergyWh: 2.5 });
    feedRows(pipe, [
      [0, 5000, 0],
      [500, 5000, 400], // 2 W
      [1000, 5000, 0],
    ]);
    const m = snap(pipe).metrics;
    expect(m.peakPowerW).toBe(2);
    expect(m.sessionEnergyJ).toBe(1); // two triangles of 0.5 s x 2 W / 2
    expect(m.avgPowerW).toBe(1);
    expect(m.totalEnergyWh).toBeCloseTo(2.5 + 1 / 3600, 12);
  });

  it('generating state (M4) uses the idle threshold and a hold time', () => {
    const { pipe } = makePipeline({ profile: profile({ idleThresholdW: 0.5, idleHoldMs: 1000 }) });
    feedRows(pipe, [
      [0, 5000, 0],
      [50, 5000, 400], // 2 W: generating at once
    ]);
    expect(snap(pipe).metrics.generating).toBe(true);
    feedRows(pipe, constant(10, 50, 5000, 0, 100), { startSeq: 2, arrivalBase: T0 + 100 }); // 0.5 s idle
    expect(snap(pipe).metrics.generating).toBe(true); // hold: no flicker between steps
    feedRows(pipe, constant(30, 50, 5000, 0, 600), { startSeq: 12, arrivalBase: T0 + 600 });
    expect(snap(pipe).metrics.generating).toBe(false); // idle for over 1 s
  });
});

describe('device-time and sequence wrap through the pipeline', () => {
  it('device time wrapping past 2^32 is a small forward step, not a restart', () => {
    const { pipe, got } = makePipeline();
    const t = 4294967296 - 100;
    pipe.pushPacket(packet(10, t, 5000, 200), T0);
    pipe.pushPacket(packet(11, (t + 50) % 4294967296, 5000, 200), T0 + 50);
    pipe.pushPacket(packet(12, (t + 100) % 4294967296, 5000, 200), T0 + 100); // wrapped to 0
    pipe.pushPacket(packet(13, (t + 150) % 4294967296, 5000, 200), T0 + 150);
    const s = snap(pipe);
    expect(got.opened).toHaveLength(1);
    expect(got.closed).toHaveLength(0);
    expect(s.quality.recordedMs).toBe(150);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(0.15, 12); // 1 W x 150 ms
  });

  it('seq wrapping 65535 -> 0 loses nothing', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(10, 50, 5000, 200), { startSeq: 65530 });
    const s = snap(pipe);
    expect(s.quality.lostPackets).toBe(0);
    expect(s.quality.recordedMs).toBe(450);
  });

  it('lost packets within 1 s are bridged between the two real samples and counted', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    pipe.pushPacket(packet(5, 250, 5000, 200), T0 + 250); // seq 2,3,4 lost
    const s = snap(pipe);
    expect(s.quality.lostPackets).toBe(3);
    expect(s.quality.bridgedMs).toBe(200);
    expect(s.quality.recordedMs).toBe(250);
    expect(s.quality.excludedGapMs).toBe(0);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(0.25, 12);
    expect(got.gaps).toEqual([{ startMs: T0 + 50, endMs: T0 + 250, cause: 'lost_packets' }]);
  });

  it('lost packets over 1 s are excluded from energy and recorded time, never filled', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.pushPacket(packet(1, 50, 5000, 200), T0 + 50);
    pipe.pushPacket(packet(101, 5050, 5000, 200), T0 + 5050); // 5 s dropout, 99 lost
    pipe.pushPacket(packet(102, 5100, 5000, 200), T0 + 5100);
    const s = snap(pipe);
    expect(s.quality.lostPackets).toBe(99);
    expect(s.quality.excludedGapMs).toBe(5000);
    expect(s.quality.bridgedMs).toBe(0);
    expect(s.quality.recordedMs).toBe(100); // 50 + 50 only
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(0.1, 12);
    expect(got.gaps).toEqual([{ startMs: T0 + 50, endMs: T0 + 5050, cause: 'lost_packets' }]);
  });

  it('gap cause follows what the source knows: link down and stale override lost_packets', () => {
    const { pipe, got } = makePipeline();
    pipe.pushPacket(packet(0, 0, 5000, 200), T0);
    pipe.notifyLinkDown();
    pipe.pushPacket(packet(40, 2000, 5000, 200), T0 + 2000);
    pipe.notifyStale();
    pipe.pushPacket(packet(90, 4500, 5000, 200), T0 + 4500);
    pipe.notifyStale();
    pipe.notifyLinkDown(); // link down wins over stale
    pipe.pushPacket(packet(140, 7000, 5000, 200), T0 + 7000);
    expect(got.gaps.map((g) => g.cause)).toEqual(['link_down', 'stale', 'link_down']);
  });
});
