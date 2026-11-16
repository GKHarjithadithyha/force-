import { describe, expect, it } from 'vitest';
import {
  ASSUMPTION_LIMITS, DEFAULT_ASSUMPTIONS, computeImpact, formatDistance, formatDuration, formatEnergy, formatVolume,
  milestoneKm, parseAssumption, pickEnergy, readImpactAssumptions, roadProgress, sanitizeAssumptions, sceneState, summarize,
} from '@/lib/impact';
import type { StateInput } from '@/lib/impact';

const A = DEFAULT_ASSUMPTIONS;

describe('assumptions', () => {
  it('defaults are scooter 30 Wh/km, petrol 40 km/L, house 100 W, LED 9 W', () => {
    expect(A).toEqual({ scooterWhPerKm: 30, petrolKmPerLitre: 40, houseLoadW: 100, ledW: 9 });
  });
  it('accepts values inside the limits and rejects everything else', () => {
    expect(parseAssumption('scooterWhPerKm', '35')).toBe(35);
    expect(parseAssumption('ledW', 0.5)).toBe(0.5);
    expect(parseAssumption('ledW', '0.4')).toBeNull();
    expect(parseAssumption('scooterWhPerKm', '0')).toBeNull();
    expect(parseAssumption('scooterWhPerKm', '-30')).toBeNull();
    expect(parseAssumption('petrolKmPerLitre', 'abc')).toBeNull();
    expect(parseAssumption('petrolKmPerLitre', '')).toBeNull();
    expect(parseAssumption('houseLoadW', Number.NaN)).toBeNull();
    expect(parseAssumption('houseLoadW', Infinity)).toBeNull();
    expect(parseAssumption('houseLoadW', 10_001)).toBeNull();
    expect(Object.keys(ASSUMPTION_LIMITS)).toHaveLength(4);
  });
  it('sanitize keeps valid fields and falls back per field', () => {
    expect(sanitizeAssumptions({ scooterWhPerKm: 45, petrolKmPerLitre: 'x', houseLoadW: 0, ledW: 12 })).toEqual({ scooterWhPerKm: 45, petrolKmPerLitre: 40, houseLoadW: 100, ledW: 12 });
    expect(sanitizeAssumptions(null)).toEqual(A);
    expect(sanitizeAssumptions('junk')).toEqual(A);
  });
  it('reads build-time overrides, ignoring invalid text', () => {
    expect(readImpactAssumptions({ scooterWhPerKm: '25', petrolKmPerLitre: undefined, houseLoadW: 'many', ledW: '7' })).toEqual({ scooterWhPerKm: 25, petrolKmPerLitre: 40, houseLoadW: 100, ledW: 7 });
  });
});

describe('computeImpact (Wh -> km, litres, seconds)', () => {
  it('1 kWh = 1000 Wh -> 33.33 km, 0.8333 L, 10 h of a 100 W load, 111.1 h of a 9 W LED', () => {
    const r = computeImpact(1000, A)!;
    expect(r.distanceKm).toBeCloseTo(100 / 3, 9);
    expect(r.petrolLitres).toBeCloseTo(5 / 6, 9);
    expect(r.houseSeconds).toBeCloseTo(36_000, 6);
    expect(r.ledSeconds).toBeCloseTo(400_000, 6);
  });
  it('1 Wh -> 33.33 m, 0.833 mL, 36 s, 400 s', () => {
    const r = computeImpact(1, A)!;
    expect(r.distanceKm * 1000).toBeCloseTo(33.3333, 3);
    expect(r.petrolLitres * 1000).toBeCloseTo(0.83333, 4);
    expect(r.houseSeconds).toBeCloseTo(36, 9);
    expect(r.ledSeconds).toBeCloseTo(400, 9);
  });
  it('a real reading: 0.4592 Wh', () => {
    const r = computeImpact(0.4592, A)!;
    expect(r.distanceKm * 1000).toBeCloseTo(15.3067, 3);
    expect(r.petrolLitres * 1000).toBeCloseTo(0.38267, 4);
    expect(r.houseSeconds).toBeCloseTo(16.5312, 3);
    expect(r.ledSeconds).toBeCloseTo(183.68, 3);
  });
  it('honest zero: no energy is zero distance, zero petrol, zero time', () => {
    const r = computeImpact(0, A)!;
    expect(r).toEqual({ energyWh: 0, distanceKm: 0, petrolLitres: 0, houseSeconds: 0, ledSeconds: 0 });
  });
  it('uses the configured assumptions, not constants', () => {
    const r = computeImpact(1000, { scooterWhPerKm: 50, petrolKmPerLitre: 25, houseLoadW: 250, ledW: 12 })!;
    expect(r.distanceKm).toBeCloseTo(20, 9);
    expect(r.petrolLitres).toBeCloseTo(0.8, 9);
    expect(r.houseSeconds).toBeCloseTo(14_400, 6);
    expect(r.ledSeconds).toBeCloseTo(300_000, 6);
  });
  it('unknown or invalid energy is null, never 0', () => {
    for (const bad of [null, undefined, Number.NaN, -1, Infinity, -Infinity]) expect(computeImpact(bad, A)).toBeNull();
  });
  it('invalid assumptions give null instead of Infinity', () => {
    expect(computeImpact(10, { ...A, scooterWhPerKm: 0 })).toBeNull();
    expect(computeImpact(10, { ...A, ledW: Number.NaN })).toBeNull();
  });
});

describe('text', () => {
  it('energy: Wh below 1000, kWh from 1000, tiny values stay honest', () => {
    expect(formatEnergy(0)).toBe('0 Wh');
    expect(formatEnergy(0.4592)).toBe('0.459 Wh');
    expect(formatEnergy(1.5)).toBe('1.5 Wh');
    expect(formatEnergy(12.345)).toBe('12.3 Wh');
    expect(formatEnergy(999.96)).toBe('1 kWh');
    expect(formatEnergy(1000)).toBe('1 kWh');
    expect(formatEnergy(1234)).toBe('1.23 kWh');
    expect(formatEnergy(25_000)).toBe('25 kWh');
    expect(formatEnergy(0.0004)).toBe('< 0.001 Wh');
    expect(formatEnergy(null)).toBe('—');
    expect(formatEnergy(-3)).toBe('—');
  });
  it('distance: metres below 1 km, kilometres from 1 km', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(1 / 30)).toBe('33.3 m');
    expect(formatDistance(0.0153067)).toBe('15.3 m');
    expect(formatDistance(0.25)).toBe('250 m');
    expect(formatDistance(0.9999)).toBe('1 km');
    expect(formatDistance(1.5)).toBe('1.5 km');
    expect(formatDistance(100 / 3)).toBe('33.3 km');
    expect(formatDistance(250.4)).toBe('250 km');
    expect(formatDistance(0.00001)).toBe('< 0.1 m');
    expect(formatDistance(Number.NaN)).toBe('—');
  });
  it('petrol: millilitres below 1 L, litres from 1 L', () => {
    expect(formatVolume(0)).toBe('0 mL');
    expect(formatVolume(0.000_833)).toBe('0.83 mL');
    expect(formatVolume(0.0125)).toBe('12.5 mL');
    expect(formatVolume(0.5)).toBe('500 mL');
    expect(formatVolume(0.9999)).toBe('1 L');
    expect(formatVolume(2.5)).toBe('2.5 L');
    expect(formatVolume(0.000_000_1)).toBe('< 0.01 mL');
    expect(formatVolume(undefined)).toBe('—');
  });
  it('duration: two largest units, no 60 s carry error', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(0.04)).toBe('< 0.1 s');
    expect(formatDuration(3.64)).toBe('3.6 s');
    expect(formatDuration(36)).toBe('36 s');
    expect(formatDuration(59.6)).toBe('1 min');
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration(183.68)).toBe('3 min 4 s');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3660)).toBe('1 h 1 min');
    expect(formatDuration(36_000)).toBe('10 h');
    expect(formatDuration(400_000)).toBe('4 d 15 h');
    expect(formatDuration(-1)).toBe('—');
  });
  it('summary says estimated equivalent and uses the assumptions', () => {
    const s = summarize(computeImpact(1000, A), A, 'All stored sessions');
    expect(s).toContain('Estimated equivalents, not real travel, fuel or supply');
    expect(s).toContain('1 kWh');
    expect(s).toContain('33.3 km');
    expect(s).toContain('833 mL');
    expect(s).toContain('10 h');
    expect(s).toContain('4 d 15 h');
    expect(summarize(null, A, 'x')).toContain('No generated-energy reading');
  });
});

describe('road progress', () => {
  it('markers are 10 m, 25 m, 50 m, 100 m, 250 m, 500 m, 1 km, 2.5 km', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(milestoneKm).map((v) => Number(v.toPrecision(6)))).toEqual([0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]);
  });
  it('position comes only from the distance', () => {
    expect(roadProgress(0)).toEqual({ fromKm: 0, toKm: 0.01, fraction: 0 });
    expect(roadProgress(null)).toEqual({ fromKm: 0, toKm: 0.01, fraction: 0 });
    expect(roadProgress(Number.NaN).fraction).toBe(0);
    expect(roadProgress(0.005).fraction).toBeCloseTo(0.5, 9);
    const r = roadProgress(0.0153067);
    expect(r.fromKm).toBeCloseTo(0.01, 9);
    expect(r.toKm).toBeCloseTo(0.025, 9);
    expect(r.fraction).toBeCloseTo(0.3538, 3);
    const onMarker = roadProgress(0.01);
    expect(onMarker.fromKm).toBeCloseTo(0.01, 9);
    expect(onMarker.fraction).toBeCloseTo(0, 9);
    const far = roadProgress(33.3);
    expect(far.fromKm).toBeCloseTo(25, 9);
    expect(far.toKm).toBeCloseTo(50, 9);
    expect(far.fraction).toBeCloseTo(0.332, 3);
  });
});

describe('which energy drives the scene', () => {
  const live = { totalEnergyWh: 0.53, sessionEnergyWh: 0.46 };
  const daily = [{ date: '2026-11-16', energyWh: 3 }, { date: '2026-11-17', energyWh: 0.0711 }];
  it('total, session and today (newest stored day, labelled with its own date)', () => {
    expect(pickEnergy('total', live, daily)).toEqual({ basis: 'total', energyWh: 0.53, label: 'All stored sessions' });
    expect(pickEnergy('session', live, daily).energyWh).toBe(0.46);
    expect(pickEnergy('today', live, daily)).toEqual({ basis: 'today', energyWh: 0.0711, label: 'Latest stored day 2026-11-17' });
  });
  it('missing or invalid data stays null', () => {
    expect(pickEnergy('total', null, null).energyWh).toBeNull();
    expect(pickEnergy('today', live, []).energyWh).toBeNull();
    expect(pickEnergy('today', live, null).energyWh).toBeNull();
    expect(pickEnergy('session', { totalEnergyWh: 1, sessionEnergyWh: Number.NaN }, null).energyWh).toBeNull();
    expect(pickEnergy('total', { totalEnergyWh: -2, sessionEnergyWh: 1 }, null).energyWh).toBeNull();
  });
});

describe('honest scene states', () => {
  const live: StateInput = { hasView: true, checked: true, noData: false, freshness: 'live', powerW: 0.47, generating: true, inputPresent: true, measurementValid: true };
  it('only a live, valid, generating device animates', () => {
    expect(sceneState(live)).toMatchObject({ state: 'live', animate: true, title: 'Live' });
  });
  it('zero power, no input, invalid sample: idle, nothing moves', () => {
    expect(sceneState({ ...live, powerW: 0 })).toMatchObject({ state: 'idle', animate: false });
    expect(sceneState({ ...live, generating: false })).toMatchObject({ state: 'idle', animate: false });
    expect(sceneState({ ...live, powerW: null })).toMatchObject({ state: 'idle', animate: false });
    expect(sceneState({ ...live, inputPresent: false }).detail).toContain('No power input');
    expect(sceneState({ ...live, measurementValid: false }).detail).toContain('not a valid measurement');
  });
  it('stale and offline never animate', () => {
    expect(sceneState({ ...live, freshness: 'stale' })).toMatchObject({ state: 'stale', animate: false });
    expect(sceneState({ ...live, freshness: 'offline' })).toMatchObject({ state: 'offline', animate: false });
  });
  it('no data and loading', () => {
    expect(sceneState({ ...live, hasView: false, noData: true })).toMatchObject({ state: 'no-data', animate: false, title: 'No data yet' });
    expect(sceneState({ ...live, hasView: false, checked: false })).toMatchObject({ state: 'loading', title: 'Loading' });
    expect(sceneState({ ...live, hasView: false, checked: true })).toMatchObject({ state: 'loading', title: 'Unavailable' });
  });
});
