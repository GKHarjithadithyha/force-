/**
 * @force/contracts: the typed seam between the data layer and the frontend.
 *
 * The frontend imports ONLY from here (types) and obtains an engine from
 * `@force/worker` (`createDashboardEngine()` or `createMockEngine()`).
 * Types only: no runtime code lives in this package.
 *
 * Conventions
 * - All absolute times (`t`, `startedAt`, gap and step times, chart `times`) are
 *   epoch milliseconds (UTC). The data layer derives them from the session's
 *   arrival-time anchor plus device time; integration itself uses device time only.
 * - Power W, voltage V, current mA, energy J and Wh. Integer maths happens inside
 *   the engine; these values are display-ready floats.
 * - `null` means "not measured / not available". Never a made-up number.
 *
 * Any change here is documented in docs/INTEGRATION.md. Never change silently.
 */

export type ConnectionState =
  | 'unsupported'
  | 'idle'
  | 'choosing'
  | 'connecting'
  | 'streaming'
  | 'stale'
  | 'reconnecting'
  | 'error';

export type SourceKind = 'device' | 'demo' | 'replay';

export interface DeviceInfo {
  deviceId: string;
  name: string;
  firmwareVersion: string;
  sampleRateHz: number;
  sensorLimitMa: number;
}

export interface ScoreWeights {
  carbon: number;
  energy: number;
  wellness: number;
}

export interface ScoreTargets {
  /** kg CO2 avoided that scores 100 for the carbon component. */
  co2Kg: number;
  /** LED hours that score 100 for the energy component. */
  ledHours: number;
  /** Steps that score 100 for the wellness component. */
  steps: number;
}

export interface DisplayUnits {
  power: 'W' | 'mW';
  energy: 'Wh' | 'J' | 'mWh';
}

/** One settings profile (Architecture: "settings are data"). Values below are PLACEHOLDER defaults. */
export interface DeviceProfile {
  /** Power above this (W) counts as generating (M4). */
  idleThresholdW: number;
  /** Power must pass this (W) for a pulse to count as a step (M9). */
  stepThresholdW: number;
  /** Pulses starting closer than this (ms) to the previous step are merged into it. */
  minStepGapMs: number;
  /** Generating state falls back to idle only after this long below the idle threshold (ms). */
  idleHoldMs: number;
  /** Grid emission factor, kg CO2 per kWh (M13). PLACEHOLDER until agreed. */
  emissionFactorKgPerKwh: number;
  /** Reference LED power, W (M14). */
  ledWatts: number;
  /** Reference phone battery, Wh (M14). */
  phoneBatteryWh: number;
  /** Calories per step; null hides kcal (M15). */
  kcalPerStep: number | null;
  /** Sustainability score weights and targets (M16). PLACEHOLDER until agreed. */
  scoreWeights: ScoreWeights;
  scoreTargets: ScoreTargets;
  /** Overrides the sensor limit from Device Info (mA); null uses Device Info. */
  sensorLimitOverrideMa: number | null;
  /** Alert when no packet arrives for this long (ms). */
  noDataAlertMs: number;
  /** Alert when not generating for this long (ms). */
  noGenerationAlertMs: number;
  /** A valid pulse shorter than this (ms) is rejected as a blip (Data Collection doc: rejected signals). 0 = off. */
  minPulseMs: number;
  /**
   * Additive: bus voltage below this (V) means there is NO POWER INPUT at the sensor
   * (undervoltage: supply off, disconnected, ground not common, or an idle generator), even
   * though the sensor itself works. Default 1 V is an assumption: set it from real measurements.
   */
  minInputV: number;
  units: DisplayUnits;
}

export type AlertKind =
  | 'sensor_limit'
  | 'sensor_fault'
  | 'no_data'
  | 'no_generation'
  | 'low_sample_rate'
  | 'device_restart'
  /** Additive: sensor works but bus voltage is below `minInputV`: no power source at the input. */
  | 'no_input'
  /** Additive: bus voltage above the INA219 26 V rating. */
  | 'over_voltage'
  | 'storage_low'
  | 'storage_error'
  | 'clock_drift'
  | 'source_error';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: 'info' | 'warning' | 'error';
  /** Epoch ms when the alert became active. */
  since: number;
  message: string;
}

export interface LiveMetrics {
  /**
   * Additive. True only while the newest sample is a real measurement. False before the first
   * sample and while the sensor is faulted or sending invalid readings: in that case `voltageV`,
   * `currentMa` and `powerW` hold the LAST REAL values (never made-up ones) and a UI must dim them.
   */
  measurementValid: boolean;
  /**
   * Additive. True only when the newest sample is valid AND the bus voltage is at least the
   * profile's `minInputV`. False means no power source is detected (even if the sensor works):
   * do not present zero current as a normal active source.
   */
  inputPresent: boolean;
  voltageV: number;
  currentMa: number;
  powerW: number;
  generating: boolean;
  sessionEnergyJ: number;
  sessionEnergyWh: number;
  totalEnergyWh: number;
  avgPowerW: number;
  peakPowerW: number;
  steps: number;
  cadenceSpm: number | null;
  energyPerStepJ: number | null;
  /** Keyed by UTC hour start, ISO 8601 (e.g. "2026-11-15T14:00:00.000Z"). */
  stepsPerHour: Record<string, number>;
  co2AvoidedKg: number;
  ledHours: number;
  phoneCharges: number;
  kcal: number | null;
  sustainabilityScore: number | null;
  rssiDbm: number | null;
  sampleRateHz: number;
  sensorLimitReached: boolean;
}

/** Counters behind the "data-quality line" (Architecture section 12). */
export interface QualityDetail {
  malformedPackets: number;
  duplicatePackets: number;
  latePackets: number;
  clippedSamples: number;
  negativePowerSamples: number;
  powerMismatchSamples: number;
  /** True while the measured rate is below 20 Hz: step counting is marked unreliable. */
  stepsUnreliable: boolean;
}

export interface LiveQuality {
  /** Integrated time, including bridged time. */
  recordedMs: number;
  /** Part of recordedMs spanning lost packets of 1 s or less. */
  bridgedMs: number;
  /** Intervals over 1 s: not in energy or recorded time. */
  excludedGapMs: number;
  lostPackets: number;
  /** Malformed + duplicate + late packets. */
  droppedPackets: number;
  /** Additive detail, see docs/INTEGRATION.md "Additions". */
  detail: QualityDetail;
}

export interface LiveSnapshot {
  /** Epoch ms of the newest sample (or of the last event when idle). */
  t: number;
  /** Additive (Last_Comm_TS): epoch ms when the newest packet ARRIVED; null if none yet. */
  lastPacketAt: number | null;
  source: SourceKind;
  connection: ConnectionState;
  sessionId: string | null;
  metrics: LiveMetrics;
  quality: LiveQuality;
  alerts: Alert[];
}

export interface ChartBatch {
  /** Epoch ms. */
  times: Float64Array;
  powerW: Float64Array;
  voltageV: Float64Array;
  currentMa: Float64Array;
}

export interface StepEvent {
  /** Epoch ms of the pulse start (heel strike). */
  t: number;
  peakW: number;
  durationMs: number;
  energyJ: number;
  // Additive (Data Collection Requirements doc): per-event record fields.
  /** Idempotency key: deviceId + "_" + UTC yyyyMMddTHHmmssSSSZ of `t`. Unique per step. */
  id: string;
  /** Step number within its session, after this step (1-based). */
  stepNumber: number;
  /** Mean power over the pulse: energyJ / duration. */
  avgW: number;
  /** Voltage at the trigger sample (first sample above half the step threshold). */
  voltageV: number;
  /** Current at the trigger sample, mA. */
  currentMa: number;
}

/** Totals over a time range, from stored data (tz-free: the caller picks the bounds). */
export interface RangeTotals {
  fromMs: number;
  toMs: number;
  steps: number;
  energyWh: number;
  recordedMs: number;
  peakPowerW: number;
  /** Real-device sessions only: demo and replay are excluded from totals. */
  sessions: number;
}

export interface GapRecord {
  startMs: number;
  endMs: number;
  cause: 'lost_packets' | 'link_down' | 'device_restart' | 'stale';
}

export interface SessionSummary {
  id: string;
  source: SourceKind;
  deviceId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'open' | 'closed' | 'interrupted';
  energyWh: number;
  peakPowerW: number;
  steps: number;
  recordedMs: number;
  bridgedMs: number;
  excludedGapMs: number;
  /** Additive: user-given name (FR-7), null if unnamed. */
  name: string | null;
}

export interface DashboardEngine {
  supported(): boolean;
  /** Must be called from a user click (browser requirement). */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startDemo(opts?: { cadenceSpm?: number; sampleRateHz?: number }): void;
  startReplay(file: File): Promise<void>;
  stop(): void;

  subscribeSnapshot(cb: (s: LiveSnapshot) => void): () => void;
  subscribeChart(cb: (b: ChartBatch) => void): () => void;
  subscribeSteps(cb: (e: StepEvent) => void): () => void;
  subscribeGaps(cb: (g: GapRecord) => void): () => void;

  getDeviceInfo(): DeviceInfo | null;
  getProfile(): Promise<DeviceProfile>;
  saveProfile(p: DeviceProfile): Promise<void>;

  listSessions(): Promise<SessionSummary[]>;
  getSessionSeries(id: string, rangeMs?: [number, number]): Promise<ChartBatch>;
  exportCsv(id: string): Promise<Blob>;
  exportSessionJson(id: string): Promise<Blob>;
  recomputeSession(id: string, profile: DeviceProfile): Promise<SessionSummary>;
  deleteAllData(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Additions beyond the brief's seam (all additive; see docs/INTEGRATION.md).
  // Needed by PRD FR-4, FR-7, FR-10, FR-15: markers/gap shading on history charts,
  // naming and deleting a single session.
  // ---------------------------------------------------------------------------
  getSessionSteps(id: string): Promise<StepEvent[]>;
  getSessionGaps(id: string): Promise<GapRecord[]>;
  renameSession(id: string, name: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /**
   * Data Collection doc: "steps today", daily totals and the daily report. Time-zone free: the
   * caller passes the bounds of its local day (or any range) as epoch ms.
   */
  getTotals(fromMs: number, toMs: number): Promise<RangeTotals>;
  /** One row per detected step in [fromMs, toMs), all sessions: the daily-report CSV. */
  exportStepsCsv(fromMs: number, toMs: number): Promise<Blob>;
  /**
   * Additive (backup restore): imports a session backup written by `exportSessionJson` as a new
   * stored session. Never overwrites: a clashing id gets a suffix. Derived records are rebuilt
   * from the raw samples. Rejects with a plain message for a file that is not a valid backup, and
   * for a backup of a session that is already stored (it would double-count the totals).
   */
  importSession(file: File): Promise<SessionSummary>;
}

/** Concrete factories live in `@force/worker`: `createDashboardEngine()` and `createMockEngine()`. */
export type CreateDashboardEngine = () => DashboardEngine;
