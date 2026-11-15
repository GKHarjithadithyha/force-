import { DEVICE_TIME_MODULUS, SEQ_MODULUS } from '@force/protocol';

/**
 * A packet is "late" (reordered) only if its seq is behind by at most this many packets. Real
 * reordering is a handful of packets; a larger window would swallow a device that rebooted after
 * a few seconds, whose first packets look exactly like packets that are "100 behind".
 */
export const LATE_SEQ_WINDOW = 32;
export const LATE_TIME_WINDOW_MS = 5000;

export type SeqClass =
  | { kind: 'first' }
  /** In order. `lostBefore` packets are missing between the previous accepted packet and this one. */
  | { kind: 'ok'; lostBefore: number; dtMs: number }
  | { kind: 'duplicate' }
  | { kind: 'late' }
  /** Device time went backwards (or seq reset with time moving on): the device restarted. */
  | { kind: 'restart' };

/**
 * Classifies each packet against the last ACCEPTED one (Architecture sections 7 and 12).
 *
 * Sequence arithmetic is modulo 65536; device-time differences are 32-bit signed, so the
 * 49.7-day wrap is a normal small forward step and a restart is a large backward one.
 *
 * Rules, in order:
 *  1. same seq                                   -> duplicate (dropped, counted)
 *  2. seq slightly behind AND time slightly back -> late (dropped, counted)
 *  3. device time went backwards                 -> restart (new session)
 *  4. seq went far backwards while time moved on -> restart
 *  5. otherwise forward: lostBefore = seqDelta - 1
 *
 * Known limit: a device that reboots and is next heard from after it has been up LONGER than
 * its previous uptime, with a seq that happens to land ahead, is seen as lost packets rather
 * than a restart. The gap is then longer than 1 s, so no energy is invented either way.
 */
export class SequenceTracker {
  private lastSeq = -1;
  private lastTime = 0;
  private has = false;
  /** Running estimate of the sample period (ms), from consecutive packets. */
  private periodMs = 50;

  classify(seq: number, deviceTimeMs: number): SeqClass {
    if (!this.has) {
      this.accept(seq, deviceTimeMs);
      return { kind: 'first' };
    }
    const sd = (seq - this.lastSeq + SEQ_MODULUS) % SEQ_MODULUS;
    const signedSd = sd >= SEQ_MODULUS / 2 ? sd - SEQ_MODULUS : sd;
    // 32-bit signed difference of unsigned device times
    const dt = ((deviceTimeMs - this.lastTime) % DEVICE_TIME_MODULUS) | 0;

    if (sd === 0) return { kind: 'duplicate' };
    if (signedSd < 0 && signedSd >= -LATE_SEQ_WINDOW && dt <= 0 && dt >= -LATE_TIME_WINDOW_MS) {
      // A genuinely late packet is |signedSd| periods behind in time too. A device that restarted
      // within seconds of its previous boot is far further back than that, so it is not "late".
      const tolerance = -signedSd * this.periodMs * 2 + 50;
      if (-dt <= tolerance) return { kind: 'late' };
    }
    if (dt < 0 || signedSd < 0) {
      this.accept(seq, deviceTimeMs);
      return { kind: 'restart' };
    }
    this.accept(seq, deviceTimeMs);
    if (sd === 1 && dt > 0 && dt < 1000) this.periodMs += (dt - this.periodMs) / 8;
    return { kind: 'ok', lostBefore: sd - 1, dtMs: dt };
  }

  /** Forget history (new source or new session). */
  reset(): void {
    this.has = false;
    this.periodMs = 50;
  }

  private accept(seq: number, t: number): void {
    this.lastSeq = seq;
    this.lastTime = t;
    this.has = true;
  }
}
