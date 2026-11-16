import { describe, expect, it } from 'vitest';
import type { SessionSummary, StepEvent } from '@force/contracts';
import {
  COLLECTIONS,
  bigintToString,
  dataFingerprint,
  docIds,
  fullFingerprint,
  localDay,
  localDaysSpanned,
  parseBigint,
  safeDocId,
  sumNj2,
  toDailySummaryDoc,
  toEnergyMinuteDoc,
  toFootstepDoc,
  toLiveStatusDoc,
  toSessionDoc,
} from '../src/index.js';
import type { CommitPayload, SessionRecord } from '../src/index.js';
import { liveSnapshot } from './helpers.js';

const ts = (ms: number) => ({ ms });

const session: SessionRecord = {
  id: 'FORCE-71B6-lp0abc',
  source: 'device',
  deviceId: 'FORCE-71B6',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_150_000,
  status: 'closed',
  energyWh: 0.0123,
  peakPowerW: 2.5,
  steps: 250,
  recordedMs: 149_950,
  bridgedMs: 0,
  excludedGapMs: 0,
  name: null,
  firmwareVersion: '1.0.0',
};

const step: StepEvent = {
  id: 'FORCE-71B6_20231114T221320000Z',
  t: 1_700_000_000_000,
  stepNumber: 1,
  peakW: 2.1,
  avgW: 1.2,
  durationMs: 120,
  energyJ: 0.144,
  voltageV: 4.8,
  currentMa: 410,
};

describe('document ids', () => {
  it('are stable and derived from the existing keys', () => {
    expect(docIds.footstep(step)).toBe(step.id); // the engine's own idempotency key
    expect(docIds.session(session.id)).toBe(session.id);
    expect(docIds.energyMinute(session.id, 28_333_333)).toBe('FORCE-71B6-lp0abc_28333333');
    expect(docIds.dataGap(session.id, 1_700_000_001_000)).toBe('FORCE-71B6-lp0abc_1700000001000');
    expect(docIds.dailySummary('FORCE-71B6', '2026-11-16')).toBe('FORCE-71B6_2026-11-16');
    expect(docIds.device('FORCE-71B6')).toBe('FORCE-71B6');
  });

  it('refuses ids Firestore would misread or reserve', () => {
    for (const bad of ['', 'a/b', '__x__', '.', '..', 'x'.repeat(201), 'sp ace']) {
      expect(() => safeDocId(bad)).toThrow();
    }
    expect(() => docIds.energyMinute('s', 1.5)).toThrow();
    expect(() => docIds.dailySummary('d', '16/11/2026')).toThrow();
  });
});

describe('exact energy', () => {
  it('sums doubled nanojoules beyond 2^53 without loss and round-trips as a string', () => {
    const big = Number.MAX_SAFE_INTEGER; // 9007199254740991, the largest exact per-minute value
    const total = sumNj2([big, big, 1]);
    expect(total).toBe(18014398509481983n);
    // the same sum in floating point is already wrong
    expect(BigInt(big + big + 1)).not.toBe(total);
    const s = bigintToString(total);
    expect(s).toBe('18014398509481983');
    expect(parseBigint(s)).toBe(total);
  });

  it('refuses non-integer energy and malformed integer strings', () => {
    expect(() => sumNj2([1.5])).toThrow();
    expect(() => parseBigint('1e5')).toThrow();
    expect(() => parseBigint('12.0')).toThrow();
  });

  it('keeps the minute bucket integer exact and adds display values', () => {
    const doc = toEnergyMinuteDoc(
      'FORCE-71B6',
      session.id,
      {
        minute: 28_333_333,
        energyNj2: 123_456_789_012,
        recordedMs: 60_000,
        peakPowerUw: 2_500_000,
        steps: 90,
        samples: 1200,
        gapMs: 0,
      },
      ts,
    );
    expect(doc.energyNj2).toBe(123_456_789_012);
    expect(Number.isSafeInteger(doc.energyNj2)).toBe(true);
    expect(doc.energyJ).toBeCloseTo(61.728394506, 9);
    expect(doc.peakPowerW).toBe(2.5);
    expect(doc.minuteStart).toEqual({ ms: 28_333_333 * 60_000 });
    expect(() =>
      toEnergyMinuteDoc(
        'd',
        's',
        {
          ...{ minute: 1, recordedMs: 0, peakPowerUw: 0, steps: 0, samples: 0, gapMs: 0 },
          energyNj2: 0.5,
        },
        ts,
      ),
    ).toThrow();
  });
});

describe('documents', () => {
  it('session: device data only, timestamps from epoch ms, exact energy string', () => {
    const p: CommitPayload = {
      session,
      energyNj2: '88560000000',
      counts: { steps: 250, minutes: 3, gaps: 0 },
      device: null,
      daily: [],
    };
    const d = toSessionDoc(p, ts);
    expect(d.startedAt).toEqual({ ms: session.startedAt });
    expect(d.durationMs).toBe(150_000);
    expect(d.energyNj2).toBe('88560000000');
    expect(d.source).toBe('device');
    for (const source of ['demo', 'replay'] as const) {
      expect(() => toSessionDoc({ ...p, session: { ...session, source } }, ts)).toThrow(
        /only real device/,
      );
    }
  });

  it('footstep: measured trigger values are separate from calculated ones', () => {
    const d = toFootstepDoc('FORCE-71B6', session.id, step, ts);
    expect(d.measured).toEqual({ voltageV: 4.8, currentMa: 410 });
    expect(d.calculated).toEqual({ peakW: 2.1, avgW: 1.2, energyJ: 0.144, durationMs: 120 });
    expect(d.at).toEqual({ ms: step.t });
  });

  it('daily summary keeps the totals, the zone and the exact energy', () => {
    const d = toDailySummaryDoc(
      {
        deviceId: 'FORCE-71B6',
        date: '2026-11-16',
        timeZone: 'Asia/Kolkata',
        dayStartMs: 1,
        dayEndMs: 2,
        totals: {
          fromMs: 1,
          toMs: 2,
          steps: 9,
          energyWh: 0.5,
          recordedMs: 3,
          peakPowerW: 2,
          sessions: 1,
        },
        energyNj2: '3600000000000',
        co2AvoidedKg: 0.0002375,
        emissionFactorKgPerKwh: 0.475,
        computedAtMs: 5,
      },
      ts,
    );
    expect(d).toMatchObject({
      steps: 9,
      energyWh: 0.5,
      energyNj2: '3600000000000',
      timeZone: 'Asia/Kolkata',
      sessions: 1,
    });
    expect(d.estimated).toEqual({ co2AvoidedKg: 0.0002375, emissionFactorKgPerKwh: 0.475 });
  });

  it('live status hides readings that are not a valid measurement and refuses demo data', () => {
    const snapshot = liveSnapshot();
    const ok = toLiveStatusDoc({ deviceId: 'FORCE-71B6', snapshot }, ts);
    expect(ok.measured).toEqual({ voltageV: 5, currentMa: 300, powerW: 1.5 });
    expect(ok.estimated.co2AvoidedKg).toBe(0.00001);
    const invalid = toLiveStatusDoc(
      {
        deviceId: 'FORCE-71B6',
        snapshot: { ...snapshot, metrics: { ...snapshot.metrics, measurementValid: false } },
      },
      ts,
    );
    expect(invalid.measured).toBeNull();
    expect(() =>
      toLiveStatusDoc({ deviceId: 'x', snapshot: { ...snapshot, source: 'demo' } }, ts),
    ).toThrow();
  });

  it('collection names are fixed', () => {
    expect(Object.values(COLLECTIONS).sort()).toEqual([
      'dailySummaries',
      'dataGaps',
      'deviceConfigs',
      'devices',
      'energyMinutes',
      'footsteps',
      'liveStatus',
      'sessions',
    ]);
  });
});

describe('fingerprints', () => {
  it('a rename changes only the full fingerprint; recomputed data changes both', () => {
    const renamed: SessionSummary = { ...session, name: 'Lobby test' };
    expect(dataFingerprint(renamed)).toBe(dataFingerprint(session));
    expect(fullFingerprint(renamed)).not.toBe(fullFingerprint(session));
    const recomputed = { ...session, steps: 251 };
    expect(dataFingerprint(recomputed)).not.toBe(dataFingerprint(session));
  });
});

describe('local days', () => {
  it('match local midnight and cover every day a session touches', () => {
    const noon = new Date(2026, 10, 16, 12, 0, 0).getTime();
    const d = localDay(noon);
    expect(d.date).toBe('2026-11-16');
    expect(d.startMs).toBe(new Date(2026, 10, 16).getTime());
    expect(d.endMs).toBe(new Date(2026, 10, 17).getTime());
    const span = localDaysSpanned(
      new Date(2026, 10, 16, 23, 50).getTime(),
      new Date(2026, 10, 17, 0, 10).getTime(),
    );
    expect(span.map((x) => x.date)).toEqual(['2026-11-16', '2026-11-17']);
    expect(localDaysSpanned(noon, noon)).toHaveLength(1);
  });
});
