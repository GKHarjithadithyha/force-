import type { DeviceInfoJson, TelemetryFields, TelemetryInput } from './index.js';

/**
 * Worked example packets. The hex was computed by hand, independently of the
 * packer, so a packer bug cannot hide behind a vector derived from it.
 * Used by: packages/protocol tests, packages/engine decoder tests, firmware host tests,
 * and docs/PACKET_EXAMPLES.md (all generated from this file).
 */
export interface TelemetryVector {
  name: string;
  description: string;
  input: TelemetryInput;
  /** What a decoder must read back (power is derived by the packer). */
  expected: TelemetryFields;
  /** 15 bytes, space separated hex, byte 0 first. */
  hex: string;
}

export const TELEMETRY_VECTORS: readonly TelemetryVector[] = [
  {
    name: 'typical',
    description: '5.000 V, 250 mA: 1.25 W. Check little-endian layout.',
    input: { seq: 1, deviceTimeMs: 1000, voltageMv: 5000, currentMa: 250, flags: 0 },
    expected: {
      seq: 1,
      deviceTimeMs: 1000,
      voltageMv: 5000,
      currentMa: 250,
      powerMw: 1250,
      flags: 0,
    },
    hex: '01 00 E8 03 00 00 88 13 FA 00 E2 04 00 00 00',
  },
  {
    name: 'negative_current',
    description: 'Current -12 mA is int16 0xFFF4; power is forced to 0.',
    input: { seq: 2, deviceTimeMs: 1050, voltageMv: 4980, currentMa: -12, flags: 0 },
    expected: { seq: 2, deviceTimeMs: 1050, voltageMv: 4980, currentMa: -12, powerMw: 0, flags: 0 },
    hex: '02 00 1A 04 00 00 74 13 F4 FF 00 00 00 00 00',
  },
  {
    name: 'seq_max_and_limit_flag',
    description: 'seq 65535 (about to wrap), 12 V at 3200 mA = 38.4 W, current-at-limit flag.',
    input: { seq: 65535, deviceTimeMs: 12345678, voltageMv: 12000, currentMa: 3200, flags: 0x02 },
    expected: {
      seq: 65535,
      deviceTimeMs: 12345678,
      voltageMv: 12000,
      currentMa: 3200,
      powerMw: 38400,
      flags: 0x02,
    },
    hex: 'FF FF 4E 61 BC 00 E0 2E 80 0C 00 96 00 00 02',
  },
  {
    name: 'seq_wrapped_time_max_sensor_fault',
    description: 'seq wrapped to 0, device time at 2^32-1 ms, sensor fault flag, zero readings.',
    input: { seq: 0, deviceTimeMs: 4294967295, voltageMv: 0, currentMa: 0, flags: 0x01 },
    expected: {
      seq: 0,
      deviceTimeMs: 4294967295,
      voltageMv: 0,
      currentMa: 0,
      powerMw: 0,
      flags: 0x01,
    },
    hex: '00 00 FF FF FF FF 00 00 00 00 00 00 00 00 01',
  },
  {
    name: 'power_rounds_half_up',
    description: '500 mV x 1 mA = 500 uW = 0.5 mW rounds up to 1 mW.',
    input: { seq: 3, deviceTimeMs: 2000, voltageMv: 500, currentMa: 1, flags: 0 },
    expected: { seq: 3, deviceTimeMs: 2000, voltageMv: 500, currentMa: 1, powerMw: 1, flags: 0 },
    hex: '03 00 D0 07 00 00 F4 01 01 00 01 00 00 00 00',
  },
  {
    name: 'power_rounds_down',
    description: '499 mV x 1 mA = 499 uW = 0.499 mW rounds down to 0 mW.',
    input: { seq: 4, deviceTimeMs: 2050, voltageMv: 499, currentMa: 1, flags: 0 },
    expected: { seq: 4, deviceTimeMs: 2050, voltageMv: 499, currentMa: 1, powerMw: 0, flags: 0 },
    hex: '04 00 02 08 00 00 F3 01 01 00 00 00 00 00 00',
  },
];

export interface DeviceInfoVector {
  name: string;
  info: DeviceInfoJson;
  json: string;
}

export const DEVICE_INFO_VECTORS: readonly DeviceInfoVector[] = [
  {
    name: 'default',
    info: { proto: 1, id: 'FORCE-A1B2', fw: '1.0.0', rateHz: 20, limitMa: 3200 },
    json: '{"proto":1,"id":"FORCE-A1B2","fw":"1.0.0","rateHz":20,"limitMa":3200}',
  },
  {
    name: 'fifty_hz',
    info: { proto: 1, id: 'FORCE-00FF', fw: '1.2.3', rateHz: 50, limitMa: 3200 },
    json: '{"proto":1,"id":"FORCE-00FF","fw":"1.2.3","rateHz":50,"limitMa":3200}',
  },
];

export interface NameVector {
  mac: string;
  name: string;
}

export const NAME_VECTORS: readonly NameVector[] = [
  { mac: '24:6F:28:AA:A1:B2', name: 'FORCE-A1B2' },
  { mac: 'a4:cf:12:00:0f:ff', name: 'FORCE-0FFF' },
  { mac: '00:00:00:00:00:0a', name: 'FORCE-000A' },
];
