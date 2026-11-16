/**
 * Real-World Impact: ESTIMATED EQUIVALENTS of the energy a F.O.R.C.E. tile generated.
 *
 * Pure functions (no React, no I/O). Nothing here is measured: every figure is the generated energy (Wh)
 * divided by an explicit assumption (ImpactAssumptions). Missing, negative or non-finite energy gives
 * null / a dash, never a made-up number. Conversions: 1 kWh = 1000 Wh, 1 km = 1000 m, 1 L = 1000 mL, 1 h = 3600 s.
 */

export interface ImpactAssumptions {
  /** Electric scooter consumption, Wh per km. */
  scooterWhPerKm: number;
  /** Petrol two-wheeler fuel economy, km per litre. */
  petrolKmPerLitre: number;
  /** Household load, W. */
  houseLoadW: number;
  /** LED bulb power, W. */
  ledW: number;
}
export type AssumptionKey = keyof ImpactAssumptions;

export const DEFAULT_ASSUMPTIONS: Readonly<ImpactAssumptions> = Object.freeze({
  scooterWhPerKm: 30,
  petrolKmPerLitre: 40,
  houseLoadW: 100,
  ledW: 9,
});

export interface AssumptionLimit { label: string; unit: string; min: number; max: number; step: number }
/** Accepted range per assumption (inclusive). Values outside it are rejected, not clamped. */
export const ASSUMPTION_LIMITS: Readonly<Record<AssumptionKey, AssumptionLimit>> = {
  scooterWhPerKm: { label: 'Electric scooter', unit: 'Wh/km', min: 5, max: 200, step: 1 },
  petrolKmPerLitre: { label: 'Petrol two-wheeler', unit: 'km/L', min: 5, max: 150, step: 1 },
  houseLoadW: { label: 'Household load', unit: 'W', min: 1, max: 10_000, step: 10 },
  ledW: { label: 'LED bulb', unit: 'W', min: 0.5, max: 200, step: 0.5 },
};
const KEYS = Object.keys(ASSUMPTION_LIMITS) as AssumptionKey[];

export const WH_PER_KWH = 1000;
export const M_PER_KM = 1000;
export const ML_PER_LITRE = 1000;
export const SECONDS_PER_HOUR = 3600;

/** A number inside the allowed range, or null (text such as "abc", empty text, NaN and out-of-range values). */
export function parseAssumption(key: AssumptionKey, raw: unknown): number | null {
  const { min, max } = ASSUMPTION_LIMITS[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Any stored/unknown object -> a complete, valid set. Each invalid or missing field falls back. */
export function sanitizeAssumptions(input: unknown, fallback: ImpactAssumptions = DEFAULT_ASSUMPTIONS): ImpactAssumptions {
  const src = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const out: ImpactAssumptions = { ...fallback };
  for (const key of KEYS) out[key] = parseAssumption(key, src[key]) ?? fallback[key];
  return out;
}

/** Build-time defaults from NEXT_PUBLIC_IMPACT_* (public values, not secrets). Invalid or missing -> the default. */
export function readImpactAssumptions(raw: Partial<Record<AssumptionKey, string | undefined>>): ImpactAssumptions {
  return sanitizeAssumptions(raw, DEFAULT_ASSUMPTIONS);
}

/* ---- the calculation ---- */

export interface Impact {
  energyWh: number;
  /** Estimated scooter distance: Wh / (Wh per km). */
  distanceKm: number;
  /** Petrol a two-wheeler would burn over the same distance: km / (km per L). */
  petrolLitres: number;
  /** Seconds the energy could supply the household load: Wh / W x 3600. */
  houseSeconds: number;
  /** Seconds the energy could supply the LED bulb. */
  ledSeconds: number;
}

const finiteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Energy (Wh) -> estimated equivalents. Unknown, negative or non-finite energy -> null (never 0 or a guess). */
export function computeImpact(energyWh: number | null | undefined, a: ImpactAssumptions = DEFAULT_ASSUMPTIONS): Impact | null {
  if (!finiteNonNegative(energyWh)) return null;
  if (!KEYS.every((k) => Number.isFinite(a[k]) && a[k] > 0)) return null;
  const distanceKm = energyWh / a.scooterWhPerKm;
  return {
    energyWh,
    distanceKm,
    petrolLitres: distanceKm / a.petrolKmPerLitre,
    houseSeconds: (energyWh / a.houseLoadW) * SECONDS_PER_HOUR,
    ledSeconds: (energyWh / a.ledW) * SECONDS_PER_HOUR,
  };
}

/* ---- text (en-US digits so every browser and test agrees) ---- */

const DASH = '—';
const formatters = new Map<number, Intl.NumberFormat>();
function fmtNum(v: number, digits: number): string {
  let f = formatters.get(digits);
  if (!f) { f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits }); formatters.set(digits, f); }
  return f.format(Number(v.toFixed(digits)));
}

/** Wh below 1000, kWh from 1000. A tiny non-zero value is "< 0.001 Wh", never "0 Wh". */
export function formatEnergy(wh: number | null | undefined): string {
  if (!finiteNonNegative(wh)) return DASH;
  if (wh === 0) return '0 Wh';
  const digits = wh < 1 ? 3 : wh < 10 ? 2 : 1;
  const rounded = Number(wh.toFixed(digits));
  if (rounded === 0) return '< 0.001 Wh';
  if (rounded < WH_PER_KWH) return `${fmtNum(wh, digits)} Wh`;
  const kwh = wh / WH_PER_KWH;
  return `${fmtNum(kwh, kwh < 10 ? 2 : 1)} kWh`;
}

/** Metres below 1 km, kilometres from 1 km. */
export function formatDistance(km: number | null | undefined): string {
  if (!finiteNonNegative(km)) return DASH;
  if (km === 0) return '0 m';
  if (km < 1) {
    const m = km * M_PER_KM;
    const digits = m < 100 ? 1 : 0;
    const rounded = Number(m.toFixed(digits));
    if (rounded === 0) return '< 0.1 m';
    if (rounded < M_PER_KM) return `${fmtNum(m, digits)} m`;
  }
  return `${fmtNum(km, km < 10 ? 2 : km < 100 ? 1 : 0)} km`;
}

/** Millilitres below 1 L, litres from 1 L. */
export function formatVolume(litres: number | null | undefined): string {
  if (!finiteNonNegative(litres)) return DASH;
  if (litres === 0) return '0 mL';
  if (litres < 1) {
    const ml = litres * ML_PER_LITRE;
    const digits = ml < 10 ? 2 : ml < 100 ? 1 : 0;
    const rounded = Number(ml.toFixed(digits));
    if (rounded === 0) return '< 0.01 mL';
    if (rounded < ML_PER_LITRE) return `${fmtNum(ml, digits)} mL`;
  }
  return `${fmtNum(litres, litres < 10 ? 2 : litres < 100 ? 1 : 0)} L`;
}

/** "36 s", "3 min 4 s", "2 h 5 min", "4 d 15 h": the two largest non-zero units. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!finiteNonNegative(seconds)) return DASH;
  if (seconds === 0) return '0 s';
  if (seconds < 10) {
    const r = Number(seconds.toFixed(1));
    return r === 0 ? '< 0.1 s' : `${fmtNum(r, 1)} s`;
  }
  let total = Math.round(seconds);
  const d = Math.floor(total / 86_400); total -= d * 86_400;
  const h = Math.floor(total / 3600); total -= h * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/* ---- the road: markers at 10 m, 25 m, 50 m, 100 m, 250 m, 500 m, 1 km, 2.5 km, ... ---- */

const STEPS = [1, 2.5, 5];
export function milestoneKm(index: number): number {
  return STEPS[index % 3] * 10 ** (Math.floor(index / 3) - 2);
}

export interface RoadProgress {
  /** Marker the scooter has passed (0 at the start). */
  fromKm: number;
  /** Next marker. */
  toKm: number;
  /** Position between the two markers, 0..1. */
  fraction: number;
}

/** Where the scooter stands between the last and the next marker. Position comes only from the estimated distance. */
export function roadProgress(distanceKm: number | null | undefined): RoadProgress {
  const d = finiteNonNegative(distanceKm) ? distanceKm : 0;
  let i = 0;
  while (milestoneKm(i) <= d && i < 60) i += 1;
  const toKm = milestoneKm(i);
  const fromKm = i === 0 ? 0 : milestoneKm(i - 1);
  return { fromKm, toKm, fraction: Math.min(1, Math.max(0, (d - fromKm) / (toKm - fromKm))) };
}

/* ---- which energy drives the scene ---- */

export type EnergyBasis = 'total' | 'today' | 'session';
export interface EnergyPick { basis: EnergyBasis; energyWh: number | null; label: string }

/**
 * total: all stored sessions (liveStatus). session: the current session (liveStatus).
 * today: the newest stored day of dailySummaries, labelled with its own date (no guess about the viewer's time zone).
 */
export function pickEnergy(
  basis: EnergyBasis,
  live: { totalEnergyWh: number | null; sessionEnergyWh: number | null } | null,
  daily: ReadonlyArray<{ date: string; energyWh: number }> | null,
): EnergyPick {
  const ok = (v: number | null | undefined) => (finiteNonNegative(v) ? v : null);
  if (basis === 'total') return { basis, energyWh: ok(live?.totalEnergyWh), label: 'All stored sessions' };
  if (basis === 'session') return { basis, energyWh: ok(live?.sessionEnergyWh), label: 'Current session' };
  const newest = [...(daily ?? [])].sort((x, y) => y.date.localeCompare(x.date))[0];
  return { basis, energyWh: newest ? ok(newest.energyWh) : null, label: newest ? `Latest stored day ${newest.date}` : 'Latest stored day' };
}

/* ---- honest states ---- */

export type ImpactState = 'loading' | 'no-data' | 'live' | 'idle' | 'stale' | 'offline';
export interface StateInput {
  hasView: boolean;
  /** At least one answer (data, 404 or error) has come back. */
  checked: boolean;
  /** The server said there is nothing yet (404 / no device). */
  noData: boolean;
  freshness: 'live' | 'stale' | 'offline' | null;
  powerW: number | null;
  generating: boolean;
  inputPresent: boolean;
  measurementValid: boolean;
}
export interface SceneState {
  state: ImpactState;
  /** True only while energy is really being generated now: the only time anything moves. */
  animate: boolean;
  title: string;
  detail: string;
}

export function sceneState(i: StateInput): SceneState {
  if (!i.hasView) {
    return i.noData
      ? { state: 'no-data', animate: false, title: 'No data yet', detail: 'The device has not uploaded anything yet, so there is nothing to estimate.' }
      : { state: 'loading', animate: false, title: i.checked ? 'Unavailable' : 'Loading', detail: 'Waiting for the first reading from the cloud.' };
  }
  if (i.freshness === 'offline') return { state: 'offline', animate: false, title: 'Offline', detail: 'The device has not reported for more than 10 minutes. Totals are the last stored ones and nothing is moving.' };
  if (i.freshness === 'stale') return { state: 'stale', animate: false, title: 'Stale', detail: 'Updates are late. Totals are the last stored ones and nothing is moving.' };
  if (!i.measurementValid) return { state: 'idle', animate: false, title: 'Idle', detail: 'The newest sample is not a valid measurement.' };
  if (!i.inputPresent) return { state: 'idle', animate: false, title: 'Idle', detail: 'No power input is detected at the sensor.' };
  if (!i.generating || !(typeof i.powerW === 'number' && i.powerW > 0)) return { state: 'idle', animate: false, title: 'Idle', detail: 'Connected, but no power is being generated right now (0 W).' };
  return { state: 'live', animate: true, title: 'Live', detail: 'Energy is being generated right now.' };
}

/** One sentence for screen readers and the visually hidden summary. */
export function summarize(impact: Impact | null, a: ImpactAssumptions, basisLabel: string): string {
  if (!impact) return 'No generated-energy reading is available, so no equivalent can be estimated.';
  return `Estimated equivalents, not real travel, fuel or supply, for ${formatEnergy(impact.energyWh)} generated (${basisLabel}). `
    + `An electric scooter at ${a.scooterWhPerKm} Wh/km would travel about ${formatDistance(impact.distanceKm)}. `
    + `A petrol two-wheeler at ${a.petrolKmPerLitre} km/L would use about ${formatVolume(impact.petrolLitres)} of petrol over that distance. `
    + `A ${a.houseLoadW} W household load would run for ${formatDuration(impact.houseSeconds)} and a ${a.ledW} W LED bulb for ${formatDuration(impact.ledSeconds)}.`;
}
