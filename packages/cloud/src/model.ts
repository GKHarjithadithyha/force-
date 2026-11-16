import type {
  Alert,
  DeviceInfo,
  DeviceProfile,
  GapRecord,
  LiveSnapshot,
  RangeTotals,
  SessionSummary,
  StepEvent,
} from '@force/contracts';
import type { MinuteBucket } from '@force/engine';

/**
 * F.O.R.C.E Firestore model, version 1. See FIREBASE_SETUP.md for the full description.
 *
 * Two parts live here, both free of any Firebase SDK:
 * - the JSON payloads the dashboard sends to the local sync agent (existing local records,
 *   unchanged), and
 * - the pure mappers the agent uses to turn those payloads into Firestore documents.
 *
 * Rules
 * - Only real-device data. Every mapper refuses a session whose `source` is not 'device'.
 * - Stable document ids, so every write is an idempotent overwrite (`set`), never an append.
 * - Timestamps are produced by the caller's factory (`Timestamp.fromMillis` in the agent), from
 *   the existing epoch-millisecond UTC values. Nothing is rounded.
 * - Exact energy: minute buckets keep `energyNj2` as an integer (always a safe integer for one
 *   minute); session and daily totals keep it as a decimal STRING of the exact BigInt sum,
 *   because Firestore cannot store a BigInt.
 * - Values are grouped as `measured` (reported by the device), `calculated` (by the existing
 *   engine) or `estimated` (calculated with a placeholder or assumed factor).
 */

export const CLOUD_SCHEMA_VERSION = 1;

export const COLLECTIONS = {
  devices: 'devices',
  liveStatus: 'liveStatus',
  sessions: 'sessions',
  footsteps: 'footsteps',
  energyMinutes: 'energyMinutes',
  dailySummaries: 'dailySummaries',
  dataGaps: 'dataGaps',
  /** PRIVATE: settings profile and installation site of a device (never public). */
  deviceConfigs: 'deviceConfigs',
} as const;

// =============================================================================================
// Identity and plausibility limits (enforced by the agent before any write)
// =============================================================================================

/** Device ids are the advertised BLE names (protocol: "FORCE-" + 4 upper-case hex digits). */
export const DEVICE_ID_RE = /^FORCE-[0-9A-F]{4}$/;

/** Session ids are made by the pipeline as `${deviceId}-...`, so a session belongs to one device. */
export function isSessionOf(deviceId: string, sessionId: string): boolean {
  return (
    DEVICE_ID_RE.test(deviceId) &&
    sessionId.startsWith(`${deviceId}-`) &&
    sessionId.length > deviceId.length + 1
  );
}

/**
 * Physical and protocol limits. They cannot prove that data came from the hardware (nothing can
 * without signing in the device protocol), but they refuse values the hardware cannot produce.
 */
export const LIMITS = {
  /** 2020-01-01T00:00:00Z: nothing earlier is F.O.R.C.E data. */
  minEpochMs: 1_577_836_800_000,
  /** Timestamps may be at most this far in the future (clock skew). */
  maxFutureMs: 86_400_000,
  /** INA219 bus register maximum (13-bit x 4 mV), as in the protocol. */
  maxVoltageV: 32.764,
  /** int16 current in the packet. */
  minCurrentMa: -32_768,
  maxCurrentMa: 32_767,
  /** Highest power the tile can report: 32.764 V x 3.2768 A sensor range, rounded up. */
  maxPowerW: 110,
  /** 240 steps/min is the detector's ceiling at the default 250 ms step gap; 300 leaves room. */
  maxStepsPerMinute: 300,
  /** A single step pulse longer than this is not a footstep. */
  maxStepDurationMs: 10_000,
  /** One session at most a week long. */
  maxSessionMs: 7 * 86_400_000,
  /** Device Info limits (protocol). */
  maxSampleRateHz: 1000,
  maxSensorLimitMa: 32_767,
  /** A clock minute can hold its 60 s plus one bridged interval (at most 1 s). */
  maxMinuteRecordedMs: 61_000,
  maxEmissionFactor: 2,
  maxAlerts: 20,
} as const;

/** Units of every numeric field, by field name (also documented in FIREBASE_SETUP.md). */
export const UNITS = {
  voltageV: 'volt',
  currentMa: 'milliampere',
  powerW: 'watt',
  peakW: 'watt',
  avgW: 'watt',
  peakPowerW: 'watt',
  avgPowerW: 'watt',
  peakPowerUw: 'microwatt (integer)',
  energyJ: 'joule',
  energyWh: 'watt-hour',
  sessionEnergyWh: 'watt-hour',
  totalEnergyWh: 'watt-hour',
  energyNj2: 'doubled nanojoule (exact integer; joules = energyNj2 / 2e9)',
  energyPerStepJ: 'joule',
  durationMs: 'millisecond',
  recordedMs: 'millisecond',
  bridgedMs: 'millisecond',
  excludedGapMs: 'millisecond',
  gapMs: 'millisecond',
  minute: 'epoch minute index (floor(epochMs / 60000), UTC)',
  sampleRateHz: 'hertz',
  sensorLimitMa: 'milliampere',
  rssiDbm: 'dBm',
  cadenceSpm: 'steps per minute',
  co2AvoidedKg: 'kilogram CO2 (estimate)',
  emissionFactorKgPerKwh: 'kilogram CO2 per kWh (placeholder until agreed)',
} as const;

// =============================================================================================
// Document ids
// =============================================================================================

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Returns the id if it is a safe Firestore document id, else throws. */
export function safeDocId(id: string): string {
  if (typeof id !== 'string' || !ID_RE.test(id) || /^__.*__$/.test(id)) {
    throw new Error(`Not a safe document id: ${JSON.stringify(String(id).slice(0, 80))}`);
  }
  return id;
}

export const docIds = {
  device: (deviceId: string) => safeDocId(deviceId),
  liveStatus: (deviceId: string) => safeDocId(deviceId),
  session: (sessionId: string) => safeDocId(sessionId),
  /** The engine's own idempotency key: deviceId + "_" + UTC time of the step. */
  footstep: (step: Pick<StepEvent, 'id'>) => safeDocId(step.id),
  energyMinute: (sessionId: string, minute: number) => {
    if (!Number.isSafeInteger(minute)) throw new Error('Minute index must be an integer');
    return safeDocId(`${sessionId}_${minute}`);
  },
  dataGap: (sessionId: string, startMs: number) => {
    if (!Number.isSafeInteger(startMs)) throw new Error('Gap start must be integer ms');
    return safeDocId(`${sessionId}_${startMs}`);
  },
  dailySummary: (deviceId: string, date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD');
    return safeDocId(`${deviceId}_${date}`);
  },
};

// =============================================================================================
// Exact integers
// =============================================================================================

/** Sum of integer `energyNj2` values as an exact BigInt. Throws on a non-integer. */
export function sumNj2(values: Iterable<number>): bigint {
  let total = 0n;
  for (const v of values) total += BigInt(requireSafeInt(v, 'energyNj2'));
  return total;
}

/** Exact decimal string of a BigInt (Firestore cannot hold BigInt). */
export function bigintToString(v: bigint): string {
  return v.toString(10);
}

/** Parses a decimal integer string back to BigInt, refusing anything else. */
export function parseBigint(s: string): bigint {
  if (typeof s !== 'string' || !/^-?\d{1,40}$/.test(s)) throw new Error('Not an integer string');
  return BigInt(s);
}

function requireSafeInt(v: number, field: string): number {
  if (!Number.isSafeInteger(v)) throw new Error(`${field} must be a safe integer`);
  return v;
}

// =============================================================================================
// Payloads: dashboard -> local sync agent (JSON). Existing local records, unchanged.
// =============================================================================================

export const SYNC_API_VERSION = 'v1';
export const SYNC_PATHS = {
  health: 'health',
  policy: 'policy',
  reset: 'reset',
  records: 'records',
  commit: 'commit',
  live: 'live',
} as const;
export type SyncPath = (typeof SYNC_PATHS)[keyof typeof SYNC_PATHS];

/** Largest number of records in one `records` request (one Firestore batch, with headroom). */
export const MAX_RECORDS_PER_REQUEST = 400;

/** A stored session as the sync reads it: the summary plus the firmware it was recorded with. */
export interface SessionRecord extends SessionSummary {
  firmwareVersion: string | null;
}

export interface ResetPayload {
  deviceId: string;
  sessionId: string;
}

/** What the agent accepts; returned by the `policy` endpoint and with every successful write. */
export interface AgentPolicy {
  /** Individual footstep documents. Off by default: per-minute step counts are always uploaded. */
  footsteps: boolean;
  /** Minimum time between live-status updates the dashboard should send. */
  liveIntervalMs: number;
}

export interface RecordsPayload {
  deviceId: string;
  sessionId: string;
  /** The session's time range: every record must lie inside it. */
  bounds: { startedAt: number; endedAt: number };
  steps: StepEvent[];
  minutes: MinuteBucket[];
  gaps: GapRecord[];
}

export interface DevicePayload {
  info: DeviceInfo;
  /** Epoch ms the dashboard last saw the device. */
  lastSeenMs: number;
  profile: DeviceProfile;
}

export interface DailyPayload {
  deviceId: string;
  date: string;
  timeZone: string;
  dayStartMs: number;
  dayEndMs: number;
  /** From the existing `getTotals` aggregation, limited to this device. */
  totals: RangeTotals;
  /** Exact energy of the same minute buckets, decimal string of doubled nanojoules. */
  energyNj2: string;
  /** M13 with the saved profile's emission factor (a PLACEHOLDER until agreed). */
  co2AvoidedKg: number;
  emissionFactorKgPerKwh: number;
  computedAtMs: number;
}

export interface CommitPayload {
  session: SessionRecord;
  /** Exact session energy: the sum of the session's minute buckets, decimal string. */
  energyNj2: string;
  counts: { steps: number; minutes: number; gaps: number };
  device: DevicePayload | null;
  daily: DailyPayload[];
}

export interface LivePayload {
  deviceId: string;
  snapshot: LiveSnapshot;
}

export interface SyncResponse {
  ok: boolean;
  written?: number;
  error?: string;
  policy?: AgentPolicy;
  /** `records` for a session already in Firestore: the dashboard must `reset` it first. */
  conflict?: boolean;
}

// =============================================================================================
// Firestore documents (T is the timestamp type: Firestore Timestamp in the agent)
// =============================================================================================

export interface DeviceDoc<T> {
  schemaVersion: number;
  deviceId: string;
  name: string;
  firmwareVersion: string;
  /** Device Info as read from the device. */
  info: { sampleRateHz: number; sensorLimitMa: number };
  lastSeenAt: T;
}

/** PRIVATE (signed-in readers only): engine settings and installation details. */
export interface DeviceConfigDoc {
  schemaVersion: number;
  deviceId: string;
  /** Settings profile used by the engine (thresholds, PLACEHOLDER factors). */
  profile: DeviceProfile;
  site: { id: string; name: string } | null;
}

export interface SessionDoc<T> {
  schemaVersion: number;
  sessionId: string;
  deviceId: string;
  source: 'device';
  status: SessionSummary['status'];
  name: string | null;
  firmwareVersion: string | null;
  startedAt: T;
  endedAt: T | null;
  durationMs: number | null;
  /** All calculated by the existing engine. */
  steps: number;
  energyWh: number;
  energyNj2: string;
  peakPowerW: number;
  recordedMs: number;
  bridgedMs: number;
  excludedGapMs: number;
  counts: { steps: number; minutes: number; gaps: number };
  /** False while individual footstep documents are disabled; `steps` and minute counts remain. */
  footstepsUploaded: boolean;
}

export interface FootstepDoc<T> {
  schemaVersion: number;
  stepId: string;
  deviceId: string;
  sessionId: string;
  stepNumber: number;
  at: T;
  /** Reported by the device at the trigger sample. */
  measured: { voltageV: number; currentMa: number };
  /** Calculated by the existing step detector. */
  calculated: { peakW: number; avgW: number; energyJ: number; durationMs: number };
}

export interface EnergyMinuteDoc<T> {
  schemaVersion: number;
  deviceId: string;
  sessionId: string;
  minute: number;
  minuteStart: T;
  /** Exact integer from the engine. */
  energyNj2: number;
  /** energyNj2 / 2e9, for display only. */
  energyJ: number;
  recordedMs: number;
  peakPowerUw: number;
  peakPowerW: number;
  steps: number;
  samples: number;
  gapMs: number;
}

export interface DataGapDoc<T> {
  schemaVersion: number;
  deviceId: string;
  sessionId: string;
  start: T;
  end: T;
  durationMs: number;
  cause: GapRecord['cause'];
}

export interface DailySummaryDoc<T> {
  schemaVersion: number;
  deviceId: string;
  date: string;
  timeZone: string;
  dayStart: T;
  dayEnd: T;
  steps: number;
  energyWh: number;
  energyNj2: string;
  recordedMs: number;
  peakPowerW: number;
  sessions: number;
  estimated: { co2AvoidedKg: number; emissionFactorKgPerKwh: number };
  computedAt: T;
}

export interface LiveStatusDoc<T> {
  schemaVersion: number;
  deviceId: string;
  connection: LiveSnapshot['connection'];
  sessionId: string | null;
  sampleAt: T;
  lastPacketAt: T | null;
  measurementValid: boolean;
  inputPresent: boolean;
  generating: boolean;
  /** Reported by the device. null unless the newest sample is a valid measurement. */
  measured: { voltageV: number; currentMa: number; powerW: number } | null;
  link: { rssiDbm: number | null; sampleRateHz: number };
  calculated: {
    sessionEnergyWh: number;
    totalEnergyWh: number;
    avgPowerW: number;
    peakPowerW: number;
    steps: number;
    cadenceSpm: number | null;
    energyPerStepJ: number | null;
  };
  estimated: {
    co2AvoidedKg: number;
    ledHours: number;
    phoneCharges: number;
    kcal: number | null;
    sustainabilityScore: number | null;
  };
  quality: {
    lostPackets: number;
    droppedPackets: number;
    recordedMs: number;
    excludedGapMs: number;
  };
  /** Alert kinds only (no free text in a public document); apps map the kind to a message. */
  alerts: Array<{ kind: Alert['kind']; severity: Alert['severity']; since: T }>;
}

export type Ts<T> = (epochMs: number) => T;

function requireDevice(s: Pick<SessionSummary, 'source' | 'id'>): void {
  if (s.source !== 'device') {
    throw new Error(`Session ${s.id} is ${String(s.source)} data: only real device data is synced`);
  }
}

/** PUBLIC device document: identity and Device Info only. */
export function toDeviceDoc<T>(p: DevicePayload, ts: Ts<T>): DeviceDoc<T> {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId: p.info.deviceId,
    name: p.info.name,
    firmwareVersion: p.info.firmwareVersion,
    info: { sampleRateHz: p.info.sampleRateHz, sensorLimitMa: p.info.sensorLimitMa },
    lastSeenAt: ts(p.lastSeenMs),
  };
}

/** PRIVATE device configuration: profile and site. */
export function toDeviceConfigDoc(
  p: DevicePayload,
  site: { id: string; name: string } | null,
): DeviceConfigDoc {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId: p.info.deviceId,
    profile: p.profile,
    site,
  };
}

export function toSessionDoc<T>(
  p: CommitPayload,
  ts: Ts<T>,
  footstepsUploaded = true,
): SessionDoc<T> {
  const s = p.session;
  requireDevice(s);
  parseBigint(p.energyNj2);
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    sessionId: s.id,
    deviceId: s.deviceId,
    source: 'device',
    status: s.status,
    name: s.name,
    firmwareVersion: s.firmwareVersion,
    startedAt: ts(s.startedAt),
    endedAt: s.endedAt === null ? null : ts(s.endedAt),
    durationMs: s.endedAt === null ? null : s.endedAt - s.startedAt,
    steps: s.steps,
    energyWh: s.energyWh,
    energyNj2: p.energyNj2,
    peakPowerW: s.peakPowerW,
    recordedMs: s.recordedMs,
    bridgedMs: s.bridgedMs,
    excludedGapMs: s.excludedGapMs,
    counts: { ...p.counts },
    footstepsUploaded,
  };
}

export function toFootstepDoc<T>(
  deviceId: string,
  sessionId: string,
  e: StepEvent,
  ts: Ts<T>,
): FootstepDoc<T> {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    stepId: e.id,
    deviceId,
    sessionId,
    stepNumber: e.stepNumber,
    at: ts(e.t),
    measured: { voltageV: e.voltageV, currentMa: e.currentMa },
    calculated: { peakW: e.peakW, avgW: e.avgW, energyJ: e.energyJ, durationMs: e.durationMs },
  };
}

export function toEnergyMinuteDoc<T>(
  deviceId: string,
  sessionId: string,
  b: MinuteBucket,
  ts: Ts<T>,
): EnergyMinuteDoc<T> {
  requireSafeInt(b.minute, 'minute');
  requireSafeInt(b.energyNj2, 'energyNj2');
  requireSafeInt(b.peakPowerUw, 'peakPowerUw');
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId,
    sessionId,
    minute: b.minute,
    minuteStart: ts(b.minute * 60_000),
    energyNj2: b.energyNj2,
    energyJ: b.energyNj2 / 2e9,
    recordedMs: b.recordedMs,
    peakPowerUw: b.peakPowerUw,
    peakPowerW: b.peakPowerUw / 1e6,
    steps: b.steps,
    samples: b.samples,
    gapMs: b.gapMs,
  };
}

export function toDataGapDoc<T>(
  deviceId: string,
  sessionId: string,
  g: GapRecord,
  ts: Ts<T>,
): DataGapDoc<T> {
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId,
    sessionId,
    start: ts(g.startMs),
    end: ts(g.endMs),
    durationMs: g.endMs - g.startMs,
    cause: g.cause,
  };
}

export function toDailySummaryDoc<T>(d: DailyPayload, ts: Ts<T>): DailySummaryDoc<T> {
  parseBigint(d.energyNj2);
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId: d.deviceId,
    date: d.date,
    timeZone: d.timeZone,
    dayStart: ts(d.dayStartMs),
    dayEnd: ts(d.dayEndMs),
    steps: d.totals.steps,
    energyWh: d.totals.energyWh,
    energyNj2: d.energyNj2,
    recordedMs: d.totals.recordedMs,
    peakPowerW: d.totals.peakPowerW,
    sessions: d.totals.sessions,
    estimated: {
      co2AvoidedKg: d.co2AvoidedKg,
      emissionFactorKgPerKwh: d.emissionFactorKgPerKwh,
    },
    computedAt: ts(d.computedAtMs),
  };
}

export function toLiveStatusDoc<T>(p: LivePayload, ts: Ts<T>): LiveStatusDoc<T> {
  const s = p.snapshot;
  if (s.source !== 'device') throw new Error('Only real device data is synced');
  const m = s.metrics;
  return {
    schemaVersion: CLOUD_SCHEMA_VERSION,
    deviceId: p.deviceId,
    connection: s.connection,
    sessionId: s.sessionId,
    sampleAt: ts(s.t),
    lastPacketAt: s.lastPacketAt === null ? null : ts(s.lastPacketAt),
    measurementValid: m.measurementValid,
    inputPresent: m.inputPresent,
    generating: m.generating,
    measured: m.measurementValid
      ? { voltageV: m.voltageV, currentMa: m.currentMa, powerW: m.powerW }
      : null,
    link: { rssiDbm: m.rssiDbm, sampleRateHz: m.sampleRateHz },
    calculated: {
      sessionEnergyWh: m.sessionEnergyWh,
      totalEnergyWh: m.totalEnergyWh,
      avgPowerW: m.avgPowerW,
      peakPowerW: m.peakPowerW,
      steps: m.steps,
      cadenceSpm: m.cadenceSpm,
      energyPerStepJ: m.energyPerStepJ,
    },
    estimated: {
      co2AvoidedKg: m.co2AvoidedKg,
      ledHours: m.ledHours,
      phoneCharges: m.phoneCharges,
      kcal: m.kcal,
      sustainabilityScore: m.sustainabilityScore,
    },
    quality: {
      lostPackets: s.quality.lostPackets,
      droppedPackets: s.quality.droppedPackets,
      recordedMs: s.quality.recordedMs,
      excludedGapMs: s.quality.excludedGapMs,
    },
    alerts: s.alerts.map((a) => ({
      kind: a.kind,
      severity: a.severity,
      since: ts(a.since),
    })),
  };
}

// =============================================================================================
// Change detection
// =============================================================================================

/** Everything about a stored session that its uploaded records depend on (not its name). */
export function dataFingerprint(s: SessionSummary): string {
  return JSON.stringify([
    s.id,
    s.deviceId,
    s.startedAt,
    s.endedAt,
    s.status,
    s.energyWh,
    s.steps,
    s.peakPowerW,
    s.recordedMs,
    s.bridgedMs,
    s.excludedGapMs,
  ]);
}

/** Data fingerprint plus the fields that only change the session document (the name). */
export function fullFingerprint(s: SessionSummary): string {
  return JSON.stringify([dataFingerprint(s), s.name]);
}
