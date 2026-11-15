// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForceDatabase, Store } from '@force/storage';
import { resolveEngineMode } from '../config/engine-mode.mjs';
import { createAppEngine, engineMode } from '@/engine';
import type { AppEngine } from '@/engine';
import type { DashboardEngine, LiveSnapshot, RangeTotals } from '@/contracts';
import { getTodayVsYesterday, historyBuckets, startOfLocalDay } from '@/lib/analytics';
import { decimateMinMax } from '@/lib/decimate';
import { CHART_FLUSH_MS, MAX_POINTS, useDashboard } from '@/stores/dashboard';

describe('engine mode configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the real engine; mock needs an explicit value', () => {
    expect(resolveEngineMode({}, { production: true })).toBe('device');
    expect(resolveEngineMode({ NEXT_PUBLIC_ENGINE: '' }, { production: true })).toBe('device');
    expect(resolveEngineMode({ NEXT_PUBLIC_ENGINE: 'device' }, { production: true })).toBe('device');
    expect(resolveEngineMode({ NEXT_PUBLIC_ENGINE: 'mock' }, { production: false })).toBe('mock');
    vi.stubEnv('NEXT_PUBLIC_ENGINE', '');
    expect(engineMode()).toBe('device');
    vi.stubEnv('NEXT_PUBLIC_ENGINE', 'mock');
    expect(engineMode()).toBe('mock');
  });
  it('refuses a production build in mock mode and unknown values', () => {
    expect(() => resolveEngineMode({ NEXT_PUBLIC_ENGINE: 'mock' }, { production: true })).toThrow(/Refusing a production build/);
    expect(resolveEngineMode({ NEXT_PUBLIC_ENGINE: 'mock', FORCE_ALLOW_MOCK_BUILD: '1' }, { production: true })).toBe('mock');
    expect(() => resolveEngineMode({ NEXT_PUBLIC_ENGINE: 'real' }, { production: false })).toThrow(/not valid/);
  });
});

describe('mock and real data never mix (SIMULATED)', () => {
  let app: AppEngine | null = null;
  afterEach(() => { app?.dispose(); app = null; });

  it('mock sessions are written only to IndexedDB "force-mock", never to "force"', async () => {
    app = createAppEngine('mock');
    let last: LiveSnapshot | null = null;
    app.engine.subscribeSnapshot((s) => { last = s; });
    const end = Date.now() + 8000;
    while (!(last && (last as LiveSnapshot).lastPacketAt !== null) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 1200)); // at least one storage flush
    await app.engine.disconnect();
    expect((await app.engine.listSessions()).length).toBeGreaterThan(0);
    const real = new Store(new ForceDatabase('force'));
    expect(await real.listSessions()).toEqual([]);
  });
});

describe('day boundaries for stored totals', () => {
  it('asks for [local midnight, now] today and [previous midnight, midnight) yesterday', async () => {
    const now = new Date(2026, 10, 16, 0, 0, 5).getTime(); // 5 s after local midnight
    const calls: Array<[number, number]> = [];
    const engine = { getTotals: async (fromMs: number, toMs: number): Promise<RangeTotals> => { calls.push([fromMs, toMs]); return { fromMs, toMs, steps: 0, energyWh: 1, recordedMs: 0, peakPowerW: 0, sessions: 0 }; } } as unknown as DashboardEngine;
    const d = await getTodayVsYesterday(engine, { emissionFactorKgPerKwh: 0.5 }, now);
    const midnight = startOfLocalDay(now);
    expect(calls[0]).toEqual([midnight, now + 1]);
    expect(calls[1]).toEqual([new Date(2026, 10, 15).getTime(), midnight]);
    expect(d.co2TodayKg).toBeCloseTo(0.0005); // engine's own M13 formula: 1 Wh x 0.5 kg/kWh
    // buckets tile the range with no gap or overlap
    const week = historyBuckets('week', now);
    for (let i = 1; i < week.length; i++) expect(week[i][0]).toBe(week[i - 1][1]);
    expect(week.at(-1)![1]).toBe(new Date(2026, 10, 17).getTime());
  });
});

describe('chart display', () => {
  it('decimation keeps every peak and trough and never alters a value', () => {
    const n = 72_000;
    const times = Array.from({ length: n }, (_, i) => i * 50);
    const values = Array.from({ length: n }, (_, i) => (i % 997 === 0 ? 9.5 : i % 499 === 0 ? -0.2 : 0.01));
    const out = decimateMinMax(times, values);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...out.map((p) => p[1]))).toBe(9.5);
    expect(Math.min(...out.map((p) => p[1]))).toBe(-0.2);
    const all = new Set<number>(values);
    expect(out.every(([, v]) => all.has(v))).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
    expect(decimateMinMax([1, 2], [3, 4])).toEqual([[1, 3], [2, 4]]);
  });

  it('chart samples are batched (few store updates) and capped', () => {
    vi.useFakeTimers();
    try {
      const st = useDashboard.getState(); st.clearLive();
      let updates = 0; const unsub = useDashboard.subscribe(() => { updates++; });
      for (let k = 0; k < 10; k++) st.pushChart({ times: Float64Array.from([k * 2, k * 2 + 1]), powerW: Float64Array.from([1, 2]), voltageV: new Float64Array(2), currentMa: new Float64Array(2) });
      expect(updates).toBe(0);
      vi.advanceTimersByTime(CHART_FLUSH_MS);
      expect(updates).toBe(1);
      expect(useDashboard.getState().power).toHaveLength(20);
      st.pushChart({ times: Float64Array.from({ length: MAX_POINTS }, (_, i) => 100 + i), powerW: new Float64Array(MAX_POINTS), voltageV: new Float64Array(MAX_POINTS), currentMa: new Float64Array(MAX_POINTS) });
      vi.advanceTimersByTime(CHART_FLUSH_MS);
      expect(useDashboard.getState().power).toHaveLength(MAX_POINTS);
      unsub(); st.clearLive();
    } finally { vi.useRealTimers(); }
  });
});
