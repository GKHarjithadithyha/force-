import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePipeline, packet, profile } from './helpers.js';

interface Golden {
  deviceId: string;
  arrivalMsAtFirstSample: number;
  profile: { stepThresholdW: number; idleThresholdW: number };
  samples: Array<{ seq: number; t: number; mV: number; mA: number }>;
  hand: {
    energyJ: number;
    recordedMs: number;
    avgPowerW: number;
    peakPowerW: number;
    steps: number;
    stepStartMs: number;
    stepDurationMs: number;
    stepEnergyJ: number;
    stepAvgW: number;
  };
}

const golden = JSON.parse(
  readFileSync(new URL('./golden/hand_session.json', import.meta.url), 'utf8'),
) as Golden;

function runGolden() {
  const { pipe, got } = makePipeline({
    deviceId: golden.deviceId,
    profile: profile(golden.profile),
  });
  for (const s of golden.samples) {
    pipe.pushPacket(packet(s.seq, s.t, s.mV, s.mA), golden.arrivalMsAtFirstSample + s.t);
  }
  return { pipe, got };
}

const within = (actual: number, expected: number, pct = 0.1) =>
  Math.abs(actual - expected) <= (Math.abs(expected) * pct) / 100;

describe('golden file: hand-calculated session (0.1% target)', () => {
  it('energy, recorded time, average and peak power match the hand calculation', () => {
    const { pipe } = runGolden();
    const s = pipe.snapshot({ nowMs: golden.arrivalMsAtFirstSample, connection: 'streaming' });
    expect(within(s.metrics.sessionEnergyJ, golden.hand.energyJ)).toBe(true);
    expect(s.quality.recordedMs).toBe(golden.hand.recordedMs);
    expect(within(s.metrics.avgPowerW, golden.hand.avgPowerW)).toBe(true);
    expect(s.metrics.peakPowerW).toBe(golden.hand.peakPowerW);
    // the integer path is in fact exact for this input
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(golden.hand.energyJ, 12);
  });

  it('the step, its duration, energy and average power match the hand calculation', () => {
    const { got } = runGolden();
    expect(got.steps).toHaveLength(golden.hand.steps);
    const e = got.steps[0]!;
    expect(e.t).toBe(golden.arrivalMsAtFirstSample + golden.hand.stepStartMs);
    expect(e.durationMs).toBe(golden.hand.stepDurationMs);
    expect(within(e.energyJ, golden.hand.stepEnergyJ)).toBe(true);
    expect(within(e.avgW, golden.hand.stepAvgW)).toBe(true);
    expect(e.peakW).toBe(golden.hand.peakPowerW);
  });

  it('reprocessing the same raw samples gives totals identical to the live run', () => {
    const live = runGolden();
    const again = makePipeline({ deviceId: golden.deviceId, profile: profile(golden.profile) });
    // the "stored" log: the accepted raw samples exactly as they were emitted
    for (const { sample } of live.got.raws) {
      const p = packet(
        sample.seq,
        sample.deviceTimeMs,
        sample.voltageMv,
        sample.currentMa,
        sample.flags,
      );
      again.pipe.pushPacket(p, sample.arrivalMs);
    }
    const a = live.pipe.snapshot({ nowMs: 0, connection: 'streaming' });
    const b = again.pipe.snapshot({ nowMs: 0, connection: 'streaming' });
    expect(b.metrics).toEqual(a.metrics);
    expect(b.quality).toEqual(a.quality);
    expect(again.got.steps).toEqual(live.got.steps);
  });
});
