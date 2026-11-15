import { describe, expect, it } from 'vitest';
import { FLAG } from '@force/protocol';
import { T0, constant, feedRows, makePipeline, packet } from './helpers.js';

/**
 * The confirmed bench scenario: a 12 V adapter (measured 12.3 V) lighting a 12 V LED through the
 * INA219 (0.1 ohm shunt). The firmware turns a shunt voltage of 42.000 mV into 420 mA
 * (raw 4200 x 10 uV / 100 mohm); this checks that what it sends comes out of the app correctly.
 * Hand calculation: P = 12.3 V x 0.42 A = 5.166 W; 10 s of it is 51.66 J = 0.01435 Wh.
 */
describe('12 V LED through the INA219: firmware numbers to dashboard numbers', () => {
  it('constant 12.3 V x 420 mA for 10 s: 5.166 W, 51.66 J, nothing invented', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(201, 50, 12_300, 420));
    const s = pipe.snapshot({ nowMs: T0 + 10_000, connection: 'streaming' });
    expect(s.metrics.voltageV).toBe(12.3);
    expect(s.metrics.currentMa).toBe(420);
    expect(s.metrics.powerW).toBeCloseTo(5.166, 12);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(51.66, 9);
    expect(s.metrics.sessionEnergyWh).toBeCloseTo(51.66 / 3600, 12);
    expect(s.metrics.peakPowerW).toBeCloseTo(5.166, 12);
    expect(s.metrics.generating).toBe(true);
    expect(s.metrics.sensorLimitReached).toBe(false);
    expect(s.quality.recordedMs).toBe(10_000);
    expect(s.alerts.filter((a) => a.kind === 'sensor_limit' || a.kind === 'sensor_fault')).toEqual(
      [],
    );
  });

  it('the same load switched off reads zero power, not a stand-in value', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(41, 50, 12_300, 0));
    const m = pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics;
    expect(m.powerW).toBe(0);
    expect(m.sessionEnergyJ).toBe(0);
    expect(m.generating).toBe(false);
  });

  it('a few mA of negative offset (as the idle INA219 shows) counts as zero power', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(41, 50, 12_300, -1));
    const s = pipe.snapshot({ nowMs: T0, connection: 'streaming' });
    expect(s.metrics.currentMa).toBe(-1); // signed, as read
    expect(s.metrics.powerW).toBe(0);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.quality.detail.negativePowerSamples).toBe(41);
  });

  it('current at the 3200 mA sensor limit is flagged overrange, and 3 A is not', () => {
    const at = makePipeline();
    feedRows(at.pipe, constant(41, 50, 12_300, 3200));
    expect(
      at.pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.sensorLimitReached,
    ).toBe(true);
    const near = makePipeline();
    feedRows(near.pipe, constant(41, 50, 12_300, 3000)); // the adapter's rating, below the sensor limit
    expect(
      near.pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics.sensorLimitReached,
    ).toBe(false);
  });

  it('an invalid or failed INA219 reading arrives as a fault packet and is never used as data', () => {
    const { pipe } = makePipeline();
    pipe.pushPacket(packet(0, 0, 12_300, 420), T0);
    pipe.pushPacket(packet(1, 50, 0, 0, FLAG.SENSOR_FAULT), T0 + 50); // firmware: fault flag, zero readings
    pipe.pushPacket(packet(2, 100, 12_300, 420), T0 + 100);
    const s = pipe.snapshot({ nowMs: T0 + 100, connection: 'streaming' });
    expect(s.metrics.voltageV).toBe(12.3); // the zeros were not shown as a reading
    expect(s.quality.excludedGapMs).toBe(100); // the span around the fault is excluded, not filled
    expect(s.metrics.sessionEnergyJ).toBe(0);
  });
});
