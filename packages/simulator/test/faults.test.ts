import { describe, expect, it } from 'vitest';
import { FLAG } from '@force/protocol';
import { Pipeline } from '@force/engine';
import type { PipelineConfig } from '@force/engine';
import { DEFAULT_PROFILE } from '@force/engine';
import type { GapRecord, StepEvent } from '@force/contracts';
import { PacketSimulator, simulate } from '../src/index.js';
import type { SimConfig, SimPacket } from '../src/index.js';

const ANCHOR = 1_700_000_000_000;

function run(
  cfg: Partial<SimConfig>,
  durationMs: number,
  opts: { staleAfterGap?: boolean; pipeline?: Partial<PipelineConfig> } = {},
) {
  const steps: StepEvent[] = [];
  const gaps: GapRecord[] = [];
  const closed: string[] = [];
  const opened: string[] = [];
  const pipe = new Pipeline(
    {
      source: 'device',
      deviceId: 'FORCE-SIM0',
      profile: DEFAULT_PROFILE,
      deviceSensorLimitMa: 3200,
      priorEnergyWh: 0,
      priorSteps: 0,
      checkClockDrift: false,
      ...opts.pipeline,
    },
    {
      onStep: (e) => steps.push(e),
      onGap: (g) => gaps.push(g),
      onSessionOpened: (s) => opened.push(s.id),
      onSessionClosed: (s) => closed.push(s.id),
    },
  );
  const packets = simulate(cfg, durationMs);
  let last: SimPacket | null = null;
  const results: string[] = [];
  for (const p of packets) {
    // the source's stale timer: the first packet after a >1 s silence is preceded by a stale mark
    if (opts.staleAfterGap && last && p.arrivalOffsetMs - last.arrivalOffsetMs > 1000)
      pipe.notifyStale();
    results.push(pipe.pushPacket(p.bytes, ANCHOR + p.arrivalOffsetMs));
    last = p;
  }
  const snap = () => pipe.snapshot({ nowMs: ANCHOR + durationMs, connection: 'streaming' });
  return { pipe, steps, gaps, closed, opened, packets, results, snap };
}

describe('simulator output', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = simulate({ seed: 7 }, 5000).map((p) => [...p.bytes].join());
    const b = simulate({ seed: 7 }, 5000).map((p) => [...p.bytes].join());
    const c = simulate({ seed: 8 }, 5000).map((p) => [...p.bytes].join());
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('every packet is 15 bytes and seq runs 0,1,2... at the chosen rate', () => {
    const p = simulate({ sampleRateHz: 50 }, 1000);
    expect(p).toHaveLength(51);
    expect(p.every((x) => x.bytes.length === 15)).toBe(true);
    expect(p.map((x) => new DataView(x.bytes.buffer).getUint16(0, true))).toEqual(
      Array.from({ length: 51 }, (_, i) => i),
    );
  });

  it('streams in chunks identically to one batch', () => {
    const one = simulate({}, 3000);
    const sim = new PacketSimulator({});
    const many = [...sim.until(1000), ...sim.until(2000), ...sim.until(3000)];
    expect(many.map((p) => [...p.bytes].join())).toEqual(one.map((p) => [...p.bytes].join()));
  });
});

describe('baseline walking', () => {
  it('90 steps per minute for 60 s is counted as exactly 90 steps', () => {
    const r = run({ cadenceSpm: 90 }, 60_000);
    expect(r.steps).toHaveLength(90);
    const s = r.snap();
    expect(s.metrics.steps).toBe(90);
    expect(s.quality.lostPackets).toBe(0);
    expect(s.quality.droppedPackets).toBe(0);
    expect(s.quality.excludedGapMs).toBe(0);
    expect(s.metrics.peakPowerW).toBeGreaterThan(1.5);
    expect(s.metrics.sampleRateHz).toBeCloseTo(20, 5);
  });

  for (const hz of [20, 50, 100]) {
    it(`counts the same 60 steps at ${hz} Hz (60 spm for 60 s)`, () => {
      const r = run({ cadenceSpm: 60, sampleRateHz: hz }, 60_000);
      expect(r.steps).toHaveLength(60);
      expect(r.snap().metrics.sampleRateHz).toBeCloseTo(hz, 5);
    });
  }

  it('energy per step is stable across sample rates (pulse integral does not depend on rate)', () => {
    const e = (hz: number) =>
      run({ cadenceSpm: 60, sampleRateHz: hz, noiseMa: 0, noiseMv: 0 }, 20_000).steps;
    const at100 = e(100).map((s) => s.energyJ);
    const at50 = e(50).map((s) => s.energyJ);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(Math.abs(mean(at50) - mean(at100)) / mean(at100)).toBeLessThan(0.1);
  });
});

describe('fault injection (Architecture section 12)', () => {
  const base = run({}, 60_000).snap();

  it('lost packets: counted, bridged within 1 s, drawn as a gap, session continues', () => {
    const r = run({ faults: [{ kind: 'drop', atMs: 10_000, durationMs: 150 }] }, 60_000);
    const s = r.snap();
    expect(s.quality.lostPackets).toBe(3);
    expect(s.quality.bridgedMs).toBe(200);
    expect(s.quality.excludedGapMs).toBe(0);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.cause).toBe('lost_packets');
    expect(r.opened).toHaveLength(1);
    // bridged across real bounding samples: recorded time is not reduced
    expect(s.quality.recordedMs).toBe(base.quality.recordedMs);
  });

  it('5 second dropout: excluded from energy and recorded time, never filled, reported', () => {
    const r = run({ faults: [{ kind: 'drop', atMs: 20_000, durationMs: 5000 }] }, 60_000);
    const s = r.snap();
    expect(s.quality.lostPackets).toBe(100);
    expect(s.quality.excludedGapMs).toBe(5050);
    expect(s.quality.bridgedMs).toBe(0);
    expect(s.quality.recordedMs).toBe(base.quality.recordedMs - 5050);
    expect(s.metrics.sessionEnergyJ).toBeLessThan(base.metrics.sessionEnergyJ);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.endMs - r.gaps[0]!.startMs).toBe(5050);
  });

  it('stale stream: same hole, labelled stale when the source reports silence; session stays open', () => {
    const r = run({ faults: [{ kind: 'stale', atMs: 20_000, durationMs: 5000 }] }, 60_000, {
      staleAfterGap: true,
    });
    expect(r.gaps.map((g) => g.cause)).toEqual(['stale']);
    expect(r.opened).toHaveLength(1);
    expect(r.closed).toHaveLength(0);
    expect(r.snap().quality.excludedGapMs).toBe(5050);
  });

  it('duplicate packet: dropped and counted, totals identical to a clean run', () => {
    const r = run({ faults: [{ kind: 'duplicate', atMs: 5000 }] }, 60_000);
    const s = r.snap();
    expect(s.quality.detail.duplicatePackets).toBe(1);
    expect(s.metrics.sessionEnergyJ).toBe(base.metrics.sessionEnergyJ);
    expect(s.metrics.steps).toBe(base.metrics.steps);
  });

  it('reordered packets: the late one is dropped and counted, one packet shows as lost', () => {
    const r = run({ faults: [{ kind: 'reorder', atMs: 5000 }] }, 60_000);
    const s = r.snap();
    expect(s.quality.detail.latePackets).toBe(1);
    expect(s.quality.lostPackets).toBe(1);
    expect(r.opened).toHaveLength(1);
    expect(s.metrics.steps).toBe(base.metrics.steps);
  });

  it('device restart: session closed, a new one opened, gap cause device_restart', () => {
    const r = run({ faults: [{ kind: 'restart', atMs: 30_000 }] }, 60_000);
    expect(r.opened).toHaveLength(2);
    expect(r.closed).toHaveLength(1);
    expect(r.gaps.filter((g) => g.cause === 'device_restart')).toHaveLength(1);
    const s = r.snap();
    expect(s.sessionId).toBe(r.opened[1]);
    expect(s.alerts.some((a) => a.kind === 'device_restart')).toBe(true);
    // all-time energy covers both sessions
    expect(s.metrics.totalEnergyWh).toBeGreaterThan(s.metrics.sessionEnergyWh);
  });

  it('sensor limit clip: flagged, alerted, energy still counted but marked', () => {
    const r = run({ faults: [{ kind: 'clip', atMs: 10_000, durationMs: 1000 }] }, 12_000);
    const s = r.snap();
    expect(s.quality.detail.clippedSamples).toBe(20);
    expect(s.alerts.some((a) => a.kind === 'sensor_limit')).toBe(true);
    expect(s.metrics.peakPowerW).toBeGreaterThan(15); // 5 V x 3.2 A: counted, not discarded
  });

  it('malformed and out-of-range packets: counted, dropped, never reach the calculation', () => {
    const r = run(
      {
        faults: [
          { kind: 'malformed', atMs: 3000 },
          { kind: 'bad_voltage', atMs: 4000 },
        ],
      },
      10_000,
    );
    const s = r.snap();
    expect(s.quality.detail.malformedPackets).toBe(2);
    expect(s.quality.lostPackets).toBe(2); // their samples never arrived intact
    expect(s.quality.droppedPackets).toBe(2);
  });

  it('INA219 stops answering: fault flag packets are not measurements; no step is invented', () => {
    const r = run(
      { cadenceSpm: 60, faults: [{ kind: 'sensor_fault', atMs: 10_000, durationMs: 3000 }] },
      20_000,
    );
    const s = r.snap();
    const faulted = r.packets.filter((p) => (p.bytes[14]! & FLAG.SENSOR_FAULT) !== 0).length;
    expect(faulted).toBe(60);
    expect(s.quality.excludedGapMs).toBeGreaterThanOrEqual(3000);
    expect(r.steps.every((e) => e.peakW > 0)).toBe(true);
    // steps that would have happened in the 3 s hole are simply not counted
    expect(s.metrics.steps).toBeLessThan(20);
    expect(s.metrics.steps).toBeGreaterThanOrEqual(15);
  });

  it('low sample rate (10 Hz) is flagged', () => {
    const s = run({ sampleRateHz: 10 }, 10_000).snap();
    expect(s.quality.detail.stepsUnreliable).toBe(true);
    expect(s.alerts.some((a) => a.kind === 'low_sample_rate')).toBe(true);
  });
});

describe('wrap-around gives identical results to no wrap', () => {
  it('device time crossing 2^32 ms changes nothing', () => {
    const wrapped = run({ startDeviceTimeMs: 4294967296 - 10_000 }, 60_000);
    expect(wrapped.opened).toHaveLength(1);
    expect(wrapped.closed).toHaveLength(0);
    const s = wrapped.snap();
    expect(s.metrics.sessionEnergyJ).toBe(base().metrics.sessionEnergyJ);
    expect(s.metrics.steps).toBe(base().metrics.steps);
    expect(s.quality.recordedMs).toBe(base().quality.recordedMs);
  });

  it('seq crossing 65535 -> 0 changes nothing', () => {
    const wrapped = run({ startSeq: 65535 - 500 }, 60_000);
    const s = wrapped.snap();
    expect(s.quality.lostPackets).toBe(0);
    expect(s.metrics.sessionEnergyJ).toBe(base().metrics.sessionEnergyJ);
  });

  function base() {
    return run({}, 60_000).snap();
  }
});
