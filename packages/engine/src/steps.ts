/**
 * Step detector (Architecture section 8): a hysteresis state machine on power.
 *
 *  Waiting   power is not above half the step threshold.
 *  In pulse  power rose ABOVE half the threshold. The pulse starts at the first such sample.
 *            If power also passes the full threshold the pulse is valid.
 *  Counted   when power falls BELOW half the threshold and the pulse was valid, one step is
 *            emitted with the pulse's peak power, duration and energy.
 *  Min gap   a pulse starting closer than the minimum gap after the previous counted step's
 *            start is merged into it: nothing new is emitted for it.
 *
 * Details fixed here (the Architecture leaves them open):
 *  - Comparisons are strict ("above", "below"): a sample exactly at half stays in its state.
 *  - Integer maths: power in microwatts, comparisons use 2*p vs threshold so half needs no rounding.
 *  - Pulse window = first sample above half .. first sample below half. Pulse energy sums the
 *    trapezoids of the intervals inside that window (rising interval excluded, falling included),
 *    doubled in nJ like the session energy.
 *  - Duration = time of the closing sample minus time of the first sample above half.
 *  - A valid pulse shorter than minPulseMs is rejected as a blip (Data Collection doc) and does
 *    not start a min-gap window.
 *  - A discontinuity (gap over 1 s, sensor fault) aborts any open pulse: no step is invented
 *    across missing data.
 */

export interface DetectedStep {
  /** Session time (ms) of the pulse start. */
  startMs: number;
  peakUw: number;
  durationMs: number;
  /** Doubled nanojoules: divide by 2e9 for joules. */
  energyNj2: number;
  /** Readings at the trigger sample (first sample above half the threshold). */
  triggerVoltageMv: number;
  triggerCurrentMa: number;
}

export interface StepDetectorConfig {
  /** Full step threshold, microwatts (integer). */
  stepThresholdUw: number;
  minGapMs: number;
  /** A valid pulse shorter than this is rejected as a blip. 0 disables. */
  minPulseMs: number;
}

export class StepDetector {
  private inPulse = false;
  private valid = false;
  private merged = false;
  private startMs = 0;
  private peakUw = 0;
  private energyNj2 = 0;
  private trigV = 0;
  private trigI = 0;
  private lastP = 0;
  private lastT = 0;
  private lastStepStartMs = Number.NEGATIVE_INFINITY;

  constructor(private cfg: StepDetectorConfig) {}

  /** Thresholds apply from the next sample on; an open pulse continues under the new values. */
  configure(cfg: StepDetectorConfig): void {
    this.cfg = cfg;
  }

  /** Data is missing: forget any open pulse. */
  discontinuity(): void {
    this.inPulse = false;
    this.valid = false;
    this.merged = false;
  }

  /**
   * @param tMs session time of this sample
   * @param powerUw power in microwatts, already clamped at 0
   * @param intervalValid true if the interval since the previous sample was integrated
   * @returns a step if this sample closed a valid pulse
   */
  update(
    tMs: number,
    powerUw: number,
    intervalValid: boolean,
    voltageMv = 0,
    currentMa = 0,
  ): DetectedStep | null {
    if (!intervalValid) this.discontinuity();
    const th = this.cfg.stepThresholdUw;
    const above = 2 * powerUw > th;
    const below = 2 * powerUw < th;
    let out: DetectedStep | null = null;

    if (!this.inPulse) {
      if (above) {
        this.inPulse = true;
        this.startMs = tMs;
        this.trigV = voltageMv;
        this.trigI = currentMa;
        this.peakUw = powerUw;
        this.energyNj2 = 0;
        this.valid = powerUw > th;
        this.merged = tMs - this.lastStepStartMs < this.cfg.minGapMs;
      }
    } else {
      // interval from the previous sample to this one is inside the pulse window
      this.energyNj2 += (this.lastP + powerUw) * (tMs - this.lastT);
      if (powerUw > this.peakUw) this.peakUw = powerUw;
      if (powerUw > th) this.valid = true;
      if (below) {
        if (this.valid && !this.merged && tMs - this.startMs >= this.cfg.minPulseMs) {
          out = {
            startMs: this.startMs,
            peakUw: this.peakUw,
            durationMs: tMs - this.startMs,
            energyNj2: this.energyNj2,
            triggerVoltageMv: this.trigV,
            triggerCurrentMa: this.trigI,
          };
          this.lastStepStartMs = this.startMs;
        }
        this.inPulse = false;
        this.valid = false;
        this.merged = false;
      }
    }
    this.lastP = powerUw;
    this.lastT = tMs;
    return out;
  }
}

/**
 * Cadence helper (M10): steps whose END falls in the last `windowMs`, times 60000/windowMs.
 * Amortised O(1): old entries are dropped from the front.
 */
export class CadenceWindow {
  private times: number[] = [];
  private head = 0;

  constructor(private readonly windowMs = 10_000) {}

  add(tMs: number): void {
    this.times.push(tMs);
  }

  /** Steps per minute over the window ending at nowMs. */
  spm(nowMs: number): number {
    const cutoff = nowMs - this.windowMs;
    while (this.head < this.times.length && (this.times[this.head] as number) <= cutoff)
      this.head++;
    if (this.head > 256) {
      this.times = this.times.slice(this.head);
      this.head = 0;
    }
    return (this.times.length - this.head) * (60_000 / this.windowMs);
  }

  reset(): void {
    this.times = [];
    this.head = 0;
  }
}
