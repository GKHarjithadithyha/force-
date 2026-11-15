import type {
  Alert,
  DeviceProfile,
  GapRecord,
  LiveMetrics,
  LiveQuality,
  SessionSummary,
  SourceKind,
  StepEvent,
} from '@force/contracts';
import { FLAG } from '@force/protocol';
import type { RawSample } from './decoder.js';
import { co2AvoidedKg, kcal, ledHours, phoneCharges, sustainabilityScore } from './esg.js';
import { cloneProfile } from './profile.js';
import { CadenceWindow, StepDetector } from './steps.js';
import type { DetectedStep } from './steps.js';

/** Intervals longer than this are excluded from energy and recorded time (never filled). */
export const MAX_INTERVAL_MS = 1000;
/** Below this measured rate step counting is marked unreliable (PRD: needs >= 20 Hz; 0.5 Hz slack for window jitter). */
export const LOW_RATE_HZ = 19.5;
/** The sensor-limit alert stays up this long after the last clipped sample (session ms). */
export const LIMIT_ALERT_HOLD_MS = 3000;
/** Default sensor limit when neither Device Info nor an override is available (INA219 at 0.1 ohm). */
export const DEFAULT_SENSOR_LIMIT_MA = 3200;
/** INA219 absolute maximum bus input (VIN+/VIN-), mV. Readings above it are out of the chip's spec. */
export const INA219_BUS_RATING_MV = 26_000;
/** Cadence is unavailable until this much continuous recorded time exists. */
export const CADENCE_WINDOW_MS = 10_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DRIFT_WINDOW_MS = 60_000;
const DRIFT_LIMIT = 0.01;

/** 2026-11-15T10:23:45.123Z -> "20261115T102345123Z" (Data Collection doc: event_id format). */
export function compactUtc(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:.]/g, '');
}

export type GapCause = GapRecord['cause'];

export interface ChartPoint {
  /** Epoch ms. */
  tMs: number;
  powerW: number;
  voltageV: number;
  currentMa: number;
}

/** One clock minute of derived data (Architecture section 9, "minute buckets"). */
export interface MinuteBucket {
  /** Epoch minute index: floor(epochMs / 60000). */
  minute: number;
  /** Doubled nanojoules (exact integer). Joules = energyNj2 / 2e9. */
  energyNj2: number;
  recordedMs: number;
  peakPowerUw: number;
  steps: number;
  samples: number;
  /** Excluded gap time that ended in this minute. */
  gapMs: number;
}

export interface SessionSink {
  onChartPoint?(p: ChartPoint): void;
  onStep?(e: StepEvent): void;
  onGap?(g: GapRecord): void;
  onMinuteClosed?(b: MinuteBucket): void;
}

export interface SessionConfig {
  sessionId: string;
  source: SourceKind;
  deviceId: string;
  profile: DeviceProfile;
  /** Sensor limit from Device Info, mA; null if unknown. */
  deviceSensorLimitMa: number | null;
  /** Energy and steps of earlier real sessions (M6, M15). 0 for demo and replay. */
  priorEnergyWh: number;
  priorSteps: number;
  /** Compare device elapsed time with arrival elapsed time (only meaningful for a live device). */
  checkClockDrift: boolean;
}

export type DropKind = 'malformed' | 'duplicate' | 'late';

/**
 * Per-session calculation state (Architecture section 8). One call per accepted sample, constant
 * time, no allocation on the hot path other than the rare step, gap and minute events.
 *
 * Number handling: millivolts x milliamps = microwatts, exactly, as integers. Energy over an
 * interval is (P_prev + P_cur) x dt (microwatts x milliseconds = nanojoules, kept DOUBLED so no
 * halves appear). The per-minute accumulator stays far below 2^53; closed minutes are folded
 * into a BigInt so the session total is exact for any length.
 */
export class SessionEngine {
  private profile: DeviceProfile;
  private deviceSensorLimitMa: number | null;
  private priorEnergyWh: number;
  private priorSteps: number;
  private readonly detector: StepDetector;
  private readonly cadence = new CadenceWindow(CADENCE_WINDOW_MS);

  // time base
  private started = false;
  private anchorEpochMs = 0; // arrival time of the first sample
  private t0 = 0; // device time of the first sample
  private tU = 0; // unwrapped device time
  private lastRawT = 0;
  private lastEpochMs = 0;
  private lastArrivalMs = 0;

  // previous VALID sample (for integration)
  private prevValid = false;
  private prevTU = 0;
  private prevUw = 0;
  private faultPending = false;
  private contiguousMs = 0;

  // energy
  private hi = 0n; // folded minutes, doubled nJ
  private bucket: MinuteBucket | null = null;
  private recordedMs = 0;
  private bridgedMs = 0;
  private excludedGapMs = 0;

  // metrics state
  private voltageMv = 0;
  private currentMa = 0;
  private powerUw = 0;
  private peakUw = 0;
  private generating = false;
  private lastAboveIdleMs = Number.NEGATIVE_INFINITY; // session ms
  private lastGeneratingEpoch = 0;
  private steps = 0;
  private lastStepEnergyJ: number | null = null;
  private hourCounts: Record<string, number> = {};

  // quality
  private lostPackets = 0;
  private malformed = 0;
  private duplicates = 0;
  private late = 0;
  private clipped = 0;
  private negativePower = 0;
  private powerMismatch = 0;
  private sampleCount = 0;

  // flags
  private limitReached = false;
  private lastLimitMs = Number.NEGATIVE_INFINITY;
  private limitSince = 0;
  private sensorFault = false;
  /** True only while the newest sample is a real measurement (false: none yet, or fault). */
  private measurementValid = false;
  /** Latest valid sample is below the profile's minimum input voltage (no power source). */
  private noInput = false;
  private noInputSince = 0;
  /** Latest valid sample is above the INA219 rating. */
  private overVoltage = false;
  private overVoltageSince = 0;

  // measured rate (device-time windows of >= 1 s)
  private rateWindowStart = 0;
  private rateWindowCount = 0;
  private rateHz = 0;
  private rateValid = false;

  // clock drift
  private driftArrivalStart = 0;
  private driftDeviceStart = 0;
  private driftActive = false;
  private driftNoted = false;
  private driftNote = '';

  constructor(
    private readonly cfg: SessionConfig,
    private readonly sink: SessionSink = {},
  ) {
    this.profile = cloneProfile(cfg.profile);
    this.deviceSensorLimitMa = cfg.deviceSensorLimitMa;
    this.priorEnergyWh = cfg.priorEnergyWh;
    this.priorSteps = cfg.priorSteps;
    this.detector = new StepDetector(this.detectorConfig());
  }

  get sessionId(): string {
    return this.cfg.sessionId;
  }
  get source(): SourceKind {
    return this.cfg.source;
  }
  get deviceId(): string {
    return this.cfg.deviceId;
  }
  get startedAtMs(): number {
    return this.anchorEpochMs;
  }
  /** Epoch ms of the newest accepted sample. */
  get lastSampleEpochMs(): number {
    return this.lastEpochMs;
  }
  /** Epoch ms when the newest packet arrived (Last_Comm_TS); 0 before the first. */
  get lastArrivalEpochMs(): number {
    return this.lastArrivalMs;
  }
  get totalSteps(): number {
    return this.steps;
  }
  get sessionEnergyWh(): number {
    return this.energyJ() / 3600;
  }

  setProfile(p: DeviceProfile): void {
    this.profile = cloneProfile(p);
    this.detector.configure(this.detectorConfig());
  }

  setDeviceSensorLimit(ma: number | null): void {
    this.deviceSensorLimitMa = ma;
  }

  setPriorTotals(energyWh: number, steps: number): void {
    this.priorEnergyWh = energyWh;
    this.priorSteps = steps;
  }

  /** Counted here so each drop is attributed to the session that was running. */
  noteDropped(kind: DropKind, count = 1): void {
    if (kind === 'malformed') this.malformed += count;
    else if (kind === 'duplicate') this.duplicates += count;
    else this.late += count;
  }

  /**
   * Feed one accepted sample.
   * @param lostBefore packets missing between the previous accepted sample and this one
   * @param causeHint why the link was interrupted, if the source knows (link down, stale)
   */
  ingest(s: RawSample, lostBefore: number, causeHint: GapCause | null = null): void {
    this.lostPackets += lostBefore;
    this.sampleCount++;

    if (!this.started) {
      this.started = true;
      this.anchorEpochMs = s.arrivalMs;
      this.t0 = s.deviceTimeMs;
      this.tU = s.deviceTimeMs;
      this.driftActive = false;
    } else {
      // Unsigned 32-bit difference: the 49.7-day wrap is just a small forward step.
      this.tU += (s.deviceTimeMs - this.lastRawT) >>> 0;
    }
    this.lastRawT = s.deviceTimeMs;
    const tSession = this.tU - this.t0;
    const epoch = this.anchorEpochMs + tSession;
    this.lastEpochMs = epoch;
    this.lastArrivalMs = s.arrivalMs;
    this.updateRate(this.tU);

    const minute = Math.floor(epoch / MINUTE_MS);
    if (this.bucket === null || this.bucket.minute !== minute) this.rollMinute(minute);
    const bucket = this.bucket as MinuteBucket;
    bucket.samples++;

    // ---- Sensor fault: no measurement in this packet. Never invent one. -------------------
    if ((s.flags & FLAG.SENSOR_FAULT) !== 0) {
      this.sensorFault = true;
      this.measurementValid = false; // last real V/I stay in metrics, flagged as not current
      this.faultPending = true;
      this.contiguousMs = 0;
      this.driftActive = false;
      this.detector.discontinuity();
      return;
    }
    this.sensorFault = false;
    this.measurementValid = true;

    // ---- Power: exact integer microwatts. Negative counts as zero (D8). -------------------
    let pUw = s.voltageMv * s.currentMa;
    if (pUw < 0) {
      this.negativePower++;
      pUw = 0;
    }
    this.checkPowerMismatch(s, pUw);

    // ---- Sensor limit (M19): flag from the device, or current at/above the limit. ---------
    const limitMa =
      this.profile.sensorLimitOverrideMa ?? this.deviceSensorLimitMa ?? DEFAULT_SENSOR_LIMIT_MA;
    const atLimit = (s.flags & FLAG.CURRENT_AT_LIMIT) !== 0 || Math.abs(s.currentMa) >= limitMa;
    if (atLimit) {
      this.clipped++;
      if (!this.limitReached) this.limitSince = epoch;
      this.lastLimitMs = tSession;
    }
    this.limitReached = atLimit;

    // ---- Interval to the previous valid sample --------------------------------------------
    let integrated = false;
    if (this.prevValid) {
      const dt = this.tU - this.prevTU;
      const startEpoch = this.anchorEpochMs + (this.prevTU - this.t0);
      if (this.faultPending || dt > MAX_INTERVAL_MS) {
        // Excluded: not in energy, not in recorded time, drawn as a gap.
        this.excludedGapMs += dt;
        bucket.gapMs += dt;
        this.contiguousMs = 0;
        this.driftActive = false;
        this.emitGap(startEpoch, epoch, this.causeFor(lostBefore, causeHint));
      } else {
        const e2 = (this.prevUw + pUw) * dt;
        bucket.energyNj2 += e2;
        bucket.recordedMs += dt;
        this.recordedMs += dt;
        this.contiguousMs += dt;
        integrated = true;
        if (lostBefore > 0) {
          // Up to 1 s across lost packets: integrated between the two real bounding samples.
          this.bridgedMs += dt;
          this.driftActive = false;
          this.emitGap(startEpoch, epoch, this.causeFor(lostBefore, causeHint));
        }
      }
    }
    this.faultPending = false;
    this.prevValid = true;
    this.prevTU = this.tU;
    this.prevUw = pUw;

    // ---- Latest values, peak, generating state with hold (M4, M8) -------------------------
    this.voltageMv = s.voltageMv;
    this.currentMa = s.currentMa;
    this.powerUw = pUw;

    // ---- Power input is judged apart from the sensor: a working INA219 can sit on a dead input.
    const noInput = s.voltageMv < this.profile.minInputV * 1000;
    if (noInput && !this.noInput) this.noInputSince = epoch;
    this.noInput = noInput;
    const overVoltage = s.voltageMv > INA219_BUS_RATING_MV;
    if (overVoltage && !this.overVoltage) this.overVoltageSince = epoch;
    this.overVoltage = overVoltage;
    if (pUw > this.peakUw) this.peakUw = pUw;
    if (pUw > bucket.peakPowerUw) bucket.peakPowerUw = pUw;
    if (pUw > this.profile.idleThresholdW * 1e6) {
      this.generating = true;
      this.lastAboveIdleMs = tSession;
      this.lastGeneratingEpoch = epoch;
    } else if (this.generating && tSession - this.lastAboveIdleMs >= this.profile.idleHoldMs) {
      this.generating = false;
    }

    // ---- Step detector (M9, M11) ----------------------------------------------------------
    const step = this.detector.update(tSession, pUw, integrated, s.voltageMv, s.currentMa);
    if (step) this.emitStep(step, tSession, bucket);

    this.checkClockDrift(s.arrivalMs);

    this.sink.onChartPoint?.({
      tMs: epoch,
      powerW: pUw / 1e6,
      voltageV: s.voltageMv / 1000,
      currentMa: s.currentMa,
    });
  }

  // ---------------------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------------------

  /** Joules, exact up to the final division. */
  energyJ(): number {
    const cur = this.bucket ? BigInt(this.bucket.energyNj2) : 0n;
    return Number(this.hi + cur) / 2e9;
  }

  metrics(rssiDbm: number | null): LiveMetrics {
    const p = this.profile;
    const energyJ = this.energyJ();
    const sessionWh = energyJ / 3600;
    const totalWh = this.priorEnergyWh + sessionWh;
    const totalSteps = this.priorSteps + this.steps;
    const co2 = co2AvoidedKg(totalWh, p);
    const led = ledHours(totalWh, p);
    const nowSession = this.tU - this.t0;
    const cadenceOk = this.started && this.contiguousMs >= CADENCE_WINDOW_MS;
    return {
      measurementValid: this.measurementValid,
      inputPresent: this.measurementValid && !this.noInput,
      voltageV: this.voltageMv / 1000,
      currentMa: this.currentMa,
      powerW: this.powerUw / 1e6,
      generating: this.generating,
      sessionEnergyJ: energyJ,
      sessionEnergyWh: sessionWh,
      totalEnergyWh: totalWh,
      avgPowerW: this.recordedMs > 0 ? energyJ / (this.recordedMs / 1000) : 0,
      peakPowerW: this.peakUw / 1e6,
      steps: this.steps,
      cadenceSpm: cadenceOk ? this.cadence.spm(nowSession) : null,
      energyPerStepJ: this.lastStepEnergyJ,
      stepsPerHour: { ...this.hourCounts },
      co2AvoidedKg: co2,
      ledHours: led,
      phoneCharges: phoneCharges(totalWh, p),
      kcal: kcal(totalSteps, p),
      sustainabilityScore: sustainabilityScore(p, { co2Kg: co2, ledHours: led, steps: totalSteps }),
      rssiDbm,
      sampleRateHz: this.rateHz,
      sensorLimitReached: this.limitReached,
    };
  }

  quality(): LiveQuality {
    return {
      recordedMs: this.recordedMs,
      bridgedMs: this.bridgedMs,
      excludedGapMs: this.excludedGapMs,
      lostPackets: this.lostPackets,
      droppedPackets: this.malformed + this.duplicates + this.late,
      detail: {
        malformedPackets: this.malformed,
        duplicatePackets: this.duplicates,
        latePackets: this.late,
        clippedSamples: this.clipped,
        negativePowerSamples: this.negativePower,
        powerMismatchSamples: this.powerMismatch,
        stepsUnreliable: this.rateValid && this.rateHz < LOW_RATE_HZ,
      },
    };
  }

  /**
   * Alerts derived from the session state.
   * @param nowEpochMs wall clock now (the caller decides; tests pass a fixed value)
   * @param expectingData true while the link is open or reconnecting and data should flow
   */
  alerts(nowEpochMs: number, expectingData: boolean): Alert[] {
    const out: Alert[] = [];
    const nowSession = this.tU - this.t0;
    if (this.started && nowSession - this.lastLimitMs < LIMIT_ALERT_HOLD_MS) {
      out.push({
        id: 'sensor_limit',
        kind: 'sensor_limit',
        severity: 'warning',
        since: this.limitSince,
        message:
          'Current reached the sensor limit: readings stop rising and energy may be under-reported.',
      });
    }
    if (this.sensorFault) {
      out.push({
        id: 'sensor_fault',
        kind: 'sensor_fault',
        severity: 'error',
        since: this.lastEpochMs,
        message: 'The INA219 sensor is not answering. No measurements are being recorded.',
      });
    }
    if (this.started && expectingData && this.measurementValid && this.noInput) {
      out.push({
        id: 'no_input',
        kind: 'no_input',
        severity: 'warning',
        since: this.noInputSince,
        message: `No power input: bus voltage ${(this.voltageMv / 1000).toFixed(2)} V is below the ${this.profile.minInputV} V minimum. The sensor is answering, but there is no source (supply off, disconnected, ground not common, or an idle generator).`,
      });
    }
    if (this.started && expectingData && this.measurementValid && this.overVoltage) {
      out.push({
        id: 'over_voltage',
        kind: 'over_voltage',
        severity: 'error',
        since: this.overVoltageSince,
        message: `Bus voltage ${(this.voltageMv / 1000).toFixed(2)} V is above the INA219 26 V rating. Readings are out of the chip's specification. Remove the supply.`,
      });
    }
    if (this.rateValid && this.rateHz < LOW_RATE_HZ) {
      out.push({
        id: 'low_sample_rate',
        kind: 'low_sample_rate',
        severity: 'warning',
        since: this.lastEpochMs,
        message: `Measured sample rate ${this.rateHz.toFixed(1)} Hz is below 20 Hz: step counting is unreliable.`,
      });
    }
    if (
      this.started &&
      expectingData &&
      nowEpochMs - this.lastArrivalMs > this.profile.noDataAlertMs
    ) {
      out.push({
        id: 'no_data',
        kind: 'no_data',
        severity: 'warning',
        since: this.lastArrivalMs,
        message: 'No data received for a while.',
      });
    }
    if (this.started && expectingData && !this.generating) {
      const since = this.lastGeneratingEpoch > 0 ? this.lastGeneratingEpoch : this.anchorEpochMs;
      if (nowEpochMs - since > this.profile.noGenerationAlertMs) {
        out.push({
          id: 'no_generation',
          kind: 'no_generation',
          severity: 'info',
          since,
          message: 'No generation for a while.',
        });
      }
    }
    if (this.driftNoted) {
      out.push({
        id: 'clock_drift',
        kind: 'clock_drift',
        severity: 'info',
        since: this.lastEpochMs,
        message: this.driftNote,
      });
    }
    return out;
  }

  summary(status: SessionSummary['status'], endedAt: number | null): SessionSummary {
    return {
      id: this.cfg.sessionId,
      source: this.cfg.source,
      deviceId: this.cfg.deviceId,
      startedAt: this.anchorEpochMs,
      endedAt,
      status,
      energyWh: this.sessionEnergyWh,
      peakPowerW: this.peakUw / 1e6,
      steps: this.steps,
      recordedMs: this.recordedMs,
      bridgedMs: this.bridgedMs,
      excludedGapMs: this.excludedGapMs,
      name: null,
    };
  }

  /** The minute in progress (a copy), for the once-a-second storage flush. */
  peekMinute(): MinuteBucket | null {
    return this.bucket ? { ...this.bucket } : null;
  }

  /** Closes the minute in progress (end of session): folds it and emits it. */
  finish(): void {
    if (this.bucket) {
      this.hi += BigInt(this.bucket.energyNj2);
      this.sink.onMinuteClosed?.(this.bucket);
      this.bucket = null;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------

  private detectorConfig() {
    return {
      stepThresholdUw: Math.round(this.profile.stepThresholdW * 1e6),
      minGapMs: this.profile.minStepGapMs,
      minPulseMs: this.profile.minPulseMs,
    };
  }

  private causeFor(lostBefore: number, hint: GapCause | null): GapCause {
    if (this.faultPending) return 'stale'; // link open but no valid measurement
    if (hint !== null) return hint;
    return lostBefore > 0 ? 'lost_packets' : 'stale';
  }

  private emitGap(startMs: number, endMs: number, cause: GapCause): void {
    this.sink.onGap?.({ startMs, endMs, cause });
  }

  private emitStep(step: DetectedStep, endSessionMs: number, bucket: MinuteBucket): void {
    this.steps++;
    bucket.steps++;
    this.cadence.add(endSessionMs);
    const energyJ = step.energyNj2 / 2e9;
    this.lastStepEnergyJ = energyJ;
    const t = this.anchorEpochMs + step.startMs;
    const hourKey = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString();
    this.hourCounts[hourKey] = (this.hourCounts[hourKey] ?? 0) + 1;
    this.sink.onStep?.({
      t,
      peakW: step.peakUw / 1e6,
      durationMs: step.durationMs,
      energyJ,
      id: this.cfg.deviceId + '_' + compactUtc(t),
      stepNumber: this.steps,
      avgW: step.durationMs > 0 ? energyJ / (step.durationMs / 1000) : step.peakUw / 1e6,
      voltageV: step.triggerVoltageMv / 1000,
      currentMa: step.triggerCurrentMa,
    });
  }

  private rollMinute(minute: number): void {
    if (this.bucket) {
      this.hi += BigInt(this.bucket.energyNj2);
      this.sink.onMinuteClosed?.(this.bucket);
    }
    this.bucket = {
      minute,
      energyNj2: 0,
      recordedMs: 0,
      peakPowerUw: 0,
      steps: 0,
      samples: 0,
      gapMs: 0,
    };
  }

  /** Packets per second from device time: samples in (windowStart, now] over the elapsed time. */
  private updateRate(tU: number): void {
    if (this.sampleCount === 1) {
      this.rateWindowStart = tU;
      this.rateWindowCount = 0;
      return;
    }
    this.rateWindowCount++;
    const elapsed = tU - this.rateWindowStart;
    if (elapsed >= 1000) {
      this.rateHz = (this.rateWindowCount * 1000) / elapsed;
      // A window that spans a long outage says nothing about the rate: only trust short ones.
      this.rateValid = elapsed <= 2000;
      this.rateWindowStart = tU;
      this.rateWindowCount = 0;
    }
  }

  private checkPowerMismatch(s: RawSample, computedUw: number): void {
    const computedMw = Math.floor((computedUw + 500) / 1000);
    const diff = Math.abs(computedMw - s.powerMw);
    if (diff > 1 && diff > 0.01 * Math.max(computedMw, s.powerMw)) this.powerMismatch++;
  }

  private checkClockDrift(arrivalMs: number): void {
    if (!this.cfg.checkClockDrift) return;
    if (!this.driftActive) {
      this.driftActive = true;
      this.driftArrivalStart = arrivalMs;
      this.driftDeviceStart = this.tU;
      return;
    }
    const dev = this.tU - this.driftDeviceStart;
    if (dev < DRIFT_WINDOW_MS) return;
    const arr = arrivalMs - this.driftArrivalStart;
    const drift = Math.abs(arr - dev) / dev;
    if (drift > DRIFT_LIMIT) {
      this.driftNoted = true;
      this.driftNote = `Device clock and arrival clock differ by ${(drift * 100).toFixed(1)}% over ${Math.round(dev / 1000)} s. Integration uses device time only.`;
    }
    this.driftActive = true;
    this.driftArrivalStart = arrivalMs;
    this.driftDeviceStart = this.tU;
  }
}
