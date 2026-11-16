/**
 * Public cloud read (see .agent-board/CLOUD_READ_SPEC.md). The hosted dashboard reads Firestore
 * through the REST API with no SDK and no credentials: the rules allow public reads of
 * devices, liveStatus and dailySummaries only. Field names come from packages/cloud/src/model.ts
 * (LiveStatusDoc, DailySummaryDoc). Nothing is calculated here: stored values are shown as is.
 */

export const LIVE_POLL_MS = 15_000;
export const DAILY_POLL_MS = 5 * 60_000;
export const BACKOFF_START_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;
/** 3 x the 30 s write interval. */
export const LIVE_MAX_AGE_MS = 90_000;
export const STALE_MAX_AGE_MS = 10 * 60_000;
export const DAILY_LIMIT = 30;

export interface CloudConfig { projectId: string; deviceId: string | null }
export type ConfigResult = { ok: true; config: CloudConfig } | { ok: false; message: string };

/** Public (not secret) settings. The caller passes literal `process.env.NEXT_PUBLIC_*` reads so Next inlines them. */
export function readCloudConfig(env: { projectId?: string; deviceId?: string }): ConfigResult {
  const projectId = (env.projectId ?? '').trim();
  const deviceId = (env.deviceId ?? '').trim();
  if (projectId === '') return { ok: false, message: 'Cloud viewer is not configured: NEXT_PUBLIC_FIREBASE_PROJECT_ID is missing from this build.' };
  if (!/^[a-z0-9][a-z0-9.:-]*$/i.test(projectId)) return { ok: false, message: 'Cloud viewer is not configured: NEXT_PUBLIC_FIREBASE_PROJECT_ID is not a valid project id.' };
  if (deviceId !== '' && !/^[A-Za-z0-9_-]+$/.test(deviceId)) return { ok: false, message: 'Cloud viewer is not configured: NEXT_PUBLIC_PUBLIC_DEVICE_ID is not a valid device id.' };
  return { ok: true, config: { projectId, deviceId: deviceId === '' ? null : deviceId } };
}

const ROOT = 'https://firestore.googleapis.com/v1';
const docs = (projectId: string) => `${ROOT}/projects/${projectId}/databases/(default)/documents`;
export const liveUrl = (c: { projectId: string }, deviceId: string) => `${docs(c.projectId)}/liveStatus/${encodeURIComponent(deviceId)}`;
export const devicesUrl = (c: { projectId: string }) => `${docs(c.projectId)}/devices?pageSize=100`;
export const dailyUrl = (c: { projectId: string }) => `${docs(c.projectId)}:runQuery`;
export function dailyQuery(deviceId: string, limit = DAILY_LIMIT) {
  return { structuredQuery: { from: [{ collectionId: 'dailySummaries' }], where: { fieldFilter: { field: { fieldPath: 'deviceId' }, op: 'EQUAL', value: { stringValue: deviceId } } }, orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }], limit } };
}

/* ---- Firestore REST value decoding ---- */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** integerValue (string) -> number, doubleValue, booleanValue, stringValue, nullValue -> null, timestampValue -> epoch ms, mapValue, arrayValue. */
export function decodeValue(v: unknown): unknown {
  if (!isObj(v)) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('booleanValue' in v) return v.booleanValue === true;
  if ('integerValue' in v) { const n = Number(v.integerValue); return Number.isFinite(n) ? n : null; }
  if ('doubleValue' in v) {
    const d = v.doubleValue;
    if (d === 'NaN' || d === 'Infinity' || d === '-Infinity') return null; // not a displayable number
    const n = Number(d); return Number.isFinite(n) ? n : null;
  }
  if ('timestampValue' in v) { const t = Date.parse(String(v.timestampValue)); return Number.isFinite(t) ? t : null; }
  if ('mapValue' in v) return decodeFields(isObj(v.mapValue) ? v.mapValue.fields : undefined);
  if ('arrayValue' in v) { const values = isObj(v.arrayValue) ? v.arrayValue.values : undefined; return Array.isArray(values) ? values.map(decodeValue) : []; }
  return null;
}

export function decodeFields(fields: unknown): Json {
  const out: Json = {};
  if (!isObj(fields)) return out;
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

/** Decodes a REST document ({ name, fields }) to a plain object. */
export function decodeDocument(doc: unknown): Json { return isObj(doc) ? decodeFields(doc.fields) : {}; }
export const docId = (doc: unknown): string => (isObj(doc) && typeof doc.name === 'string' ? doc.name.split('/').pop() ?? '' : '');

/* ---- mapping to view models ---- */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Json => (isObj(v) ? v : {});

export type CloudConnection = 'idle' | 'connecting' | 'streaming' | 'stale' | 'reconnecting' | 'error' | string;

export interface LiveView {
  deviceId: string;
  connection: CloudConnection;
  sampleAtMs: number | null;
  lastPacketAtMs: number | null;
  measurementValid: boolean;
  inputPresent: boolean;
  generating: boolean;
  /** null when the newest sample is not a valid reading: the UI shows a dash. */
  measured: { voltageV: number | null; currentMa: number | null; powerW: number | null } | null;
  rssiDbm: number | null;
  sessionEnergyWh: number | null;
  totalEnergyWh: number | null;
  peakPowerW: number | null;
  steps: number | null;
  cadenceSpm: number | null;
  co2AvoidedKg: number | null;
  alerts: Array<{ kind: string; severity: string }>;
}

/** liveStatus document (decoded) -> LiveView. Returns null when it is not a live status document. */
export function toLiveView(d: Json): LiveView | null {
  const deviceId = str(d.deviceId);
  if (deviceId === null) return null;
  const measured = isObj(d.measured) ? { voltageV: num(d.measured.voltageV), currentMa: num(d.measured.currentMa), powerW: num(d.measured.powerW) } : null;
  const calc = obj(d.calculated); const est = obj(d.estimated); const link = obj(d.link);
  return {
    deviceId,
    connection: str(d.connection) ?? 'idle',
    sampleAtMs: num(d.sampleAt), lastPacketAtMs: num(d.lastPacketAt),
    measurementValid: d.measurementValid === true, inputPresent: d.inputPresent === true, generating: d.generating === true,
    measured,
    rssiDbm: num(link.rssiDbm),
    sessionEnergyWh: num(calc.sessionEnergyWh), totalEnergyWh: num(calc.totalEnergyWh), peakPowerW: num(calc.peakPowerW),
    steps: num(calc.steps), cadenceSpm: num(calc.cadenceSpm),
    co2AvoidedKg: num(est.co2AvoidedKg),
    alerts: Array.isArray(d.alerts) ? d.alerts.filter(isObj).map((a) => ({ kind: str(a.kind) ?? 'unknown', severity: str(a.severity) ?? 'info' })) : [],
  };
}

export interface DailyRow { date: string; dayStartMs: number | null; steps: number; energyWh: number; peakPowerW: number; sessions: number; co2AvoidedKg: number | null }

export function toDailyRow(d: Json): DailyRow | null {
  const date = str(d.date);
  if (date === null) return null;
  return { date, dayStartMs: num(d.dayStart), steps: num(d.steps) ?? 0, energyWh: num(d.energyWh) ?? 0, peakPowerW: num(d.peakPowerW) ?? 0, sessions: num(d.sessions) ?? 0, co2AvoidedKg: num(obj(d.estimated).co2AvoidedKg) };
}

/** runQuery response -> rows, newest first as returned. Entries without a document are skipped. */
export function parseDailyResponse(body: unknown): DailyRow[] {
  if (!Array.isArray(body)) return [];
  const rows: DailyRow[] = [];
  for (const item of body) {
    if (!isObj(item) || !isObj(item.document)) continue;
    const row = toDailyRow(decodeDocument(item.document));
    if (row) rows.push(row);
  }
  return rows;
}

/** Dates are YYYY-MM-DD in the device time zone: the local-noon epoch is only a fallback chart position. */
export const rowTimeMs = (r: DailyRow): number => r.dayStartMs ?? Date.parse(`${r.date}T12:00:00`);

/* ---- freshness ---- */

export type Freshness = 'live' | 'stale' | 'offline';

export function dataAgeMs(v: Pick<LiveView, 'lastPacketAtMs' | 'sampleAtMs'>, nowMs: number): number | null {
  const at = v.lastPacketAtMs ?? v.sampleAtMs;
  return at === null ? null : Math.max(0, nowMs - at);
}

/** Live: streaming and age <= 90 s. Stale: age <= 10 min. Offline: older (or no timestamp). */
export function freshness(v: LiveView, nowMs: number): Freshness {
  const age = dataAgeMs(v, nowMs);
  if (age === null) return 'offline';
  if (v.connection === 'streaming' && age <= LIVE_MAX_AGE_MS) return 'live';
  return age <= STALE_MAX_AGE_MS ? 'stale' : 'offline';
}

export function formatAge(ms: number | null): string {
  if (ms === null) return 'unknown';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}

/** Retry delay: 5 s, then doubling, capped at 60 s. */
export function nextBackoff(prevMs: number | null): number {
  return prevMs === null ? BACKOFF_START_MS : Math.min(BACKOFF_MAX_MS, prevMs * 2);
}

/* ---- fetching ---- */

export type FetchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'missing' }      // 404: no document yet
  | { kind: 'forbidden' }    // 403: rules not deployed or reads not permitted
  | { kind: 'error'; message: string };  // network, 5xx or an unexpected answer

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function request<T>(fetchImpl: FetchLike, url: string, init: RequestInit | undefined, parse: (body: unknown) => T | null): Promise<FetchResult<T>> {
  let res: Response;
  try { res = await fetchImpl(url, { cache: 'no-store', ...init }); } catch (e) { return { kind: 'error', message: e instanceof Error ? e.message : 'network error' }; }
  if (res.status === 404) return { kind: 'missing' };
  if (res.status === 403 || res.status === 401) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
  let body: unknown;
  try { body = await res.json(); } catch { return { kind: 'error', message: 'unreadable response' }; }
  const value = parse(body);
  return value === null ? { kind: 'error', message: 'unexpected response' } : { kind: 'ok', value };
}

export function fetchLive(c: { projectId: string }, deviceId: string, fetchImpl: FetchLike = fetch): Promise<FetchResult<LiveView>> {
  return request(fetchImpl, liveUrl(c, deviceId), undefined, (body) => toLiveView(decodeDocument(body)));
}

/** First device id (sorted) from the public device list, or 'missing' when there is none. */
export async function fetchDeviceId(c: { projectId: string }, fetchImpl: FetchLike = fetch): Promise<FetchResult<string>> {
  const r = await request<string[]>(fetchImpl, devicesUrl(c), undefined, (body) => {
    if (!isObj(body)) return null;
    return (Array.isArray(body.documents) ? body.documents : []).map(docId).filter((id) => id !== '');
  });
  if (r.kind !== 'ok') return r;
  const first = [...r.value].sort()[0];
  return first ? { kind: 'ok', value: first } : { kind: 'missing' };
}

export function fetchDaily(c: { projectId: string }, deviceId: string, fetchImpl: FetchLike = fetch): Promise<FetchResult<DailyRow[]>> {
  return request(fetchImpl, dailyUrl(c), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dailyQuery(deviceId)) }, (body) => (Array.isArray(body) ? parseDailyResponse(body) : null));
}
