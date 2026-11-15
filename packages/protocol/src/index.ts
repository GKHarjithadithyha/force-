/**
 * F.O.R.C.E wire protocol, version 1.
 *
 * Single source of truth shared by the ESP32 firmware and the web side.
 * `scripts/generate.ts` mirrors these constants into
 * `firmware/include/protocol_generated.h`; a test fails if that file is stale.
 *
 * Do not change anything here without telling the user: both sides must match.
 */

export const PROTOCOL_VERSION = 1;

/** Advertised name is NAME_PREFIX + last four hex characters of the BLE MAC, upper case. */
export const DEVICE_NAME_PREFIX = 'FORCE-';

export const SERVICE_UUID = '3b94f647-2d69-4b87-9cfa-cbd59e4980b1';
/** NOTIFY: one 15-byte telemetry packet per notification. */
export const TELEMETRY_CHAR_UUID = 'e16ad3d7-71eb-4ae8-ae94-701c916112ed';
/** READ: UTF-8 JSON, see {@link DeviceInfoJson}. */
export const DEVICE_INFO_CHAR_UUID = '529e09a0-9596-4c47-a9f5-f02da6b2ba91';

/** Telemetry packet length in bytes. Little-endian, one sample per notification. */
export const PACKET_SIZE = 15;

/** Byte offsets inside the telemetry packet. */
export const OFFSET = {
  seq: 0, // uint16, +1 per sample, wraps at 65536
  deviceTimeMs: 2, // uint32, ms since boot, wraps after ~49.7 days
  voltageMv: 6, // uint16, mV
  currentMa: 8, // int16, mA (signed)
  powerMw: 10, // uint32, mW (0 if current is negative)
  flags: 14, // uint8
} as const;

/** Bits of the flags byte. */
export const FLAG = {
  SENSOR_FAULT: 0x01, // bit0: INA219 not answering
  CURRENT_AT_LIMIT: 0x02, // bit1: current at the sensor limit
} as const;

export const SEQ_MODULUS = 0x10000;
export const DEVICE_TIME_MODULUS = 0x100000000;

/** Largest bus voltage the INA219 can report (13-bit x 4 mV LSB). Anything above is malformed. */
export const MAX_VOLTAGE_MV = 32764;

export interface TelemetryFields {
  seq: number;
  deviceTimeMs: number;
  voltageMv: number;
  currentMa: number;
  powerMw: number;
  flags: number;
}

/** What the firmware knows when it builds a packet; power is derived. */
export interface TelemetryInput {
  seq: number;
  deviceTimeMs: number;
  voltageMv: number;
  currentMa: number;
  flags: number;
}

/**
 * Power in mW: 0 if current is negative, else round-half-up(mV x mA / 1000).
 * mV x mA is exactly microwatts, so this is an integer division with +500.
 */
export function computePowerMw(voltageMv: number, currentMa: number): number {
  if (currentMa < 0) return 0;
  return Math.floor((voltageMv * currentMa + 500) / 1000);
}

/** Reference packer. The firmware packer must produce identical bytes (shared vectors). */
export function packTelemetry(input: TelemetryInput): Uint8Array {
  const out = new Uint8Array(PACKET_SIZE);
  const v = new DataView(out.buffer);
  v.setUint16(OFFSET.seq, input.seq & 0xffff, true);
  v.setUint32(OFFSET.deviceTimeMs, input.deviceTimeMs >>> 0, true);
  v.setUint16(OFFSET.voltageMv, input.voltageMv & 0xffff, true);
  v.setInt16(OFFSET.currentMa, input.currentMa, true);
  v.setUint32(OFFSET.powerMw, computePowerMw(input.voltageMv, input.currentMa) >>> 0, true);
  v.setUint8(OFFSET.flags, input.flags & 0xff);
  return out;
}

/** Device Info characteristic payload (UTF-8 JSON). */
export interface DeviceInfoJson {
  proto: number;
  id: string;
  fw: string;
  rateHz: number;
  limitMa: number;
}

/** Exact text the firmware emits: fixed key order, no whitespace. */
export function formatDeviceInfo(info: DeviceInfoJson): string {
  return `{"proto":${info.proto},"id":"${info.id}","fw":"${info.fw}","rateHz":${info.rateHz},"limitMa":${info.limitMa}}`;
}

export type DeviceInfoParse = { ok: true; info: DeviceInfoJson } | { ok: false; error: string };

const NAME_RE = /^FORCE-[0-9A-F]{4}$/;

export function parseDeviceInfo(text: string): DeviceInfoParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Device Info is not valid JSON' };
  }
  if (typeof raw !== 'object' || raw === null)
    return { ok: false, error: 'Device Info is not an object' };
  const o = raw as Record<string, unknown>;
  if (o.proto !== PROTOCOL_VERSION) {
    return { ok: false, error: `Unsupported protocol version ${String(o.proto)}` };
  }
  if (typeof o.id !== 'string' || !NAME_RE.test(o.id)) return { ok: false, error: 'Bad device id' };
  if (typeof o.fw !== 'string' || o.fw.length === 0 || o.fw.length > 32) {
    return { ok: false, error: 'Bad firmware version' };
  }
  if (!isPosInt(o.rateHz) || o.rateHz > 1000) return { ok: false, error: 'Bad rateHz' };
  if (!isPosInt(o.limitMa) || o.limitMa > 32767) return { ok: false, error: 'Bad limitMa' };
  return {
    ok: true,
    info: { proto: o.proto, id: o.id, fw: o.fw, rateHz: o.rateHz, limitMa: o.limitMa },
  };
}

function isPosInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0;
}

/** "24:6F:28:AA:A1:B2" -> "FORCE-A1B2". Accepts any separator or none. */
export function deviceNameFromMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '');
  return DEVICE_NAME_PREFIX + hex.slice(-4).toUpperCase();
}

export { TELEMETRY_VECTORS, DEVICE_INFO_VECTORS, NAME_VECTORS } from './vectors.js';
export type { TelemetryVector, DeviceInfoVector, NameVector } from './vectors.js';
