import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_INFO_CHAR_UUID,
  DEVICE_NAME_PREFIX,
  PACKET_SIZE,
  SERVICE_UUID,
  TELEMETRY_CHAR_UUID,
  TELEMETRY_VECTORS,
} from '../src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');
const bytesOf = (hex: string) => Uint8Array.from(hex.split(' ').map((b) => parseInt(b, 16)));

describe('tools/ble_check.html agrees with the protocol package', () => {
  const html = read('tools/ble_check.html');

  it('uses the same name prefix, UUIDs and packet size', () => {
    expect(html).toContain(`const NAME_PREFIX = '${DEVICE_NAME_PREFIX}';`);
    expect(html).toContain(`const SERVICE_UUID = '${SERVICE_UUID}';`);
    expect(html).toContain(`const TELEMETRY_UUID = '${TELEMETRY_CHAR_UUID}';`);
    expect(html).toContain(`const DEVICE_INFO_UUID = '${DEVICE_INFO_CHAR_UUID}';`);
    expect(html).toContain(`const PACKET_SIZE = ${PACKET_SIZE};`);
  });

  it('its embedded decoder reads every shared worked example correctly', () => {
    const m = /\/\/ <decoder>([\s\S]*?)\/\/ <\/decoder>/.exec(html);
    expect(m).not.toBeNull();
    const decode = new Function(`${m![1]}\nreturn decodeTelemetry;`)() as (
      dv: DataView,
    ) => Record<string, number> | null;
    for (const v of TELEMETRY_VECTORS) {
      const b = bytesOf(v.hex);
      expect(decode(new DataView(b.buffer))).toEqual(v.expected);
    }
    expect(decode(new DataView(new ArrayBuffer(14)))).toBeNull();
  });
});

describe('tools/ble_check.html pulse analyser', () => {
  const html = read('tools/ble_check.html');
  const m = /\/\/ <pulses>([\s\S]*?)\/\/ <\/pulses>/.exec(html);
  type Pulse = { widthMs: number; samples: number; peakW: number } | null;
  const lib = new Function(`${m![1]}
return { makePulseTracker, pulseAdvice };`)() as {
    makePulseTracker(th: number): { update(t: number, uw: number): Pulse };
    pulseAdvice(counts: number[]): string;
  };

  it('is embedded between markers', () => expect(m).not.toBeNull());

  it('measures a valid pulse: width from first sample above half to the closing sample', () => {
    const t = lib.makePulseTracker(0.5);
    const watts = [0, 0.3, 2, 1, 0.2, 0];
    const out = watts.map((w, i) => t.update(i * 50, w * 1e6)).filter(Boolean);
    expect(out).toEqual([{ widthMs: 150, samples: 3, peakW: 2 }]);
  });

  it('ignores a pulse that never passes the full threshold', () => {
    const t = lib.makePulseTracker(0.5);
    const out = [0, 0.3, 0.4, 0.2, 0].map((w, i) => t.update(i * 50, w * 1e6)).filter(Boolean);
    expect(out).toEqual([]);
  });

  it('advises raising the rate when pulses span fewer than 4 samples', () => {
    expect(lib.pulseAdvice([2, 2, 3, 2, 2, 3])).toMatch(/Raise SAMPLE_RATE_HZ/);
    expect(lib.pulseAdvice([5, 6, 5, 7, 6])).toMatch(/enough/);
    expect(lib.pulseAdvice([2, 2])).toMatch(/at least 5 pulses/);
  });
});

describe('firmware/include/config.h matches the protocol', () => {
  const config = read('firmware/include/config.h');
  const generated = read('firmware/include/protocol_generated.h');

  it('takes protocol constants from the generated header and never redefines them', () => {
    expect(config).toContain('#include "protocol_generated.h"');
    expect(config).not.toMatch(/#define\s+FORCE_(SERVICE|TELEMETRY|DEVICE_INFO)_UUID/);
    expect(config).not.toMatch(/#define\s+FORCE_(PACKET_SIZE|NAME_PREFIX|PROTO_VERSION)/);
  });

  it('the generated header carries the protocol UUIDs and prefix', () => {
    expect(generated).toContain(`#define FORCE_SERVICE_UUID "${SERVICE_UUID}"`);
    expect(generated).toContain(`#define FORCE_TELEMETRY_UUID "${TELEMETRY_CHAR_UUID}"`);
    expect(generated).toContain(`#define FORCE_DEVICE_INFO_UUID "${DEVICE_INFO_CHAR_UUID}"`);
    expect(generated).toContain(`#define FORCE_NAME_PREFIX "${DEVICE_NAME_PREFIX}"`);
  });

  it('default sample rate is at least 20 Hz and divides 1000', () => {
    const rate = Number(/#define SAMPLE_RATE_HZ (\d+)/.exec(config)![1]);
    expect(rate).toBeGreaterThanOrEqual(20);
    expect(1000 % rate).toBe(0);
  });

  it('sensor limit derives from the shunt and gives the briefed 3200 mA at 0.1 ohm', () => {
    const shunt = Number(/#define INA219_SHUNT_MOHM (\d+)/.exec(config)![1]);
    expect(shunt).toBe(100);
    expect(config).toContain('#define SENSOR_LIMIT_MA (320000 / INA219_SHUNT_MOHM)');
    expect(320000 / shunt).toBe(3200);
  });

  it('uses the briefed I2C pins', () => {
    expect(config).toContain('#define I2C_SDA_PIN 21');
    expect(config).toContain('#define I2C_SCL_PIN 22');
  });
});

describe('firmware/src/main.cpp registers the GATT service (found on the first real BLE connection)', () => {
  const main = read('firmware/src/main.cpp');

  it('starts the service BEFORE the server: NimBLE 2.x needs both, in that order', () => {
    // look at code only: the explanation above the calls mentions both names
    const code = main
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    const svc = code.indexOf('service->start()');
    const srv = code.indexOf('server->start()');
    expect(svc).toBeGreaterThan(-1);
    expect(srv).toBeGreaterThan(-1);
    expect(svc).toBeLessThan(srv);
  });

  it('reports a registration failure on serial instead of failing silently', () => {
    expect(main).toContain('GATT service failed to start');
    expect(main).toContain('GATT service is not registered');
  });
});

describe('firmware/platformio.ini pins its dependencies', () => {
  const ini = read('firmware/platformio.ini');
  it('pins the platform and NimBLE-Arduino to exact versions', () => {
    expect(ini).toMatch(/platform = espressif32@\d+\.\d+\.\d+/);
    expect(ini).toMatch(/h2zero\/NimBLE-Arduino@\d+\.\d+\.\d+/);
    expect(ini).not.toMatch(/@[\^~*]/);
  });
  it('uses 115200 monitor and 921600 upload', () => {
    expect(ini).toContain('monitor_speed = 115200');
    expect(ini).toContain('upload_speed = 921600');
  });
});
