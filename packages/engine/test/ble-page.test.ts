import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLAG } from '@force/protocol';
import { decodePacket } from '../src/index.js';
import { T0, makePipeline, packet } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const html = readFileSync(resolve(root, 'tools/ble_check.html'), 'utf8').replace(/\r\n/g, '\n');

interface Sample {
  seq: number;
  deviceTimeMs: number;
  voltageMv: number;
  currentMa: number;
  powerMw: number;
  flags: number;
}
interface Meter {
  push(s: Sample): 'valid' | 'fault';
  reset(): void;
  readonly energyJ: number;
  readonly recordedMs: number;
  readonly excludedMs: number;
  readonly faulted: boolean;
  readonly lastValid: { voltageMv: number; currentMa: number; uw: number } | null;
}
interface Lib {
  makeMeter(): Meter;
  inputState(mv: number, minMv: number): string;
  sensorState(s: { flags: number; currentMa: number }): string;
  shuntMohmFromLimit(limitMa: number): number | null;
  showPrimary(live: boolean, inputText: string | null): boolean;
  makeCapture(): {
    add(s: Sample): void;
    result(): {
      samples: number;
      faults: number;
      meanV: number;
      minV: number;
      maxV: number;
      meanMa: number;
      minMa: number;
      maxMa: number;
      meanW: number;
    } | null;
  };
  BUS_RATING_MV: number;
}

const block = /\/\/ <meter>([\s\S]*?)\/\/ <\/meter>/.exec(html);
const lib = new Function(
  `${block![1]}\nreturn { makeMeter, inputState, sensorState, shuntMohmFromLimit, showPrimary, makeCapture, BUS_RATING_MV };`,
)() as Lib;

type Row = [t: number, mv: number, ma: number, flags?: number];

/** Runs the same packets through the engine pipeline and the page's meter. */
function both(rows: Row[], startSeq = 0) {
  const { pipe } = makePipeline();
  const meter = lib.makeMeter();
  let seq = startSeq;
  for (const [t, mv, ma, flags = 0] of rows) {
    const bytes = packet(seq++ & 0xffff, t % 4294967296, mv, ma, flags);
    pipe.pushPacket(bytes, T0 + t);
    const d = decodePacket(bytes, 0);
    if (d.ok) meter.push(d.sample);
  }
  const snap = pipe.snapshot({ nowMs: T0, connection: 'streaming' });
  return { snap, meter };
}

const steady = (n: number, mv: number, ma: number, start = 0): Row[] =>
  Array.from({ length: n }, (_, i): Row => [start + i * 50, mv, ma]);

describe('tools/ble_check.html meter logic agrees with the engine', () => {
  it('is embedded between markers', () => expect(block).not.toBeNull());

  it('12.3 V x 420 mA for 10 s: 51.66 J, same as the engine', () => {
    const { snap, meter } = both(steady(201, 12_300, 420));
    expect(meter.energyJ).toBeCloseTo(51.66, 9);
    expect(meter.energyJ).toBe(snap.metrics.sessionEnergyJ);
    expect(meter.recordedMs).toBe(snap.quality.recordedMs);
    expect(meter.excludedMs).toBe(snap.quality.excludedGapMs);
  });

  it('a sensor-fault run adds nothing and the span around it is excluded, like the engine', () => {
    const rows: Row[] = [
      ...steady(11, 12_300, 420),
      ...Array.from({ length: 6 }, (_, i): Row => [550 + i * 50, 0, 0, FLAG.SENSOR_FAULT]),
      ...steady(11, 12_300, 420, 850),
    ];
    const { snap, meter } = both(rows);
    expect(meter.energyJ).toBe(snap.metrics.sessionEnergyJ);
    expect(meter.recordedMs).toBe(snap.quality.recordedMs);
    expect(meter.excludedMs).toBe(snap.quality.excludedGapMs);
    expect(meter.excludedMs).toBe(350);
  });

  it('a 5 s dropout is excluded, never filled, like the engine', () => {
    const rows: Row[] = [...steady(11, 12_300, 420), ...steady(11, 12_300, 420, 5500)];
    const { snap, meter } = both(rows);
    expect(meter.energyJ).toBe(snap.metrics.sessionEnergyJ);
    expect(meter.excludedMs).toBe(snap.quality.excludedGapMs);
    expect(meter.excludedMs).toBe(5000);
  });

  it('negative current and the unpowered reading add no energy', () => {
    const a = both(steady(41, 12_300, -3));
    expect(a.meter.energyJ).toBe(0);
    expect(a.snap.metrics.sessionEnergyJ).toBe(0);
    const b = both(steady(41, 24, -1));
    expect(b.meter.energyJ).toBe(0);
  });

  it('device time wrapping past 2^32 is a small step, like the engine', () => {
    const start = 4294967296 - 100;
    const rows: Row[] = Array.from({ length: 5 }, (_, i): Row => [start + i * 50, 12_300, 420]);
    const { snap, meter } = both(rows);
    expect(meter.energyJ).toBe(snap.metrics.sessionEnergyJ);
    expect(meter.recordedMs).toBe(200);
  });

  it('a fault sample never becomes the last valid reading', () => {
    const meter = lib.makeMeter();
    meter.push({
      seq: 0,
      deviceTimeMs: 0,
      voltageMv: 12_300,
      currentMa: 420,
      powerMw: 5166,
      flags: 0,
    });
    meter.push({
      seq: 1,
      deviceTimeMs: 50,
      voltageMv: 0,
      currentMa: 0,
      powerMw: 0,
      flags: FLAG.SENSOR_FAULT,
    });
    expect(meter.faulted).toBe(true);
    expect(meter.lastValid).toMatchObject({ voltageMv: 12_300, currentMa: 420 }); // last REAL values
    meter.push({
      seq: 2,
      deviceTimeMs: 100,
      voltageMv: 12_300,
      currentMa: 420,
      powerMw: 5166,
      flags: 0,
    });
    expect(meter.faulted).toBe(false);
  });
});

describe('tools/ble_check.html status text', () => {
  it('power input: unpowered, present, over-voltage, at the boundaries', () => {
    expect(lib.inputState(24, 1000)).toBe('NO INPUT (UNDERVOLTAGE)'); // the real 0.024 V reading
    expect(lib.inputState(999, 1000)).toBe('NO INPUT (UNDERVOLTAGE)');
    expect(lib.inputState(1000, 1000)).toBe('PRESENT');
    expect(lib.inputState(12_300, 1000)).toBe('PRESENT');
    expect(lib.inputState(26_000, 1000)).toBe('PRESENT');
    expect(lib.inputState(26_001, 1000)).toBe('OVER VOLTAGE');
    expect(lib.inputState(24, 0)).toBe('PRESENT'); // threshold 0 switches the check off
  });

  it('sensor status: fault, overrange, reverse current, normal', () => {
    expect(lib.sensorState({ flags: FLAG.SENSOR_FAULT, currentMa: 0 })).toBe('SENSOR FAULT');
    expect(lib.sensorState({ flags: FLAG.CURRENT_AT_LIMIT, currentMa: 3200 })).toBe('OVERRANGE');
    expect(lib.sensorState({ flags: 0, currentMa: -10 })).toBe('REVERSE CURRENT');
    expect(lib.sensorState({ flags: 0, currentMa: -2 })).toBe('NORMAL'); // offset noise
    expect(lib.sensorState({ flags: 0, currentMa: 420 })).toBe('NORMAL');
  });

  it('shunt resistance comes from Device Info (limitMa = 320000 / shunt), never assumed', () => {
    expect(lib.shuntMohmFromLimit(3200)).toBe(100);
    expect(lib.shuntMohmFromLimit(6400)).toBe(50);
    expect(lib.shuntMohmFromLimit(0)).toBeNull();
    expect(lib.shuntMohmFromLimit(-1)).toBeNull();
  });

  it('the rating the page uses is the INA219 26 V', () => expect(lib.BUS_RATING_MV).toBe(26000));
});

describe('tools/ble_check.html no-input display and validation capture', () => {
  it('the primary cards show a dash when there is no power input, but not for a real source', () => {
    expect(lib.showPrimary(true, 'NO INPUT (UNDERVOLTAGE)')).toBe(false);
    expect(lib.showPrimary(true, 'PRESENT')).toBe(true);
    expect(lib.showPrimary(true, 'OVER VOLTAGE')).toBe(true); // a live out-of-spec source is still shown
    expect(lib.showPrimary(false, 'PRESENT')).toBe(false); // not live: never shown
    expect(lib.showPrimary(false, null)).toBe(false);
  });

  it('the raw reading stays available in diagnostics and the dash logic does not hide it', () => {
    expect(html).toContain('id="rawline"');
    expect(html).toContain("$('rawline').textContent = (lv.voltageMv");
    expect(html).toContain('showPrimary(live, input)');
  });

  const sample = (mv: number, ma: number, flags = 0): Sample => ({
    seq: 0,
    deviceTimeMs: 0,
    voltageMv: mv,
    currentMa: ma,
    powerMw: 0,
    flags,
  });

  it('averages valid samples: 12.3 V and 400..440 mA gives a 420 mA mean and 5.166 W', () => {
    const c = lib.makeCapture();
    for (const ma of [400, 440, 420, 420]) c.add(sample(12_300, ma));
    const r = c.result()!;
    expect(r.samples).toBe(4);
    expect(r.meanV).toBeCloseTo(12.3, 9);
    expect(r.meanMa).toBe(420);
    expect(r.minMa).toBe(400);
    expect(r.maxMa).toBe(440);
    expect(r.meanW).toBeCloseTo(5.166, 9);
  });

  it('fault samples are counted but never averaged; negative power counts as zero', () => {
    const c = lib.makeCapture();
    c.add(sample(12_300, 420));
    c.add(sample(0, 0, FLAG.SENSOR_FAULT));
    c.add(sample(12_300, -10));
    const r = c.result()!;
    expect(r.samples).toBe(2);
    expect(r.faults).toBe(1);
    expect(r.meanMa).toBe(205); // (420 - 10) / 2, signed as read
    expect(r.meanW).toBeCloseTo((12.3 * 0.42) / 2, 9); // the -10 mA sample adds 0 W
  });

  it('an empty capture yields nothing, not zeros', () => {
    const c = lib.makeCapture();
    expect(c.result()).toBeNull();
    c.add(sample(0, 0, FLAG.SENSOR_FAULT));
    expect(c.result()).toBeNull();
  });
});

describe('tools/ble_check.html behaviour that must stay true', () => {
  it('needs no USB: it uses Web Bluetooth only', () => {
    expect(html).toContain('navigator.bluetooth');
    expect(html).not.toContain('navigator.serial');
  });

  it('shows no live number unless the link is live: the dash placeholder and all six states exist', () => {
    expect(html).toContain("setLive(id, '—')");
    for (const s of [
      'NOT CONNECTED',
      'CONNECTING',
      'STREAMING',
      'STALE',
      'RECONNECTING',
      'DISCONNECTED',
    ]) {
      expect(html).toContain(`'${s}'`);
    }
  });

  it('reconnects with the engine back-off for 60 s and flags stale after 1 s', () => {
    expect(html).toContain('[1000, 2000, 4000, 5000]');
    expect(html).toContain('Date.now() + 60000');
    expect(html).toContain('now - lastPacketPerf > 1000');
  });

  it('counts and drops malformed packets and impossible voltages', () => {
    expect(html).toContain('malformed packet');
    expect(html).toContain('impossible voltage');
  });
});
