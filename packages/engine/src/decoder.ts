import { MAX_VOLTAGE_MV, OFFSET, PACKET_SIZE } from '@force/protocol';

/** One decoded telemetry sample. Integers all the way: mV, mA, mW, ms. */
export interface RawSample {
  seq: number;
  /** Device time as sent: uint32 ms since boot (wraps after ~49.7 days). */
  deviceTimeMs: number;
  voltageMv: number;
  currentMa: number;
  /** Power as sent by the device (0 if current negative). Cross-check only. */
  powerMw: number;
  flags: number;
  /** Arrival time, epoch ms. Places a session on the clock; never used for integration. */
  arrivalMs: number;
}

export type DecodeFailure = 'too_short' | 'voltage_out_of_range';

export type DecodeResult = { ok: true; sample: RawSample } | { ok: false; reason: DecodeFailure };

/**
 * Decodes one telemetry notification (Architecture section 6): rejects anything shorter than
 * 15 bytes, ignores extra bytes so a longer future packet still parses, bounds-checks fields.
 * Reserved flag bits are ignored (forward compatible).
 */
export function decodePacket(data: ArrayBuffer | ArrayBufferView, arrivalMs: number): DecodeResult {
  const view =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.byteLength < PACKET_SIZE) return { ok: false, reason: 'too_short' };
  const voltageMv = view.getUint16(OFFSET.voltageMv, true);
  if (voltageMv > MAX_VOLTAGE_MV) return { ok: false, reason: 'voltage_out_of_range' };
  return {
    ok: true,
    sample: {
      seq: view.getUint16(OFFSET.seq, true),
      deviceTimeMs: view.getUint32(OFFSET.deviceTimeMs, true),
      voltageMv,
      currentMa: view.getInt16(OFFSET.currentMa, true),
      powerMw: view.getUint32(OFFSET.powerMw, true),
      flags: view.getUint8(OFFSET.flags),
      arrivalMs,
    },
  };
}

/** Writes a sample back to its 15-byte wire form, faithfully (power as received, not recomputed). */
export function encodeRawSample(s: RawSample, out?: Uint8Array, at = 0): Uint8Array {
  const buf = out ?? new Uint8Array(PACKET_SIZE);
  const v = new DataView(buf.buffer, buf.byteOffset + at, PACKET_SIZE);
  v.setUint16(OFFSET.seq, s.seq, true);
  v.setUint32(OFFSET.deviceTimeMs, s.deviceTimeMs, true);
  v.setUint16(OFFSET.voltageMv, s.voltageMv, true);
  v.setInt16(OFFSET.currentMa, s.currentMa, true);
  v.setUint32(OFFSET.powerMw, s.powerMw, true);
  v.setUint8(OFFSET.flags, s.flags);
  return buf;
}
