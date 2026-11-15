import { FLAG, packTelemetry } from '@force/protocol';

/**
 * Packet simulator: produces the same 15-byte packets as the ESP32 firmware (it uses the shared
 * protocol packer): footstep pulses at a chosen cadence and amplitude, noise, a chosen sample
 * rate, and scripted faults. Feeds the demo source, the mock engine, the fault-injection tests
 * and the performance run, so the app, the tests and the demo cannot drift apart.
 *
 * Deterministic: everything derives from `seed` and the device-time schedule.
 */

export type FaultKind =
  /** Packets in the window are lost on the way. seq still advances on the device. */
  | 'drop'
  /** A 5 s (or any) dropout where the LINK stays open: same bytes as `drop`, flagged `stale`. */
  | 'stale'
  /** The packet at `atMs` is delivered twice. */
  | 'duplicate'
  /** The packet at `atMs` and the next one arrive swapped. */
  | 'reorder'
  /** The device reboots at `atMs`: device time and seq restart from zero. */
  | 'restart'
  /** Current is clipped at the sensor limit, flag set, for the window. */
  | 'clip'
  /** The INA219 stops answering: fault flag, zero readings, for the window. */
  | 'sensor_fault'
  /** A packet shorter than 15 bytes is delivered instead of the one at `atMs`. */
  | 'malformed'
  /** A packet with a voltage no INA219 can report, instead of the one at `atMs`. */
  | 'bad_voltage';

export interface Fault {
  kind: FaultKind;
  /** Device time (ms since the simulator's start) when the fault begins. */
  atMs: number;
  /** Length of the window for window faults (drop, stale, clip, sensor_fault). */
  durationMs?: number;
}

export interface SimConfig {
  sampleRateHz: number;
  cadenceSpm: number;
  /** Peak power of a step, watts. */
  peakW: number;
  /** Pulse width range, ms. */
  pulseMinMs: number;
  pulseMaxMs: number;
  idleVoltageMv: number;
  /** Voltage rises by this much at the peak of a pulse. */
  voltageRiseMv: number;
  /** +- noise on current (mA) and voltage (mV). */
  noiseMa: number;
  noiseMv: number;
  seed: number;
  /** Sensor limit used by `clip` faults, mA. */
  limitMa: number;
  /** Device time of the first sample (ms since boot). Use near 2^32 to test wrap. */
  startDeviceTimeMs: number;
  startSeq: number;
  faults: Fault[];
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  sampleRateHz: 20,
  cadenceSpm: 90,
  peakW: 2,
  pulseMinMs: 100,
  pulseMaxMs: 200,
  idleVoltageMv: 5000,
  voltageRiseMv: 3000,
  noiseMa: 2,
  noiseMv: 10,
  seed: 1234,
  limitMa: 3200,
  startDeviceTimeMs: 0,
  startSeq: 0,
  faults: [],
};

export interface SimPacket {
  bytes: Uint8Array;
  /** Delivery time relative to the simulator's start, ms. Add an anchor to get epoch ms. */
  arrivalOffsetMs: number;
  /** Device time of the sample this packet carries (undefined for malformed packets). */
  deviceTimeMs?: number;
  /** True while a `stale` fault window is open. */
  stale?: boolean;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(k: number, salt: number, seed: number): number {
  let x = (Math.imul(k + 1, 2654435761) ^ Math.imul(seed + salt, 40503)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Streaming generator: call `until(ms)` repeatedly to get the packets due up to that offset. */
export class PacketSimulator {
  readonly cfg: SimConfig;
  private readonly rnd: () => number;
  private readonly periodMs: number;
  private index = 0; // sample index since start (device schedule)
  private seq: number;
  private bootOffsetMs = 0; // device time restarts at 0 after a restart
  private restartsApplied = new Set<number>();
  private held: SimPacket | null = null; // for reorder

  constructor(cfg: Partial<SimConfig> = {}) {
    this.cfg = { ...DEFAULT_SIM_CONFIG, ...cfg, faults: cfg.faults ?? [] };
    this.rnd = mulberry32(this.cfg.seed);
    this.periodMs = 1000 / this.cfg.sampleRateHz;
    this.seq = this.cfg.startSeq;
  }

  /** Offset of the next sample from the start, ms. */
  get nextOffsetMs(): number {
    return this.index * this.periodMs;
  }

  /** Packets due at or before `offsetMs` since the start, in delivery order. */
  until(offsetMs: number): SimPacket[] {
    const out: SimPacket[] = [];
    while (this.nextOffsetMs <= offsetMs) {
      for (const p of this.produce()) out.push(p);
    }
    return out;
  }

  private active(kind: FaultKind, offsetMs: number): Fault | undefined {
    return this.cfg.faults.find(
      (f) => f.kind === kind && offsetMs >= f.atMs && offsetMs < f.atMs + (f.durationMs ?? 0),
    );
  }

  private at(kind: FaultKind, offsetMs: number): boolean {
    // matches the sample whose scheduled offset is the first at or after atMs
    return this.cfg.faults.some(
      (f) => f.kind === kind && offsetMs >= f.atMs && offsetMs - this.periodMs < f.atMs,
    );
  }

  /** Power shape at a device-schedule offset, in watts (before noise). */
  powerW(offsetMs: number): { powerW: number; shape: number } {
    const stepMs = 60_000 / this.cfg.cadenceSpm;
    const k = Math.floor(offsetMs / stepMs);
    const into = offsetMs - k * stepMs;
    const dur =
      this.cfg.pulseMinMs +
      hash01(k, 1, this.cfg.seed) * (this.cfg.pulseMaxMs - this.cfg.pulseMinMs);
    const shape = into < dur ? Math.sin((Math.PI * into) / dur) : 0;
    return { powerW: this.cfg.peakW * shape * shape, shape };
  }

  private produce(): SimPacket[] {
    const offset = this.nextOffsetMs;
    this.index++;

    // device restart: time and seq begin again
    for (const f of this.cfg.faults) {
      if (f.kind === 'restart' && !this.restartsApplied.has(f.atMs) && offset >= f.atMs) {
        this.restartsApplied.add(f.atMs);
        this.bootOffsetMs = offset;
        this.seq = 0;
      }
    }
    const deviceTimeMs =
      (this.bootOffsetMs === 0 ? this.cfg.startDeviceTimeMs + offset : offset - this.bootOffsetMs) %
      4294967296;
    const t = Math.round(deviceTimeMs);

    const { powerW, shape } = this.powerW(offset);
    const noiseI = Math.round((this.rnd() * 2 - 1) * this.cfg.noiseMa);
    const noiseV = Math.round((this.rnd() * 2 - 1) * this.cfg.noiseMv);
    let mv = Math.max(
      0,
      Math.round(this.cfg.idleVoltageMv + this.cfg.voltageRiseMv * shape) + noiseV,
    );
    let ma = Math.round((powerW / (mv / 1000)) * 1000) + noiseI;
    let flags = 0;

    if (this.active('clip', offset)) {
      ma = this.cfg.limitMa;
      flags |= FLAG.CURRENT_AT_LIMIT;
    }
    if (this.active('sensor_fault', offset)) {
      mv = 0;
      ma = 0;
      flags |= FLAG.SENSOR_FAULT;
    }

    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xffff; // advances for EVERY sample, delivered or not

    let bytes = packTelemetry({ seq, deviceTimeMs: t, voltageMv: mv, currentMa: ma, flags });
    const dropped = this.active('drop', offset) || this.active('stale', offset);
    const stale = this.active('stale', offset) !== undefined;

    if (this.at('malformed', offset)) {
      return [{ bytes: bytes.slice(0, 9), arrivalOffsetMs: offset }];
    }
    if (this.at('bad_voltage', offset)) {
      bytes = bytes.slice();
      new DataView(bytes.buffer).setUint16(6, 60_000, true);
    }
    if (dropped) return this.flushHeld();

    const pkt: SimPacket = { bytes, arrivalOffsetMs: offset, deviceTimeMs: t, stale };
    if (this.held) {
      // reorder: deliver this one first, then the held one
      const h = this.held;
      this.held = null;
      h.arrivalOffsetMs = offset;
      return [pkt, h];
    }
    if (this.at('reorder', offset)) {
      this.held = pkt;
      return [];
    }
    const out = [pkt];
    if (this.at('duplicate', offset)) out.push({ ...pkt, bytes: pkt.bytes.slice() });
    return out;
  }

  private flushHeld(): SimPacket[] {
    if (!this.held) return [];
    const h = this.held;
    this.held = null;
    return [h];
  }
}

/** All packets for `durationMs` of device time. */
export function simulate(cfg: Partial<SimConfig>, durationMs: number): SimPacket[] {
  return new PacketSimulator(cfg).until(durationMs);
}
