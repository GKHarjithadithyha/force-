import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_INFO_VECTORS,
  NAME_VECTORS,
  PACKET_SIZE,
  TELEMETRY_VECTORS,
  computePowerMw,
  deviceNameFromMac,
  formatDeviceInfo,
  packTelemetry,
  parseDeviceInfo,
} from '../src/index.js';
import { GENERATED } from '../scripts/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const toHex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

describe('reference packer vs hand-computed vectors', () => {
  for (const v of TELEMETRY_VECTORS) {
    it(`packs "${v.name}" byte for byte`, () => {
      const out = packTelemetry(v.input);
      expect(out.length).toBe(PACKET_SIZE);
      expect(toHex(out)).toBe(v.hex);
    });
    it(`"${v.name}" hex has 15 bytes and expected power matches the rule`, () => {
      expect(v.hex.split(' ')).toHaveLength(PACKET_SIZE);
      expect(v.expected.powerMw).toBe(computePowerMw(v.input.voltageMv, v.input.currentMa));
    });
  }
  it('has at least three worked examples', () => {
    expect(TELEMETRY_VECTORS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('power rule', () => {
  it('is zero for negative current', () => expect(computePowerMw(5000, -1)).toBe(0));
  it('rounds half up', () => {
    expect(computePowerMw(500, 1)).toBe(1);
    expect(computePowerMw(499, 1)).toBe(0);
    expect(computePowerMw(1500, 1)).toBe(2);
  });
  it('handles the INA219 maximum without overflow', () => {
    expect(computePowerMw(26000, 3200)).toBe(83200);
  });
});

describe('Device Info', () => {
  for (const v of DEVICE_INFO_VECTORS) {
    it(`formats and parses "${v.name}"`, () => {
      expect(formatDeviceInfo(v.info)).toBe(v.json);
      expect(parseDeviceInfo(v.json)).toEqual({ ok: true, info: v.info });
    });
  }
  it('rejects bad input', () => {
    expect(parseDeviceInfo('not json').ok).toBe(false);
    expect(
      parseDeviceInfo('{"proto":2,"id":"FORCE-A1B2","fw":"1","rateHz":20,"limitMa":3200}').ok,
    ).toBe(false);
    expect(
      parseDeviceInfo('{"proto":1,"id":"force-a1b2","fw":"1","rateHz":20,"limitMa":3200}').ok,
    ).toBe(false);
    expect(
      parseDeviceInfo('{"proto":1,"id":"FORCE-A1B2","fw":"1","rateHz":0,"limitMa":3200}').ok,
    ).toBe(false);
    expect(parseDeviceInfo('[]').ok).toBe(false);
  });
});

describe('device name', () => {
  for (const v of NAME_VECTORS) {
    it(`${v.mac} -> ${v.name}`, () => expect(deviceNameFromMac(v.mac)).toBe(v.name));
  }
});

describe('generated artefacts are fresh', () => {
  for (const g of GENERATED) {
    it(`${g.path} matches the generator (run npm run gen:protocol)`, () => {
      const cur = readFileSync(resolve(root, g.path), 'utf8').replace(/\r\n/g, '\n');
      expect(cur).toBe(g.render());
    });
  }
});
