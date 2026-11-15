import type { DeviceProfile } from '@force/contracts';

/**
 * Default profile. EVERY ESG value here is a clearly labelled PLACEHOLDER until the business
 * decides (open items: score formula, grid emission factor, wellness definition). Nothing in the
 * engine hard-codes them: they are read from the profile.
 */
export const DEFAULT_PROFILE: DeviceProfile = {
  // The Data Collection doc reports 0.5 to 2.5 W combined at the real tile (not the 83 W sensor
  // limit), so thresholds are tuned for that scale. PLACEHOLDERS: calibrate on the real tile.
  idleThresholdW: 0.05,
  stepThresholdW: 0.5,
  minStepGapMs: 250,
  idleHoldMs: 1000,
  // PLACEHOLDER: rough global-average grid intensity, kg CO2 per kWh. Replace with the agreed factor.
  emissionFactorKgPerKwh: 0.475,
  ledWatts: 9,
  phoneBatteryWh: 15,
  kcalPerStep: null,
  // PLACEHOLDER: equal weights, arbitrary targets. The score is a pure function of these.
  scoreWeights: { carbon: 1, energy: 1, wellness: 1 },
  // at ~0.15 J per step, 1000 steps is only ~0.04 Wh
  scoreTargets: { co2Kg: 0.00005, ledHours: 0.01, steps: 1000 },
  sensorLimitOverrideMa: null,
  noDataAlertMs: 5000,
  noGenerationAlertMs: 60000,
  minPulseMs: 0,
  // ASSUMPTION: the generator's valid output range is not known yet. Below 1 V there is no usable
  // power source at the sensor input (an idle footstep tile reads about 0 V between steps).
  minInputV: 1,
  units: { power: 'W', energy: 'Wh' },
};

/**
 * Fills fields a profile does not have yet with the defaults. Profiles saved or exported by an
 * earlier version lack newer additive fields (for example `minInputV`); they must keep working.
 * Unknown extra fields are kept. Nested settings are merged one level down.
 */
export function withProfileDefaults(p: Partial<DeviceProfile>): DeviceProfile {
  return {
    ...DEFAULT_PROFILE,
    ...p,
    scoreWeights: { ...DEFAULT_PROFILE.scoreWeights, ...(p.scoreWeights ?? {}) },
    scoreTargets: { ...DEFAULT_PROFILE.scoreTargets, ...(p.scoreTargets ?? {}) },
    units: { ...DEFAULT_PROFILE.units, ...(p.units ?? {}) },
  };
}

export function cloneProfile(p: DeviceProfile): DeviceProfile {
  return {
    ...p,
    scoreWeights: { ...p.scoreWeights },
    scoreTargets: { ...p.scoreTargets },
    units: { ...p.units },
  };
}

const finiteNonNeg = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;
const finitePos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Returns a list of problems; empty means the profile is usable. */
export function validateProfile(p: DeviceProfile): string[] {
  const e: string[] = [];
  if (!finiteNonNeg(p.idleThresholdW)) e.push('idleThresholdW must be >= 0');
  if (!finitePos(p.stepThresholdW)) e.push('stepThresholdW must be > 0');
  // DCR: two triggers less than 50 ms apart are noise, so a smaller gap is not allowed.
  if (!finiteNonNeg(p.minStepGapMs) || p.minStepGapMs < 50) e.push('minStepGapMs must be >= 50');
  if (!finiteNonNeg(p.idleHoldMs)) e.push('idleHoldMs must be >= 0');
  if (!finiteNonNeg(p.emissionFactorKgPerKwh)) e.push('emissionFactorKgPerKwh must be >= 0');
  if (!finitePos(p.ledWatts)) e.push('ledWatts must be > 0');
  if (!finitePos(p.phoneBatteryWh)) e.push('phoneBatteryWh must be > 0');
  if (p.kcalPerStep !== null && !finiteNonNeg(p.kcalPerStep))
    e.push('kcalPerStep must be >= 0 or null');
  const w = p.scoreWeights;
  if (!finiteNonNeg(w?.carbon) || !finiteNonNeg(w?.energy) || !finiteNonNeg(w?.wellness)) {
    e.push('scoreWeights must be >= 0');
  }
  const t = p.scoreTargets;
  if (!finitePos(t?.co2Kg) || !finitePos(t?.ledHours) || !finitePos(t?.steps)) {
    e.push('scoreTargets must be > 0');
  }
  if (p.sensorLimitOverrideMa !== null && !finitePos(p.sensorLimitOverrideMa)) {
    e.push('sensorLimitOverrideMa must be > 0 or null');
  }
  if (!finitePos(p.noDataAlertMs)) e.push('noDataAlertMs must be > 0');
  if (!finitePos(p.noGenerationAlertMs)) e.push('noGenerationAlertMs must be > 0');
  if (!finiteNonNeg(p.minPulseMs)) e.push('minPulseMs must be >= 0');
  if (!finiteNonNeg(p.minInputV)) e.push('minInputV must be >= 0');
  if (p.units?.power !== 'W' && p.units?.power !== 'mW') e.push('units.power must be W or mW');
  if (!['Wh', 'J', 'mWh'].includes(p.units?.energy)) e.push('units.energy must be Wh, J or mWh');
  return e;
}
