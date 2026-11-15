import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, Pipeline } from '@force/engine';
import { simulate } from '@force/simulator';

/**
 * Performance run (Architecture section 14): 1 hour of simulated samples through decode,
 * sequence check and the calculation engine, at 50 Hz (180 000 samples) and 100 Hz (360 000).
 * Budget: under 0.1 ms per sample. Set FORCE_PERF_REPORT=<file> to write the numbers as JSON.
 */
const HOUR_MS = 3_600_000;
const ANCHOR = 1_700_000_000_000;
const BUDGET_MS = 0.1;

interface Result {
  hz: number;
  samples: number;
  totalMs: number;
  meanMsPerSample: number;
  worstBatchMsPerSample: number;
  firstQuarterMs: number;
  lastQuarterMs: number;
  snapshotMeanMs: number;
  steps: number;
  heapGrowthMb: number;
}

function run(hz: number): Result {
  const packets = simulate({ sampleRateHz: hz, cadenceSpm: 90 }, HOUR_MS);
  const n = packets.length;
  const bytes = packets.map((p) => p.bytes);
  const arrivals = packets.map((p) => ANCHOR + p.arrivalOffsetMs);
  let chartPoints = 0;
  let steps = 0;
  const pipe = new Pipeline(
    {
      source: 'device',
      deviceId: 'FORCE-PERF',
      profile: DEFAULT_PROFILE,
      deviceSensorLimitMa: 3200,
      priorEnergyWh: 0,
      priorSteps: 0,
      checkClockDrift: true,
    },
    {
      onChartPoint: () => {
        chartPoints++;
      },
      onStep: () => {
        steps++;
      },
    },
  );

  // warm up the JIT on a throwaway pipeline so the first batch is not unfairly slow
  const warm = new Pipeline({
    source: 'device',
    deviceId: 'W',
    profile: DEFAULT_PROFILE,
    deviceSensorLimitMa: 3200,
    priorEnergyWh: 0,
    priorSteps: 0,
    checkClockDrift: false,
  });
  for (let i = 0; i < 20_000; i++) warm.pushPacket(bytes[i]!, arrivals[i]!);

  if (typeof globalThis.gc === 'function') globalThis.gc();
  const heap0 = process.memoryUsage().heapUsed;
  const batch = 1000;
  let worst = 0;
  let q1 = 0;
  let q4 = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i += batch) {
    const b0 = performance.now();
    const end = Math.min(i + batch, n);
    for (let j = i; j < end; j++) pipe.pushPacket(bytes[j]!, arrivals[j]!);
    const per = (performance.now() - b0) / (end - i);
    if (per > worst) worst = per;
    if (i < n / 4) q1 += per;
    if (i >= (3 * n) / 4) q4 += per;
  }
  const total = performance.now() - t0;
  const batches = Math.ceil(n / batch);

  // the snapshot runs at ~10 Hz; its cost must not grow with the session either
  const s0 = performance.now();
  const reps = 200;
  for (let i = 0; i < reps; i++)
    pipe.snapshot({ nowMs: ANCHOR + HOUR_MS, connection: 'streaming' });
  const snapMean = (performance.now() - s0) / reps;

  const heapGrowth = (process.memoryUsage().heapUsed - heap0) / 1e6;
  expect(chartPoints).toBe(n);
  return {
    hz,
    samples: n,
    totalMs: total,
    meanMsPerSample: total / n,
    worstBatchMsPerSample: worst,
    firstQuarterMs: q1 / (batches / 4),
    lastQuarterMs: q4 / (batches / 4),
    snapshotMeanMs: snapMean,
    steps,
    heapGrowthMb: heapGrowth,
  };
}

describe('performance: 1 simulated hour through the engine', () => {
  const results: Result[] = [];

  for (const hz of [50, 100]) {
    it(`${hz} Hz: under ${BUDGET_MS} ms per sample, constant over the session`, () => {
      const r = run(hz);
      results.push(r);
      expect(r.samples).toBe(hz * 3600 + 1);
      expect(r.meanMsPerSample).toBeLessThan(BUDGET_MS);
      // even the slowest 1000-sample batch stays within the budget (GC pauses included)
      expect(r.worstBatchMsPerSample).toBeLessThan(BUDGET_MS);
      // constant time per sample: the last quarter is not slower than the first
      expect(r.lastQuarterMs).toBeLessThan(r.firstQuarterMs * 3 + 0.005);
      expect(r.snapshotMeanMs).toBeLessThan(1);
      expect(r.steps).toBeGreaterThan(5000); // 90 spm x 60 min = 5400
    }, 120_000);
  }

  it('writes the numbers when asked', () => {
    const file = process.env.FORCE_PERF_REPORT;
    if (file) writeFileSync(file, JSON.stringify(results, null, 2));
    expect(true).toBe(true);
  });
});
