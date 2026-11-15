import { describe, expect, it } from 'vitest';
import type { DashboardEngine, LiveSnapshot, RangeTotals } from '@/contracts';
import { getHistory, hasHistory, historyBuckets } from '@/lib/analytics';
import { inputStatus, readingsUsable, sensorStatus, sourceBanner, tileState } from '@/lib/live';

function snap(over: Partial<LiveSnapshot['metrics']> = {}, extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    t: 1, lastPacketAt: 1, source: 'device', connection: 'streaming', sessionId: 's1',
    metrics: { measurementValid: true, inputPresent: true, voltageV: 12, currentMa: 100, powerW: 1.2, generating: true, sessionEnergyJ: 0, sessionEnergyWh: 0, totalEnergyWh: 0, avgPowerW: 0, peakPowerW: 0, steps: 0, cadenceSpm: null, energyPerStepJ: null, stepsPerHour: {}, co2AvoidedKg: 0, ledHours: 0, phoneCharges: 0, kcal: null, sustainabilityScore: null, rssiDbm: null, sampleRateHz: 20, sensorLimitReached: false, ...over },
    quality: { recordedMs: 0, bridgedMs: 0, excludedGapMs: 0, lostPackets: 0, droppedPackets: 0, detail: { malformedPackets: 0, duplicatePackets: 0, latePackets: 0, clippedSamples: 0, negativePowerSamples: 0, powerMismatchSamples: 0, stepsUnreliable: false } },
    alerts: [], ...extra,
  };
}

describe('live display rules (UI never invents or misrepresents readings)', () => {
  it('shows readings only when streaming a valid measurement with input present', () => {
    expect(readingsUsable(snap(), 'streaming')).toBe(true);
    expect(readingsUsable(snap({ inputPresent: false }), 'streaming')).toBe(false);
    expect(readingsUsable(snap({ measurementValid: false, inputPresent: false }), 'streaming')).toBe(false);
    expect(readingsUsable(snap(), 'stale')).toBe(false);
    expect(readingsUsable(null, 'streaming')).toBe(false);
    expect(readingsUsable(snap({}, { lastPacketAt: null }), 'streaming')).toBe(false);
  });
  it('separates sensor status from power-input status', () => {
    const noInput = snap({ inputPresent: false, voltageV: 0.02 });
    expect(sensorStatus(noInput).value).toBe('Normal');
    expect(inputStatus(noInput).value).toBe('No input');
    expect(tileState(noInput, 'streaming')).toBe('No input');
    const fault = snap({ measurementValid: false, inputPresent: false });
    expect(sensorStatus(fault).value).toBe('Fault');
    expect(inputStatus(fault).value).toBe('—');
    expect(sensorStatus(snap({ sensorLimitReached: true })).value).toBe('At limit');
    expect(inputStatus(snap({}, { alerts: [{ id: 'o', kind: 'over_voltage', severity: 'error', since: 1, message: 'x' }] })).value).toBe('Over voltage');
    expect(tileState(null, 'idle')).toBe('Not connected');
    expect(tileState(snap(), 'stale')).toBe('No data');
  });
  it('labels demo and replay data and never labels device data', () => {
    expect(sourceBanner(snap({}, { source: 'demo' }))).toMatch(/Demo data/);
    expect(sourceBanner(snap({}, { source: 'replay' }))).toMatch(/Replay data/);
    expect(sourceBanner(snap())).toBeNull();
  });
});

describe('overview analytics from stored totals', () => {
  it('builds hourly buckets for today and daily buckets for week and month', () => {
    const now = new Date(2026, 10, 15, 14, 30).getTime();
    const today = historyBuckets('today', now);
    expect(today).toHaveLength(15);
    expect(new Date(today[0][0]).getHours()).toBe(0);
    expect(historyBuckets('week', now)).toHaveLength(7);
    expect(historyBuckets('month', now)).toHaveLength(30);
  });
  it('maps engine totals to history points and detects an empty range', async () => {
    const engine = { getTotals: async (fromMs: number, toMs: number): Promise<RangeTotals> => ({ fromMs, toMs, steps: 2, energyWh: 0.5, recordedMs: 1000, peakPowerW: 1, sessions: 1 }) } as unknown as DashboardEngine;
    const h = await getHistory(engine, 'week', new Date(2026, 10, 15, 12).getTime());
    expect(h).toHaveLength(7);
    expect(h[0]).toMatchObject({ steps: 2, energyWh: 0.5 });
    expect(hasHistory(h)).toBe(true);
    expect(hasHistory(h.map((p) => ({ ...p, steps: 0, energyWh: 0, recordedMs: 0 })))).toBe(false);
  });
});
