import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  co2AvoidedKg,
  kcal,
  ledHours,
  phoneCharges,
  sustainabilityScore,
  toFootstepEventMessage,
  toHeartbeatMessage,
  validateProfile,
} from '../src/index.js';
import { T0, constant, feedRows, makePipeline, profile } from './helpers.js';

describe('ESG metrics M13-M16 are profile-driven pure functions', () => {
  it('M13: kWh x emission factor', () => {
    expect(co2AvoidedKg(1000, { emissionFactorKgPerKwh: 0.5 })).toBe(0.5);
    expect(co2AvoidedKg(0, { emissionFactorKgPerKwh: 0.5 })).toBe(0);
  });

  it('M14: LED hours and phone charges are energy over the reference loads', () => {
    expect(ledHours(18, { ledWatts: 9 })).toBe(2);
    expect(phoneCharges(30, { phoneBatteryWh: 15 })).toBe(2);
    expect(ledHours(5, { ledWatts: 0 })).toBe(0); // guarded
  });

  it('M15: kcal only when kcal per step is filled in', () => {
    expect(kcal(100, { kcalPerStep: null })).toBeNull();
    expect(kcal(100, { kcalPerStep: 0.04 })).toBe(4);
  });

  it('M16: weighted, each component capped at 100, null when all weights are zero', () => {
    const base = {
      scoreWeights: { carbon: 1, energy: 1, wellness: 1 },
      scoreTargets: { co2Kg: 10, ledHours: 10, steps: 100 },
    };
    expect(sustainabilityScore(base, { co2Kg: 5, ledHours: 10, steps: 100 })).toBe(83.3);
    expect(sustainabilityScore(base, { co2Kg: 999, ledHours: 999, steps: 999 })).toBe(100);
    expect(sustainabilityScore(base, { co2Kg: 0, ledHours: 0, steps: 0 })).toBe(0);
    // weights matter
    const w = { ...base, scoreWeights: { carbon: 3, energy: 0, wellness: 1 } };
    expect(sustainabilityScore(w, { co2Kg: 10, ledHours: 0, steps: 0 })).toBe(75);
    const none = { ...base, scoreWeights: { carbon: 0, energy: 0, wellness: 0 } };
    expect(sustainabilityScore(none, { co2Kg: 1, ledHours: 1, steps: 1 })).toBeNull();
  });

  it('snapshot ESG values come from total energy and the profile', () => {
    const { pipe } = makePipeline({
      priorEnergyWh: 100,
      priorSteps: 50,
      profile: profile({
        emissionFactorKgPerKwh: 0.4,
        ledWatts: 10,
        phoneBatteryWh: 20,
        kcalPerStep: 0.05,
        scoreTargets: { co2Kg: 0.08, ledHours: 20, steps: 100 },
      }),
    });
    feedRows(pipe, constant(2, 50, 5000, 0)); // no session energy
    const m = pipe.snapshot({ nowMs: T0, connection: 'streaming' }).metrics;
    expect(m.totalEnergyWh).toBe(100);
    expect(m.co2AvoidedKg).toBeCloseTo(0.04, 12);
    expect(m.ledHours).toBe(10);
    expect(m.phoneCharges).toBe(5);
    expect(m.kcal).toBe(2.5); // 50 prior steps x 0.05
    expect(m.sustainabilityScore).toBe(50); // carbon 50, energy 50, wellness 50
  });
});

describe('profile validation', () => {
  it('accepts the defaults', () => expect(validateProfile(DEFAULT_PROFILE)).toEqual([]));

  it('rejects bad values', () => {
    expect(validateProfile({ ...DEFAULT_PROFILE, stepThresholdW: 0 })).toContain(
      'stepThresholdW must be > 0',
    );
    expect(validateProfile({ ...DEFAULT_PROFILE, idleThresholdW: -1 })).toContain(
      'idleThresholdW must be >= 0',
    );
    expect(validateProfile({ ...DEFAULT_PROFILE, ledWatts: 0 })).toContain('ledWatts must be > 0');
    expect(validateProfile({ ...DEFAULT_PROFILE, minStepGapMs: 49 })).toContain(
      'minStepGapMs must be >= 50',
    );
    expect(validateProfile({ ...DEFAULT_PROFILE, minPulseMs: -1 })).toContain(
      'minPulseMs must be >= 0',
    );
    expect(validateProfile({ ...DEFAULT_PROFILE, sensorLimitOverrideMa: 0 })).toContain(
      'sensorLimitOverrideMa must be > 0 or null',
    );
    expect(
      validateProfile({ ...DEFAULT_PROFILE, scoreWeights: { carbon: -1, energy: 1, wellness: 1 } }),
    ).toContain('scoreWeights must be >= 0');
    expect(
      validateProfile({ ...DEFAULT_PROFILE, units: { power: 'kW' as never, energy: 'Wh' } }),
    ).toContain('units.power must be W or mW');
    expect(
      validateProfile({ ...DEFAULT_PROFILE, emissionFactorKgPerKwh: NaN }).length,
    ).toBeGreaterThan(0);
  });

  it('the placeholder ESG defaults are labelled as such in the source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/profile.ts', import.meta.url), 'utf8');
    expect(src.match(/PLACEHOLDER/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('cloud-ready message shapes (Data Collection doc payloads)', () => {
  it('footstep_event has exactly the documented fields', () => {
    const m = toFootstepEventMessage(
      {
        t: Date.UTC(2026, 10, 15, 10, 23, 45, 123),
        peakW: 1.1,
        durationMs: 150,
        energyJ: 0.045,
        id: 'F0RCE-01_20261115T102345123Z',
        stepNumber: 42,
        avgW: 0.3,
        voltageV: 5.12,
        currentMa: 180,
      },
      'F0RCE-01',
      42,
    );
    expect(m).toEqual({
      device_id: 'F0RCE-01',
      timestamp_utc: '2026-11-15T10:23:45.123Z',
      event_id: 'F0RCE-01_20261115T102345123Z',
      step_count: 42,
      voltage_V: 5.12,
      current_A: 0.18,
      power_W: 0.9216,
      energy_interval_J: 0.045,
      power_peak_W: 1.1,
    });
  });

  it('heartbeat has exactly the documented fields, nulls when unknown', () => {
    const m = toHeartbeatMessage({
      deviceId: 'F0RCE-01',
      nowMs: Date.UTC(2026, 10, 15, 10, 30),
      lastStepMs: Date.UTC(2026, 10, 15, 10, 28, 12, 345),
      stepCountToday: 46,
      energyTotalJ: 15.2,
      lastCommMs: Date.UTC(2026, 10, 15, 10, 30),
      status: 'OK',
    });
    expect(m).toEqual({
      device_id: 'F0RCE-01',
      timestamp_utc: '2026-11-15T10:30:00.000Z',
      last_step_timestamp: '2026-11-15T10:28:12.345Z',
      step_count_today: 46,
      energy_total_J: 15.2,
      last_comm_utc: '2026-11-15T10:30:00.000Z',
      status: 'OK',
    });
    const idle = toHeartbeatMessage({
      deviceId: 'X',
      nowMs: 0,
      lastStepMs: null,
      stepCountToday: 0,
      energyTotalJ: 0,
      lastCommMs: null,
      status: 'OFFLINE',
    });
    expect(idle.last_step_timestamp).toBeNull();
    expect(idle.last_comm_utc).toBeNull();
  });
});
