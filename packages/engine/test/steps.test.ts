import { describe, expect, it } from 'vitest';
import { CadenceWindow, StepDetector } from '../src/index.js';
import { T0, constant, feedRows, makePipeline, profile } from './helpers.js';

const UW = 1e6;
const det = (over: Partial<{ th: number; gap: number; minPulse: number }> = {}) =>
  new StepDetector({
    stepThresholdUw: (over.th ?? 1) * UW,
    minGapMs: over.gap ?? 250,
    minPulseMs: over.minPulse ?? 0,
  });

/** Runs (t, W) samples through a detector and returns the steps it emitted. */
function run(d: StepDetector, rows: Array<[number, number]>) {
  const out = [];
  for (const [t, w] of rows) {
    const s = d.update(t, Math.round(w * UW), true);
    if (s) out.push(s);
  }
  return out;
}

describe('step detector (M9, M11): hysteresis at half the threshold', () => {
  it('counts a valid pulse once, when it falls below half the threshold', () => {
    const steps = run(det(), [
      [0, 0],
      [50, 0.4], // below half (0.5): still waiting
      [100, 0.6], // above half: pulse starts
      [150, 2.0], // passes the full threshold: valid
      [200, 0.8],
      [250, 0.3], // below half: step emitted here
      [300, 0],
    ]);
    expect(steps).toHaveLength(1);
    const s = steps[0]!;
    expect(s.startMs).toBe(100);
    expect(s.durationMs).toBe(150);
    expect(s.peakUw).toBe(2 * UW);
    // trapezoids inside the window: (0.6+2.0)/2*50 + (2.0+0.8)/2*50 + (0.8+0.3)/2*50 = 162.5 mJ... in nJ doubled
    const expectedJ =
      ((0.6 + 2.0) / 2) * 0.05 + ((2.0 + 0.8) / 2) * 0.05 + ((0.8 + 0.3) / 2) * 0.05;
    expect(s.energyNj2 / 2e9).toBeCloseTo(expectedJ, 12);
  });

  it('does not count a pulse that never passes the full threshold', () => {
    expect(
      run(det(), [
        [0, 0],
        [50, 0.7],
        [100, 0.9],
        [150, 0.2],
        [200, 0],
      ]),
    ).toHaveLength(0);
  });

  it('hysteresis: dipping between half and full threshold does not end the pulse', () => {
    const steps = run(det(), [
      [0, 0],
      [50, 1.5],
      [100, 0.7], // dip, still above half
      [150, 1.8],
      [200, 0.1],
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.peakUw).toBe(1.8 * UW);
  });

  it('a sample exactly at half stays in its state (strict comparisons)', () => {
    // exactly 0.5 W: not "above half" while waiting
    expect(
      run(det(), [
        [0, 0.5],
        [50, 0.5],
        [100, 2],
        [150, 0],
      ]),
    ).toHaveLength(1);
    // exactly 0.5 W inside a pulse: not "below half", so the pulse continues
    const d = det();
    const out = run(d, [
      [0, 0],
      [50, 2],
      [100, 0.5],
      [150, 0.5],
      [200, 0.1],
    ]);
    expect(out[0]!.durationMs).toBe(150);
  });

  it('merges a pulse that starts closer than the minimum gap after the previous step', () => {
    const rows: Array<[number, number]> = [
      [0, 0],
      [50, 2],
      [100, 0.1], // step 1 emitted (started t=50)
      [150, 2], // new pulse starts 100 ms after step 1 started: merged, ignored
      [200, 0.1],
      [250, 0],
      [400, 2], // starts 350 ms after: counts
      [450, 0.1],
    ];
    const steps = run(det({ gap: 250 }), rows);
    expect(steps.map((s) => s.startMs)).toEqual([50, 400]);
  });

  it('two quick steps with a clean dip between them, outside the gap, are two steps', () => {
    const rows: Array<[number, number]> = [
      [0, 0],
      [50, 3],
      [100, 0],
      [300, 3],
      [350, 0],
    ];
    expect(run(det({ gap: 250 }), rows)).toHaveLength(2);
  });

  it('rejects blips shorter than the minimum pulse width and keeps the gap window clean', () => {
    const rows: Array<[number, number]> = [
      [0, 0],
      [10, 3], // 10 ms blip
      [20, 0],
      [100, 3],
      [200, 0], // 100 ms pulse
    ];
    const steps = run(det({ minPulse: 50 }), rows);
    expect(steps.map((s) => s.startMs)).toEqual([100]);
  });

  it('a data gap aborts an open pulse: no step is invented across missing data', () => {
    const d = det();
    expect(d.update(0, 0, true)).toBeNull();
    expect(d.update(50, 3 * UW, true)).toBeNull(); // pulse open
    expect(d.update(2000, 0, false)).toBeNull(); // gap: interval not valid
    expect(d.update(2050, 0, true)).toBeNull();
  });

  it('remembers the readings at the trigger sample', () => {
    const d = det();
    d.update(0, 0, true, 5000, 0);
    d.update(50, 2 * UW, true, 6000, 333);
    d.update(100, 3 * UW, true, 7000, 430);
    const s = d.update(150, 0, true, 5000, 0)!;
    expect(s.triggerVoltageMv).toBe(6000);
    expect(s.triggerCurrentMa).toBe(333);
  });
});

describe('cadence (M10): steps in the last 10 s times 6', () => {
  it('counts steps in the window and drops old ones', () => {
    const c = new CadenceWindow(10_000);
    for (let i = 0; i < 10; i++) c.add(i * 1000);
    expect(c.spm(9999)).toBe(60); // 10 steps in 10 s
    expect(c.spm(12_500)).toBe(42); // steps at 0,1000,2000 have aged out (<= cutoff 2500): 7 left
  });
});

describe('steps through the pipeline', () => {
  /** n steps at `cadence` steps/min: 100 ms 2 W pulses at 20 Hz. */
  function walk(n: number, cadenceSpm: number, hz = 20) {
    const period = 1000 / hz;
    const stepMs = 60_000 / cadenceSpm;
    const rows: Array<[number, number, number]> = [];
    const total = Math.round((n * stepMs + 500) / period);
    for (let i = 0; i <= total; i++) {
      const t = i * period;
      const inStep = t % stepMs;
      const on = inStep >= 0 && inStep < 100 && Math.floor(t / stepMs) < n;
      rows.push([t, 5000, on ? 400 : 0]); // 2 W pulse of two samples, else idle
    }
    return rows;
  }

  it('counts 100 clean simulated steps exactly (DCR: no duplicates, no misses)', () => {
    const { pipe, got } = makePipeline({
      profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }),
    });
    feedRows(pipe, walk(100, 90));
    expect(got.steps).toHaveLength(100);
    expect(pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.steps).toBe(100);
  });

  it('quick succession (two steps 350 ms apart) is not double counted per step', () => {
    const { pipe, got } = makePipeline({
      profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }),
    });
    feedRows(pipe, walk(40, 171)); // 351 ms between steps
    expect(got.steps).toHaveLength(40);
  });

  it('step events carry the DCR record fields', () => {
    const { pipe, got } = makePipeline({
      profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }),
    });
    feedRows(pipe, walk(3, 90));
    const e = got.steps[0]!;
    expect(e.id).toMatch(/^FORCE-TEST_\d{8}T\d{9}Z$/);
    expect(e.stepNumber).toBe(1);
    expect(got.steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(new Set(got.steps.map((s) => s.id)).size).toBe(3); // unique: idempotent
    expect(e.voltageV).toBe(5);
    expect(e.currentMa).toBe(400);
    expect(e.avgW).toBeCloseTo(e.energyJ / (e.durationMs / 1000), 12);
  });

  it('cadence is null until 10 s of continuous recorded time, then steps/min', () => {
    const { pipe } = makePipeline({ profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }) });
    const rows = walk(30, 60); // 60 spm
    feedRows(pipe, rows.slice(0, 100)); // 5 s
    expect(pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.cadenceSpm).toBeNull();
    feedRows(pipe, rows.slice(100, 400), { startSeq: 100, arrivalBase: T0 + 5000 }); // up to 20 s
    const spm = pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.cadenceSpm;
    expect(spm).toBe(60);
  });

  it('a gap makes cadence unavailable again until 10 s of recorded time exist after it', () => {
    const { pipe } = makePipeline({ profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }) });
    const rows = walk(30, 60);
    feedRows(pipe, rows.slice(0, 300)); // 15 s, cadence available
    // 5 s dropout then 3 s of data
    const resume = rows
      .slice(0, 60)
      .map(([t, v, i]): [number, number, number] => [t + 20_000, v, i]);
    feedRows(pipe, resume, { startSeq: 400, arrivalBase: T0 + 20_000 });
    expect(pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.cadenceSpm).toBeNull();
  });

  it('energy per step (M11) is the energy of the last pulse; steps per hour groups by UTC hour', () => {
    const { pipe, got } = makePipeline({
      profile: profile({ stepThresholdW: 1, idleThresholdW: 0.1 }),
    });
    feedRows(pipe, walk(5, 90));
    const m = pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics;
    expect(m.energyPerStepJ).toBe(got.steps[4]!.energyJ);
    const hour = new Date(Math.floor(T0 / 3_600_000) * 3_600_000).toISOString();
    expect(m.stepsPerHour).toEqual({ [hour]: 5 });
  });

  it('new thresholds apply from the next sample (profile change)', () => {
    const { pipe, got } = makePipeline({
      profile: profile({ stepThresholdW: 100, idleThresholdW: 0.1 }),
    });
    feedRows(pipe, walk(10, 90).slice(0, 60));
    expect(got.steps).toHaveLength(0); // 2 W pulses never reach 100 W
    pipe.setProfile(profile({ stepThresholdW: 1, idleThresholdW: 0.1 }));
    feedRows(pipe, walk(10, 90).slice(60), { startSeq: 60, arrivalBase: T0 + 3000 });
    expect(got.steps.length).toBeGreaterThan(0);
  });
});

describe('constant helper sanity', () => {
  it('builds the stream the tests assume', () => {
    expect(constant(3, 50, 1, 1)).toEqual([
      [0, 1, 1],
      [50, 1, 1],
      [100, 1, 1],
    ]);
  });
});
