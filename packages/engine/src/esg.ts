import type { DeviceProfile } from '@force/contracts';

/**
 * ESG conversions (M13-M16). Floating point is fine here: these are display values derived from
 * the exact integer energy, never fed back into it. Every constant comes from the profile.
 */

/** M13: kg CO2 avoided = energy in kWh x grid emission factor. */
export function co2AvoidedKg(
  energyWh: number,
  p: Pick<DeviceProfile, 'emissionFactorKgPerKwh'>,
): number {
  return (energyWh / 1000) * p.emissionFactorKgPerKwh;
}

/** M14: how many hours a reference LED would run on this energy. */
export function ledHours(energyWh: number, p: Pick<DeviceProfile, 'ledWatts'>): number {
  return p.ledWatts > 0 ? energyWh / p.ledWatts : 0;
}

/** M14: how many full charges of the reference phone battery. */
export function phoneCharges(energyWh: number, p: Pick<DeviceProfile, 'phoneBatteryWh'>): number {
  return p.phoneBatteryWh > 0 ? energyWh / p.phoneBatteryWh : 0;
}

/** M15: calories, only when kcal per step is filled in. */
export function kcal(steps: number, p: Pick<DeviceProfile, 'kcalPerStep'>): number | null {
  return p.kcalPerStep === null ? null : steps * p.kcalPerStep;
}

const component = (value: number, target: number): number =>
  target > 0 ? Math.min(100, Math.max(0, (100 * value) / target)) : 0;

/**
 * M16: sustainability score, 0 to 100. Pure function of the profile's weights and targets:
 * each component is scaled 0..100 against its target, then averaged by weight.
 * Returns null when every weight is zero (nothing to score).
 */
export function sustainabilityScore(
  p: Pick<DeviceProfile, 'scoreWeights' | 'scoreTargets'>,
  v: { co2Kg: number; ledHours: number; steps: number },
): number | null {
  const w = p.scoreWeights;
  const total = w.carbon + w.energy + w.wellness;
  if (!(total > 0)) return null;
  const t = p.scoreTargets;
  const score =
    (w.carbon * component(v.co2Kg, t.co2Kg) +
      w.energy * component(v.ledHours, t.ledHours) +
      w.wellness * component(v.steps, t.steps)) /
    total;
  return Math.round(score * 10) / 10;
}
