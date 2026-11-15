import { describe, expect, it } from 'vitest';
import { formatCo2, formatEnergy, formatPower, formatQuality } from '@/lib/format';

describe('display formatters', () => {
  it('auto-scales energy and power without calculating metrics', () => {
    expect(formatEnergy(.45)).toEqual({ value: '450', unit: 'mWh' });
    expect(formatEnergy(20)).toEqual({ value: '20', unit: 'Wh' });
    expect(formatEnergy(1280)).toEqual({ value: '1.28', unit: 'kWh' });
    expect(formatPower(59)).toEqual({ value: '59', unit: 'W' });
  });
  it('shows missing values as a dash and exposes data quality', () => {
    expect(formatCo2(null)).toEqual({ value: '—', unit: '' });
    expect(formatQuality(3600000, 60000)).toContain('Gaps 0h 1m');
  });
});
