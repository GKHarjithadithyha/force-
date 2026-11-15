import { describe, expect, it } from 'vitest';
import { FLAG } from '@force/protocol';
import { DEFAULT_PROFILE, validateProfile, withProfileDefaults } from '../src/index.js';
import { T0, constant, feedRows, makePipeline, packet, profile } from './helpers.js';

const snap = (p: ReturnType<typeof makePipeline>['pipe'], connection = 'streaming' as const) =>
  p.snapshot({ nowMs: T0 + 1000, connection });
const kinds = (s: ReturnType<typeof snap>) => s.alerts.map((a) => a.kind);

describe('power input is reported separately from the sensor', () => {
  it('zero current at 12.3 V: input present, measurement valid, no power, no energy', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(41, 50, 12_300, 0));
    const s = snap(pipe);
    expect(s.metrics.measurementValid).toBe(true);
    expect(s.metrics.inputPresent).toBe(true);
    expect(s.metrics.voltageV).toBe(12.3);
    expect(s.metrics.currentMa).toBe(0);
    expect(s.metrics.powerW).toBe(0);
    expect(s.metrics.generating).toBe(false);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(kinds(s)).not.toContain('no_input');
    expect(kinds(s)).not.toContain('sensor_fault');
  });

  it('zero voltage and zero current: sensor fine, NO input, never an active source', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(41, 50, 0, 0));
    const s = snap(pipe);
    expect(s.metrics.measurementValid).toBe(true); // the sensor delivered a real zero
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.metrics.generating).toBe(false);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(kinds(s)).toContain('no_input');
    expect(kinds(s)).not.toContain('sensor_fault');
  });

  it('the real unpowered reading (0.024 V, -1 mA) is NO INPUT, not a normal source', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(81, 50, 24, -1));
    const s = snap(pipe);
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.metrics.measurementValid).toBe(true);
    expect(s.metrics.generating).toBe(false);
    expect(s.metrics.powerW).toBe(0);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    const a = s.alerts.find((x) => x.kind === 'no_input')!;
    expect(a.severity).toBe('warning');
    expect(a.message).toContain('0.02 V');
    expect(a.message).toContain('No power input');
    expect(a.since).toBe(T0); // active from the first sample
  });

  it('the no-input alert only shows while the link is expected to stream', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(41, 50, 24, 0));
    expect(kinds(snap(pipe, 'idle' as never))).not.toContain('no_input');
    expect(kinds(snap(pipe))).toContain('no_input');
  });

  it('the minimum input voltage is configurable: lower removes the alert, higher adds it', () => {
    const off = makePipeline({ profile: profile({ minInputV: 0 }) });
    feedRows(off.pipe, constant(41, 50, 24, 0));
    expect(snap(off.pipe).metrics.inputPresent).toBe(true);
    expect(kinds(snap(off.pipe))).not.toContain('no_input');

    const strict = makePipeline({ profile: profile({ minInputV: 12 }) });
    feedRows(strict.pipe, constant(41, 50, 5000, 100));
    expect(snap(strict.pipe).metrics.inputPresent).toBe(false);
    expect(kinds(snap(strict.pipe))).toContain('no_input');
  });

  it('a profile change applies from the next sample and the alert clears when power returns', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(21, 50, 24, 0));
    expect(kinds(snap(pipe))).toContain('no_input');
    feedRows(pipe, constant(21, 50, 12_300, 420, 1050), { startSeq: 21, arrivalBase: T0 + 1050 });
    const s = snap(pipe);
    expect(s.metrics.inputPresent).toBe(true);
    expect(kinds(s)).not.toContain('no_input');
  });

  it('over 26 V: an error alert, the source is present but out of the INA219 specification', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(21, 50, 27_000, 100));
    const s = snap(pipe);
    const a = s.alerts.find((x) => x.kind === 'over_voltage')!;
    expect(a.severity).toBe('error');
    expect(a.message).toContain('27.00 V');
    expect(s.metrics.inputPresent).toBe(true);
    const ok = makePipeline();
    feedRows(ok.pipe, constant(21, 50, 26_000, 100)); // exactly the rating is within it
    expect(kinds(snap(ok.pipe))).not.toContain('over_voltage');
  });
});

describe('invalid samples and a disconnected sensor', () => {
  it('fault samples: measurement not valid, last real values kept and flagged, alert raised', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(11, 50, 12_300, 420));
    for (let i = 0; i < 10; i++) {
      pipe.pushPacket(packet(11 + i, 550 + i * 50, 0, 0, FLAG.SENSOR_FAULT), T0 + 550 + i * 50);
    }
    const s = snap(pipe);
    expect(s.metrics.measurementValid).toBe(false);
    expect(s.metrics.inputPresent).toBe(false); // cannot claim an input while blind
    expect(s.metrics.voltageV).toBe(12.3); // last REAL value, not the fault zeros
    expect(s.metrics.currentMa).toBe(420);
    expect(kinds(s)).toContain('sensor_fault');
    expect(kinds(s)).not.toContain('no_input'); // no reading, so no input judgement
  });

  it('sensor never answered: nothing is shown as measured', () => {
    const { pipe } = makePipeline();
    for (let i = 0; i < 20; i++)
      pipe.pushPacket(packet(i, i * 50, 0, 0, FLAG.SENSOR_FAULT), T0 + i * 50);
    const s = snap(pipe);
    expect(s.metrics.measurementValid).toBe(false);
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.quality.recordedMs).toBe(0);
    expect(kinds(s)).toContain('sensor_fault');
  });

  it('the sensor coming back clears the fault and the readings are measured again', () => {
    const { pipe } = makePipeline();
    pipe.pushPacket(packet(0, 0, 0, 0, FLAG.SENSOR_FAULT), T0);
    pipe.pushPacket(packet(1, 50, 12_300, 420), T0 + 50);
    const s = snap(pipe);
    expect(s.metrics.measurementValid).toBe(true);
    expect(s.metrics.inputPresent).toBe(true);
    expect(kinds(s)).not.toContain('sensor_fault');
  });

  it('before any sample: nothing valid, no input claimed', () => {
    const { pipe } = makePipeline();
    const s = snap(pipe, 'idle' as never);
    expect(s.metrics.measurementValid).toBe(false);
    expect(s.metrics.inputPresent).toBe(false);
  });
});

describe('energy never accumulates from invalid measurements', () => {
  const power = 12.3 * 0.42; // W, from 12300 mV x 420 mA

  it('only the intervals between two VALID samples are integrated; a fault span is excluded', () => {
    const { pipe } = makePipeline();
    // 11 valid samples (10 intervals of 50 ms), then a fault run, then 11 valid samples
    feedRows(pipe, constant(11, 50, 12_300, 420));
    for (let i = 0; i < 6; i++) {
      pipe.pushPacket(packet(11 + i, 550 + i * 50, 0, 0, FLAG.SENSOR_FAULT), T0 + 550 + i * 50);
    }
    for (let i = 0; i < 11; i++) {
      pipe.pushPacket(packet(17 + i, 850 + i * 50, 12_300, 420), T0 + 850 + i * 50);
    }
    const s = snap(pipe);
    // 10 + 10 valid intervals of 50 ms at 5.166 W; the 300 ms across the fault is not counted
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(power * 0.05 * 20, 9);
    expect(s.quality.recordedMs).toBe(1000);
    expect(s.quality.excludedGapMs).toBe(350); // last valid at 500 ms to first valid again at 850 ms
  });

  it('malformed and out-of-range packets add no energy and no samples', () => {
    const clean = makePipeline();
    feedRows(clean.pipe, constant(21, 50, 12_300, 420));
    const dirty = makePipeline();
    let seq = 0;
    for (let i = 0; i < 21; i++) {
      dirty.pipe.pushPacket(packet(seq++, i * 50, 12_300, 420), T0 + i * 50);
      dirty.pipe.pushPacket(new Uint8Array(7), T0 + i * 50); // truncated
      const bad = packet(seq, i * 50 + 25, 12_300, 420);
      new DataView(bad.buffer).setUint16(6, 50_000, true); // voltage no INA219 can report
      dirty.pipe.pushPacket(bad, T0 + i * 50 + 25);
    }
    const a = snap(clean.pipe);
    const b = snap(dirty.pipe);
    expect(b.metrics.sessionEnergyJ).toBe(a.metrics.sessionEnergyJ);
    expect(b.quality.detail.malformedPackets).toBe(42);
  });

  it('a no-input stretch adds zero energy even for hours of samples', () => {
    const { pipe } = makePipeline();
    feedRows(pipe, constant(3601, 1000, 24, -1)); // 1 h at 1 Hz of 0.024 V / -1 mA
    const s = snap(pipe);
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.quality.recordedMs).toBe(3_600_000);
  });
});

describe('profile compatibility for the new field', () => {
  it('the default profile validates and carries minInputV', () => {
    expect(validateProfile(DEFAULT_PROFILE)).toEqual([]);
    expect(DEFAULT_PROFILE.minInputV).toBe(1);
  });

  it('rejects a negative or non-numeric minimum input', () => {
    expect(validateProfile({ ...DEFAULT_PROFILE, minInputV: -1 })).toContain(
      'minInputV must be >= 0',
    );
    expect(validateProfile({ ...DEFAULT_PROFILE, minInputV: NaN }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...DEFAULT_PROFILE, minInputV: 0 })).toEqual([]);
  });

  it('a profile from the previous version (no minInputV) is completed with the default', () => {
    const { minInputV: _removed, ...old } = DEFAULT_PROFILE;
    expect(validateProfile(old as never).length).toBeGreaterThan(0); // as stored, it is incomplete
    const fixed = withProfileDefaults(old);
    expect(fixed.minInputV).toBe(1);
    expect(validateProfile(fixed)).toEqual([]);
    // values the user did set are kept
    expect(withProfileDefaults({ ...old, stepThresholdW: 3 }).stepThresholdW).toBe(3);
    expect(
      withProfileDefaults({ ...old, scoreWeights: { carbon: 5 } as never }).scoreWeights,
    ).toEqual({
      carbon: 5,
      energy: 1,
      wellness: 1,
    });
  });
});
