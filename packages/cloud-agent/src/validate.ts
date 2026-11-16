import {
  DEVICE_ID_RE,
  LIMITS,
  MAX_RECORDS_PER_REQUEST,
  isSessionOf,
  parseBigint,
  safeDocId,
} from '@force/cloud';
import type {
  CommitPayload,
  DailyPayload,
  DevicePayload,
  LivePayload,
  RecordsPayload,
  ResetPayload,
  SessionRecord,
} from '@force/cloud';
import { DEFAULT_PROFILE, validateProfile } from '@force/engine';
import type { MinuteBucket } from '@force/engine';
import type {
  AlertKind,
  DeviceProfile,
  GapRecord,
  LiveSnapshot,
  StepEvent,
} from '@force/contracts';

/**
 * Request bodies are untrusted. Every payload is rebuilt field by field from known fields only,
 * checked for ownership (a session and its records belong to the device named in its id) and
 * for physical plausibility (LIMITS) before a single Firestore write. A failure is a
 * ValidationError (HTTP 400, parked by the dashboard, never retried in a loop).
 *
 * Limits cannot prove that data came from the hardware: the protocol has no signing. They refuse
 * what the hardware cannot produce; the pairing token limits who may send at all.
 */

export class ValidationError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
  throw new ValidationError(`${path}: ${what}`);
}
function obj(x: unknown, path: string): Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) fail(path, 'must be an object');
  return x as Obj;
}
function num(x: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(path, 'must be a finite number');
  if (x < min || x > max) fail(path, `must be between ${min} and ${max}`);
  return x;
}
function int(x: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = num(x, path);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    fail(path, `must be an integer from ${min} to ${max}`);
  }
  return n;
}
function numOrNull(x: unknown, path: string, min = -Infinity, max = Infinity): number | null {
  return x === null ? null : num(x, path, min, max);
}
function str(x: unknown, path: string, max = 200): string {
  if (typeof x !== 'string' || x.length > max) {
    fail(path, `must be a string of at most ${max} chars`);
  }
  return x;
}
function bool(x: unknown, path: string): boolean {
  if (typeof x !== 'boolean') fail(path, 'must be true or false');
  return x;
}
function docId(x: unknown, path: string): string {
  const s = str(x, path);
  try {
    return safeDocId(s);
  } catch {
    fail(path, 'is not a safe document id');
  }
}
function arr(x: unknown, path: string): unknown[] {
  if (!Array.isArray(x)) fail(path, 'must be an array');
  return x;
}
function oneOf<T extends string>(x: unknown, path: string, allowed: readonly T[]): T {
  if (typeof x !== 'string' || !(allowed as readonly string[]).includes(x)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
  return x as T;
}
function intString(x: unknown, path: string): bigint {
  const s = str(x, path, 48);
  let v: bigint;
  try {
    v = parseBigint(s);
  } catch {
    fail(path, 'must be a decimal integer string');
  }
  if (v < 0n) fail(path, 'must not be negative');
  return v;
}
/** Epoch ms from 2020 up to one day after `now`. */
function time(x: unknown, path: string, now: number): number {
  return int(x, path, LIMITS.minEpochMs, now + LIMITS.maxFutureMs);
}
/** Relative closeness for float values derived from the same exact integers. */
function close(a: number, b: number, rel = 1e-9, abs = 1e-12): boolean {
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

export function deviceIdOf(x: unknown, path: string): string {
  const s = str(x, path, 16);
  if (!DEVICE_ID_RE.test(s)) fail(path, 'must be a device id like FORCE-71B6');
  return s;
}
export function sessionIdOf(x: unknown, path: string, deviceId: string): string {
  const s = docId(x, path);
  if (!isSessionOf(deviceId, s)) fail(path, `does not belong to device ${deviceId}`);
  return s;
}

const SESSION_STATUS = ['open', 'closed', 'interrupted'] as const;
const GAP_CAUSES = ['lost_packets', 'link_down', 'device_restart', 'stale'] as const;
const CONNECTION = [
  'unsupported',
  'idle',
  'choosing',
  'connecting',
  'streaming',
  'stale',
  'reconnecting',
  'error',
] as const;
const SEVERITY = ['info', 'warning', 'error'] as const;
export const ALERT_KINDS: readonly AlertKind[] = [
  'sensor_limit',
  'sensor_fault',
  'no_data',
  'no_generation',
  'low_sample_rate',
  'device_restart',
  'no_input',
  'over_voltage',
  'storage_low',
  'storage_error',
  'clock_drift',
  'source_error',
];
const FIRMWARE_RE = /^[0-9A-Za-z._-]{1,32}$/;

const maxW = LIMITS.maxPowerW;
const maxUw = LIMITS.maxPowerW * 1e6;
/** Most steps possible in a span of time (rounded up to whole minutes, plus one). */
const maxSteps = (ms: number) =>
  (Math.ceil(Math.max(0, ms) / 60_000) + 1) * LIMITS.maxStepsPerMinute;
/** Most energy possible in `recordedMs`: maximum power for the whole time, in Wh. */
const maxWh = (recordedMs: number) => (maxW * recordedMs) / 3.6e6;

export interface Bounds {
  startedAt: number;
  endedAt: number;
}

function parseBounds(x: unknown, now: number): Bounds {
  const o = obj(x, 'bounds');
  const startedAt = time(o.startedAt, 'bounds.startedAt', now);
  const endedAt = time(o.endedAt, 'bounds.endedAt', now);
  if (endedAt < startedAt) fail('bounds', 'end before start');
  if (endedAt - startedAt > LIMITS.maxSessionMs) fail('bounds', 'session longer than 7 days');
  return { startedAt, endedAt };
}

export function parseSession(x: unknown, now: number, path = 'session'): SessionRecord {
  const o = obj(x, path);
  if (o.source !== 'device') fail(`${path}.source`, 'only real device sessions are synced');
  const status = oneOf(o.status, `${path}.status`, SESSION_STATUS);
  if (status === 'open') fail(`${path}.status`, 'an open session is not synced until it ends');
  const deviceId = deviceIdOf(o.deviceId, `${path}.deviceId`);
  const id = sessionIdOf(o.id, `${path}.id`, deviceId);
  const startedAt = time(o.startedAt, `${path}.startedAt`, now);
  if (o.endedAt === null) fail(`${path}.endedAt`, 'a finished session must have an end time');
  const endedAt = time(o.endedAt, `${path}.endedAt`, now);
  if (endedAt < startedAt) fail(`${path}.endedAt`, 'is before startedAt');
  const duration = endedAt - startedAt;
  if (duration > LIMITS.maxSessionMs) fail(path, 'session longer than 7 days');
  const recordedMs = num(o.recordedMs, `${path}.recordedMs`, 0, duration + 1000);
  const firmware = o.firmwareVersion;
  if (firmware !== null && firmware !== undefined) {
    if (typeof firmware !== 'string' || !FIRMWARE_RE.test(firmware)) {
      fail(`${path}.firmwareVersion`, 'is not a firmware version');
    }
  }
  return {
    id,
    source: 'device',
    deviceId,
    startedAt,
    endedAt,
    status,
    energyWh: num(o.energyWh, `${path}.energyWh`, 0, maxWh(recordedMs) + 1e-12),
    peakPowerW: num(o.peakPowerW, `${path}.peakPowerW`, 0, maxW),
    steps: int(o.steps, `${path}.steps`, 0, maxSteps(duration)),
    recordedMs,
    bridgedMs: num(o.bridgedMs, `${path}.bridgedMs`, 0, recordedMs),
    excludedGapMs: num(o.excludedGapMs, `${path}.excludedGapMs`, 0, duration + 1000),
    name: o.name === null || o.name === undefined ? null : str(o.name, `${path}.name`, 200),
    firmwareVersion: (firmware as string | null | undefined) ?? null,
  };
}

function parseStep(x: unknown, path: string, deviceId: string, b: Bounds): StepEvent {
  const o = obj(x, path);
  const stepId = docId(o.id, `${path}.id`);
  if (!stepId.startsWith(`${deviceId}_`)) fail(`${path}.id`, 'does not belong to this device');
  const t = int(o.t, `${path}.t`, b.startedAt, b.endedAt);
  const durationMs = num(o.durationMs, `${path}.durationMs`, 0, LIMITS.maxStepDurationMs);
  const peakW = num(o.peakW, `${path}.peakW`, 0, maxW);
  const avgW = num(o.avgW, `${path}.avgW`, 0, maxW);
  if (avgW > peakW * (1 + 1e-9) + 1e-12) fail(`${path}.avgW`, 'is above the peak power');
  return {
    id: stepId,
    t,
    stepNumber: int(o.stepNumber, `${path}.stepNumber`, 1, maxSteps(b.endedAt - b.startedAt)),
    peakW,
    avgW,
    durationMs,
    energyJ: num(o.energyJ, `${path}.energyJ`, 0, maxW * (durationMs / 1000 + 1)),
    voltageV: num(o.voltageV, `${path}.voltageV`, 0, LIMITS.maxVoltageV),
    currentMa: num(o.currentMa, `${path}.currentMa`, LIMITS.minCurrentMa, LIMITS.maxCurrentMa),
  };
}

function parseMinute(x: unknown, path: string, b: Bounds): MinuteBucket {
  const o = obj(x, path);
  const minute = int(
    o.minute,
    `${path}.minute`,
    Math.floor(b.startedAt / 60_000),
    Math.floor(b.endedAt / 60_000),
  );
  const recordedMs = num(o.recordedMs, `${path}.recordedMs`, 0, LIMITS.maxMinuteRecordedMs);
  return {
    minute,
    // trapezoid sums of (P_prev + P_cur) x dt are at most 2 x max power x time
    energyNj2: int(o.energyNj2, `${path}.energyNj2`, 0, Math.ceil(2 * maxUw * recordedMs)),
    recordedMs,
    peakPowerUw: int(o.peakPowerUw, `${path}.peakPowerUw`, 0, maxUw),
    steps: int(o.steps, `${path}.steps`, 0, LIMITS.maxStepsPerMinute),
    samples: int(
      o.samples,
      `${path}.samples`,
      0,
      Math.ceil((LIMITS.maxSampleRateHz * LIMITS.maxMinuteRecordedMs) / 1000),
    ),
    gapMs: num(o.gapMs, `${path}.gapMs`, 0, b.endedAt - b.startedAt + 60_000),
  };
}

function parseGap(x: unknown, path: string, b: Bounds): GapRecord {
  const o = obj(x, path);
  // a gap closed when the session ends may end up to a minute after the last stored sample
  const startMs = int(o.startMs, `${path}.startMs`, b.startedAt, b.endedAt + 60_000);
  const endMs = int(o.endMs, `${path}.endMs`, startMs, b.endedAt + 60_000);
  return { startMs, endMs, cause: oneOf(o.cause, `${path}.cause`, GAP_CAUSES) };
}

export function parseReset(x: unknown): ResetPayload {
  const o = obj(x, 'body');
  const deviceId = deviceIdOf(o.deviceId, 'deviceId');
  return { deviceId, sessionId: sessionIdOf(o.sessionId, 'sessionId', deviceId) };
}

export function parseRecords(x: unknown, now: number): RecordsPayload {
  const o = obj(x, 'body');
  const deviceId = deviceIdOf(o.deviceId, 'deviceId');
  const sessionId = sessionIdOf(o.sessionId, 'sessionId', deviceId);
  const bounds = parseBounds(o.bounds, now);
  const steps = arr(o.steps, 'steps');
  const minutes = arr(o.minutes, 'minutes');
  const gaps = arr(o.gaps, 'gaps');
  if (steps.length + minutes.length + gaps.length > MAX_RECORDS_PER_REQUEST) {
    fail('body', `at most ${MAX_RECORDS_PER_REQUEST} records per request`);
  }
  return {
    deviceId,
    sessionId,
    bounds,
    steps: steps.map((s, i) => parseStep(s, `steps[${i}]`, deviceId, bounds)),
    minutes: minutes.map((m, i) => parseMinute(m, `minutes[${i}]`, bounds)),
    gaps: gaps.map((g, i) => parseGap(g, `gaps[${i}]`, bounds)),
  };
}

/** Rebuilds a profile from the known fields only (unknown fields are dropped), then validates it. */
export function parseProfile(x: unknown, path: string): DeviceProfile {
  const o = obj(x, path);
  const d = DEFAULT_PROFILE;
  const n = (k: keyof DeviceProfile) =>
    o[k] === undefined ? (d[k] as number) : num(o[k], `${path}.${String(k)}`);
  const nn = (k: 'kcalPerStep' | 'sensorLimitOverrideMa') =>
    o[k] === undefined ? d[k] : numOrNull(o[k], `${path}.${k}`);
  const sub = (k: 'scoreWeights' | 'scoreTargets' | 'units') =>
    o[k] === undefined ? {} : obj(o[k], `${path}.${k}`);
  const w = sub('scoreWeights');
  const t = sub('scoreTargets');
  const u = sub('units');
  const sn = (src: Obj, k: string, def: number, p: string) =>
    src[k] === undefined ? def : num(src[k], `${path}.${p}.${k}`);
  const p: DeviceProfile = {
    idleThresholdW: n('idleThresholdW'),
    stepThresholdW: n('stepThresholdW'),
    minStepGapMs: n('minStepGapMs'),
    idleHoldMs: n('idleHoldMs'),
    emissionFactorKgPerKwh: num(
      o.emissionFactorKgPerKwh ?? d.emissionFactorKgPerKwh,
      `${path}.emissionFactorKgPerKwh`,
      0,
      LIMITS.maxEmissionFactor,
    ),
    ledWatts: n('ledWatts'),
    phoneBatteryWh: n('phoneBatteryWh'),
    kcalPerStep: nn('kcalPerStep'),
    scoreWeights: {
      carbon: sn(w, 'carbon', d.scoreWeights.carbon, 'scoreWeights'),
      energy: sn(w, 'energy', d.scoreWeights.energy, 'scoreWeights'),
      wellness: sn(w, 'wellness', d.scoreWeights.wellness, 'scoreWeights'),
    },
    scoreTargets: {
      co2Kg: sn(t, 'co2Kg', d.scoreTargets.co2Kg, 'scoreTargets'),
      ledHours: sn(t, 'ledHours', d.scoreTargets.ledHours, 'scoreTargets'),
      steps: sn(t, 'steps', d.scoreTargets.steps, 'scoreTargets'),
    },
    sensorLimitOverrideMa: nn('sensorLimitOverrideMa'),
    noDataAlertMs: n('noDataAlertMs'),
    noGenerationAlertMs: n('noGenerationAlertMs'),
    minPulseMs: n('minPulseMs'),
    minInputV: n('minInputV'),
    units: {
      power:
        u.power === undefined ? d.units.power : oneOf(u.power, `${path}.units.power`, ['W', 'mW']),
      energy:
        u.energy === undefined
          ? d.units.energy
          : oneOf(u.energy, `${path}.units.energy`, ['Wh', 'J', 'mWh']),
    },
  };
  const problems = validateProfile(p);
  if (problems.length > 0) fail(path, problems.join('; '));
  return p;
}

function parseDevice(x: unknown, path: string, now: number): DevicePayload {
  const o = obj(x, path);
  const info = obj(o.info, `${path}.info`);
  const deviceId = deviceIdOf(info.deviceId, `${path}.info.deviceId`);
  // the public name is always the device id (no free text in a public document)
  const firmwareVersion = str(info.firmwareVersion, `${path}.info.firmwareVersion`, 32);
  if (!FIRMWARE_RE.test(firmwareVersion))
    fail(`${path}.info.firmwareVersion`, 'is not a firmware version');
  return {
    info: {
      deviceId,
      name: deviceId,
      firmwareVersion,
      sampleRateHz: int(info.sampleRateHz, `${path}.info.sampleRateHz`, 1, LIMITS.maxSampleRateHz),
      sensorLimitMa: int(
        info.sensorLimitMa,
        `${path}.info.sensorLimitMa`,
        1,
        LIMITS.maxSensorLimitMa,
      ),
    },
    lastSeenMs: time(o.lastSeenMs, `${path}.lastSeenMs`, now),
    profile: parseProfile(o.profile, `${path}.profile`),
  };
}

/** YYYY-MM-DD of `ms` in `timeZone`; throws ValidationError for an unknown zone. */
function dateIn(ms: number, timeZone: string, path: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    fail(path, 'is not a known time zone');
  }
}

function parseDaily(x: unknown, path: string, session: SessionRecord, now: number): DailyPayload {
  const o = obj(x, path);
  if (o.deviceId !== session.deviceId) fail(`${path}.deviceId`, 'must match the session device');
  const date = str(o.date, `${path}.date`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`${path}.date`, 'must be YYYY-MM-DD');
  const timeZone = str(o.timeZone, `${path}.timeZone`, 64);
  const dayStartMs = time(o.dayStartMs, `${path}.dayStartMs`, now);
  const dayEndMs = time(o.dayEndMs, `${path}.dayEndMs`, now + 2 * 86_400_000);
  const len = dayEndMs - dayStartMs;
  if (len < 23 * 3_600_000 || len > 25 * 3_600_000) fail(path, 'day bounds are not one local day');
  if (dateIn(dayStartMs, timeZone, `${path}.timeZone`) !== date) {
    fail(`${path}.date`, `does not match dayStartMs in ${timeZone}`);
  }
  if (dayStartMs > (session.endedAt ?? session.startedAt) || dayEndMs <= session.startedAt) {
    fail(path, 'day does not overlap the session');
  }
  const t = obj(o.totals, `${path}.totals`);
  if (t.fromMs !== dayStartMs || t.toMs !== dayEndMs)
    fail(`${path}.totals`, 'range must be the day');
  const recordedMs = num(t.recordedMs, `${path}.totals.recordedMs`, 0, len + 1000);
  const energyWh = num(t.energyWh, `${path}.totals.energyWh`, 0, maxWh(recordedMs) + 1e-12);
  const energyNj2 = intString(o.energyNj2, `${path}.energyNj2`);
  if (!close(Number(energyNj2) / 2e9 / 3600, energyWh)) {
    fail(`${path}.energyNj2`, 'does not match totals.energyWh');
  }
  const factor = num(
    o.emissionFactorKgPerKwh,
    `${path}.emissionFactorKgPerKwh`,
    0,
    LIMITS.maxEmissionFactor,
  );
  const co2 = num(o.co2AvoidedKg, `${path}.co2AvoidedKg`, 0);
  if (!close(co2, (energyWh / 1000) * factor))
    fail(`${path}.co2AvoidedKg`, 'does not match the energy');
  return {
    deviceId: session.deviceId,
    date,
    timeZone,
    dayStartMs,
    dayEndMs,
    totals: {
      fromMs: dayStartMs,
      toMs: dayEndMs,
      steps: int(t.steps, `${path}.totals.steps`, 0, maxSteps(len)),
      energyWh,
      recordedMs,
      peakPowerW: num(t.peakPowerW, `${path}.totals.peakPowerW`, 0, maxW),
      sessions: int(t.sessions, `${path}.totals.sessions`, 1, 100_000),
    },
    energyNj2: energyNj2.toString(10),
    co2AvoidedKg: co2,
    emissionFactorKgPerKwh: factor,
    computedAtMs: time(o.computedAtMs, `${path}.computedAtMs`, now),
  };
}

export function parseCommit(x: unknown, now: number): CommitPayload {
  const o = obj(x, 'body');
  const session = parseSession(o.session, now);
  const duration = (session.endedAt ?? session.startedAt) - session.startedAt;
  const energyNj2 = intString(o.energyNj2, 'energyNj2');
  // both come from the same integer energy; the session total is a float conversion of it
  if (!close(Number(energyNj2) / 2e9 / 3600, session.energyWh, 1e-6, 1e-9)) {
    fail('energyNj2', 'does not match session.energyWh');
  }
  const counts = obj(o.counts, 'counts');
  const device = o.device === null ? null : parseDevice(o.device, 'device', now);
  if (device && device.info.deviceId !== session.deviceId) {
    fail('device.info.deviceId', 'must match the session device');
  }
  const daily = arr(o.daily, 'daily');
  if (daily.length < 1 || daily.length > Math.ceil(LIMITS.maxSessionMs / 86_400_000) + 2) {
    fail('daily', 'must list each day the session touches');
  }
  return {
    session,
    energyNj2: energyNj2.toString(10),
    counts: {
      steps: int(counts.steps, 'counts.steps', 0, maxSteps(duration)),
      minutes: int(counts.minutes, 'counts.minutes', 0, Math.ceil(duration / 60_000) + 2),
      gaps: int(counts.gaps, 'counts.gaps', 0, 100_000),
    },
    device,
    daily: daily.map((d, i) => parseDaily(d, `daily[${i}]`, session, now)),
  };
}

export function parseLive(x: unknown, now: number): LivePayload {
  const o = obj(x, 'body');
  const deviceId = deviceIdOf(o.deviceId, 'deviceId');
  const s = obj(o.snapshot, 'snapshot');
  if (s.source !== 'device') fail('snapshot.source', 'only real device data is synced');
  const m = obj(s.metrics, 'snapshot.metrics');
  const q = obj(s.quality, 'snapshot.quality');
  const alerts = arr(s.alerts, 'snapshot.alerts');
  if (alerts.length > LIMITS.maxAlerts) fail('snapshot.alerts', 'too many alerts');
  const p = (k: string) => `snapshot.metrics.${k}`;
  const big = 1e9;
  // Only the fields the Firestore document uses are kept; everything else is dropped.
  const snapshot = {
    t: time(s.t, 'snapshot.t', now),
    lastPacketAt:
      s.lastPacketAt === null ? null : time(s.lastPacketAt, 'snapshot.lastPacketAt', now),
    source: 'device',
    connection: oneOf(s.connection, 'snapshot.connection', CONNECTION),
    sessionId:
      s.sessionId === null ? null : sessionIdOf(s.sessionId, 'snapshot.sessionId', deviceId),
    metrics: {
      measurementValid: bool(m.measurementValid, p('measurementValid')),
      inputPresent: bool(m.inputPresent, p('inputPresent')),
      voltageV: num(m.voltageV, p('voltageV'), 0, LIMITS.maxVoltageV),
      currentMa: num(m.currentMa, p('currentMa'), LIMITS.minCurrentMa, LIMITS.maxCurrentMa),
      powerW: num(m.powerW, p('powerW'), 0, maxW),
      generating: bool(m.generating, p('generating')),
      sessionEnergyJ: num(m.sessionEnergyJ, p('sessionEnergyJ'), 0, big),
      sessionEnergyWh: num(m.sessionEnergyWh, p('sessionEnergyWh'), 0, maxWh(LIMITS.maxSessionMs)),
      totalEnergyWh: num(m.totalEnergyWh, p('totalEnergyWh'), 0, big),
      avgPowerW: num(m.avgPowerW, p('avgPowerW'), 0, maxW),
      peakPowerW: num(m.peakPowerW, p('peakPowerW'), 0, maxW),
      steps: int(m.steps, p('steps'), 0, maxSteps(LIMITS.maxSessionMs)),
      cadenceSpm: numOrNull(m.cadenceSpm, p('cadenceSpm'), 0, 2 * LIMITS.maxStepsPerMinute),
      energyPerStepJ: numOrNull(m.energyPerStepJ, p('energyPerStepJ'), 0, maxW * 11),
      stepsPerHour: {},
      co2AvoidedKg: num(m.co2AvoidedKg, p('co2AvoidedKg'), 0, big),
      ledHours: num(m.ledHours, p('ledHours'), 0, big),
      phoneCharges: num(m.phoneCharges, p('phoneCharges'), 0, big),
      kcal: numOrNull(m.kcal, p('kcal'), 0, big),
      sustainabilityScore: numOrNull(m.sustainabilityScore, p('sustainabilityScore'), 0, 100),
      rssiDbm: numOrNull(m.rssiDbm, p('rssiDbm'), -127, 20),
      sampleRateHz: num(m.sampleRateHz, p('sampleRateHz'), 0, LIMITS.maxSampleRateHz),
      sensorLimitReached: bool(m.sensorLimitReached, p('sensorLimitReached')),
    },
    quality: {
      recordedMs: num(q.recordedMs, 'snapshot.quality.recordedMs', 0, LIMITS.maxSessionMs),
      bridgedMs: 0,
      excludedGapMs: num(q.excludedGapMs, 'snapshot.quality.excludedGapMs', 0, LIMITS.maxSessionMs),
      lostPackets: int(q.lostPackets, 'snapshot.quality.lostPackets'),
      droppedPackets: int(q.droppedPackets, 'snapshot.quality.droppedPackets'),
      detail: {} as LiveSnapshot['quality']['detail'],
    },
    alerts: alerts.map((a, i) => {
      const ao = obj(a, `snapshot.alerts[${i}]`);
      return {
        id: '',
        kind: oneOf(ao.kind, `snapshot.alerts[${i}].kind`, ALERT_KINDS),
        severity: oneOf(ao.severity, `snapshot.alerts[${i}].severity`, SEVERITY),
        since: time(ao.since, `snapshot.alerts[${i}].since`, now),
        message: '',
      };
    }),
  } satisfies LiveSnapshot;
  return { deviceId, snapshot };
}
