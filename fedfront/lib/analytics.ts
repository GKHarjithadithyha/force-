import { co2AvoidedKg } from '@force/engine';
import type { DashboardEngine, DeviceProfile, HistoryPoint, Range, RangeTotals } from '@/contracts';

/**
 * Overview analytics, built only from the engine's stored totals (`getTotals`). No metric is
 * calculated here: energy, steps and recorded time come from storage, and CO2 uses the engine's
 * own M13 function with the saved profile. Totals cover real-device sessions only, so demo and
 * replay data can never appear as real generation.
 */

const HOUR = 3_600_000;

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addLocalDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Bucket bounds [from, to) in local time. Today: hours since midnight. Week/month: whole days. */
export function historyBuckets(range: Range, nowMs: number): Array<[number, number]> {
  const today = startOfLocalDay(nowMs);
  const out: Array<[number, number]> = [];
  if (range === 'today') {
    for (let t = today; t <= nowMs; t += HOUR) out.push([t, t + HOUR]);
    return out;
  }
  const days = range === 'week' ? 7 : 30;
  for (let i = days - 1; i >= 0; i--) {
    const from = addLocalDays(today, -i);
    out.push([from, addLocalDays(from, 1)]);
  }
  return out;
}

export async function getHistory(
  engine: DashboardEngine,
  range: Range,
  nowMs = Date.now(),
): Promise<HistoryPoint[]> {
  const totals = await Promise.all(
    historyBuckets(range, nowMs).map(([from, to]) => engine.getTotals(from, to)),
  );
  return totals.map((t) => ({
    t: t.fromMs,
    energyWh: t.energyWh,
    steps: t.steps,
    recordedMs: t.recordedMs,
  }));
}

export interface DayTotals {
  today: RangeTotals;
  yesterday: RangeTotals;
  co2TodayKg: number;
  co2YesterdayKg: number;
}

export async function getTodayVsYesterday(
  engine: DashboardEngine,
  profile: Pick<DeviceProfile, 'emissionFactorKgPerKwh'>,
  nowMs = Date.now(),
): Promise<DayTotals> {
  const today = startOfLocalDay(nowMs);
  const yesterdayStart = addLocalDays(today, -1);
  const [t, y] = await Promise.all([
    engine.getTotals(today, nowMs + 1),
    engine.getTotals(yesterdayStart, today),
  ]);
  return {
    today: t,
    yesterday: y,
    co2TodayKg: co2AvoidedKg(t.energyWh, profile),
    co2YesterdayKg: co2AvoidedKg(y.energyWh, profile),
  };
}

/** True when any stored bucket has real recorded data (otherwise charts show an empty state). */
export function hasHistory(points: HistoryPoint[]): boolean {
  return points.some((p) => p.recordedMs > 0 || p.steps > 0 || p.energyWh > 0);
}
