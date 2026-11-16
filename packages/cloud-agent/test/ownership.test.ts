import { afterEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@force/cloud';
import { liveSnapshot } from '../../cloud/test/helpers.js';
import { MemoryDocStore, parseCommit, parseLive, parseProfile, parseRecords } from '../src/index.js';
import { DEVICE, NOW, OTHER, T0, closeAll, commit, records, session, startAgent } from './fixtures.js';

afterEach(closeAll);

const errorOf = async (r: Response) => ((await r.json()) as { error?: string }).error ?? '';

describe('cross-device access (V1, H2)', () => {
  it('records, commits and resets must name a session of the same device', async () => {
    const a = await startAgent();
    const foreign = `${OTHER}-mhz3k2a1`;
    let r = await a.post('records', records({ sessionId: foreign }));
    expect(r.status).toBe(400);
    expect(await errorOf(r)).toMatch(/does not belong to device FORCE-71B6/);
    r = await a.post('commit', commit({ session: session({ id: foreign }) }));
    expect(r.status).toBe(400);
    r = await a.post('reset', { deviceId: DEVICE, sessionId: foreign });
    expect(r.status).toBe(400);
    // a footstep id of another device is refused even inside an own session
    r = await a.post('records', records({ steps: [{ ...records().steps[0]!, id: `${OTHER}_20261116T100005000Z` }] }));
    expect(r.status).toBe(400);
    expect(a.writer.stats.writes).toBe(0);
  });

  it('device ids must be real F.O.R.C.E ids', async () => {
    const a = await startAgent();
    for (const deviceId of ['demo', 'FORCE-xyz1', '../x', 'FORCE-71B6/evil']) {
      expect((await a.post('records', records({ deviceId }))).status).toBe(400);
    }
  });

  it('reset deletes only the documents of its own device', async () => {
    const docs = new MemoryDocStore();
    const a = await startAgent({ docs });
    const sid = `${DEVICE}-mhz3k2a1`;
    expect((await a.post('records', records())).status).toBe(200);
    expect((await a.post('commit', commit())).status).toBe(200);
    // a planted document with the same sessionId but another device (cannot come from the agent)
    docs.col(COLLECTIONS.energyMinutes).set('planted', { sessionId: sid, deviceId: OTHER });
    const r = await a.post('reset', { deviceId: DEVICE, sessionId: sid });
    expect(r.status).toBe(200);
    expect(docs.col(COLLECTIONS.sessions).has(sid)).toBe(false);
    expect([...docs.col(COLLECTIONS.energyMinutes).keys()]).toEqual(['planted']);
    expect(a.logs.some((l) => l.includes('of another device left untouched'))).toBe(true);
  });

  it('a session document of another device in Firestore blocks reset and commit', async () => {
    const docs = new MemoryDocStore();
    const a = await startAgent({ docs });
    const sid = `${DEVICE}-mhz3k2a1`;
    docs.col(COLLECTIONS.sessions).set(sid, { deviceId: OTHER });
    expect((await a.post('reset', { deviceId: DEVICE, sessionId: sid })).status).toBe(400);
    expect((await a.post('commit', commit())).status).toBe(400);
  });
});

describe('protection of complete sessions (V1)', () => {
  it('records for a session already complete in Firestore are refused with 409 until it is reset', async () => {
    const a = await startAgent();
    expect((await a.post('records', records())).status).toBe(200);
    expect((await a.post('commit', commit())).status).toBe(200);
    const before = JSON.stringify([...a.docs.col(COLLECTIONS.energyMinutes).values()].map((d) => ({ ...d, syncedAt: 0 })));
    const fake = records({ minutes: [{ ...records().minutes[0]!, energyNj2: 999_999 }] });
    const r = await a.post('records', fake);
    expect(r.status).toBe(409);
    expect(JSON.stringify([...a.docs.col(COLLECTIONS.energyMinutes).values()].map((d) => ({ ...d, syncedAt: 0 })))).toBe(before);
    expect((await a.post('reset', { deviceId: DEVICE, sessionId: `${DEVICE}-mhz3k2a1` })).status).toBe(200);
    expect((await a.post('records', fake)).status).toBe(200);
  });

  it('records and commit of one session must agree on its time range', async () => {
    const a = await startAgent();
    expect((await a.post('records', records())).status).toBe(200);
    expect((await a.post('records', records({ bounds: { startedAt: T0, endedAt: T0 + 200_000 } }))).status).toBe(400);
    const r = await a.post('commit', commit({ session: session({ endedAt: T0 + 180_000, recordedMs: 170_000 }) }));
    expect(r.status).toBe(400);
    expect(await errorOf(r)).toMatch(/time range differs/);
  });
});

describe('fabricated or implausible records (V2, M3)', () => {
  const bad: Array<[string, () => unknown]> = [
    ['voltage above the INA219 range', () => records({ steps: [{ ...records().steps[0]!, voltageV: 40 }] })],
    ['current outside int16', () => records({ steps: [{ ...records().steps[0]!, currentMa: 40_000 }] })],
    ['power above the tile maximum', () => records({ steps: [{ ...records().steps[0]!, peakW: 500 }] })],
    ['average above peak', () => records({ steps: [{ ...records().steps[0]!, avgW: 3 }] })],
    ['step outside the session', () => records({ steps: [{ ...records().steps[0]!, t: T0 + 999_000 }] })],
    ['step pulse of a minute', () => records({ steps: [{ ...records().steps[0]!, durationMs: 60_000 }] })],
    ['minute outside the session', () => records({ minutes: [{ ...records().minutes[0]!, minute: 1 }] })],
    ['minute energy beyond maximum power', () => records({ minutes: [{ ...records().minutes[0]!, energyNj2: 9e15 }] })],
    ['minute with 1000 steps', () => records({ minutes: [{ ...records().minutes[0]!, steps: 1000 }] })],
    ['minute recorded for 2 minutes', () => records({ minutes: [{ ...records().minutes[0]!, recordedMs: 120_000 }] })],
    ['fractional energy', () => records({ minutes: [{ ...records().minutes[0]!, energyNj2: 1.5 }] })],
    ['time before 2020', () => records({ bounds: { startedAt: 1_000, endedAt: 2_000 } })],
    ['time years in the future', () => records({ bounds: { startedAt: 8.64e15, endedAt: 8.64e15 } })],
    ['a session of two weeks', () => records({ bounds: { startedAt: T0 - 14 * 86_400_000, endedAt: T0 } })],
  ];
  for (const [name, body] of bad) {
    it(`records: ${name}`, () => {
      expect(() => parseRecords(body(), NOW)).toThrow();
    });
  }

  const badCommits: Array<[string, () => unknown]> = [
    ['an open session', () => commit({ session: session({ status: 'open' }) })],
    ['demo data', () => commit({ session: session({ source: 'demo' }) })],
    ['no end time', () => commit({ session: session({ endedAt: null }) })],
    ['end before start', () => commit({ session: session({ endedAt: T0 - 1 }) })],
    ['energy above maximum power', () => commit({ session: session({ energyWh: 50 }) })],
    ['exact energy that disagrees with the session', () => commit({ energyNj2: '99999999999' })],
    ['negative peak', () => commit({ session: session({ peakPowerW: -1 }) })],
    ['10,000 steps in 2 minutes', () => commit({ session: session({ steps: 10_000 }) })],
    ['recorded longer than the session', () => commit({ session: session({ recordedMs: 600_000 }) })],
    ['a firmware string with markup', () => commit({ session: session({ firmwareVersion: '<b>1</b>' }) })],
    ['a daily summary in an unknown zone', () => {
      const c = commit();
      return { ...c, daily: [{ ...c.daily[0]!, timeZone: 'Mars/Olympus' }] };
    }],
    ['a daily date that is not the day start', () => {
      const c = commit();
      return { ...c, daily: [{ ...c.daily[0]!, date: '2026-11-17' }] };
    }],
    ['daily energy that disagrees with its exact value', () => {
      const c = commit();
      return { ...c, daily: [{ ...c.daily[0]!, energyNj2: '1' }] };
    }],
    ['daily CO2 that disagrees with energy and factor', () => {
      const c = commit();
      return { ...c, daily: [{ ...c.daily[0]!, co2AvoidedKg: 5 }] };
    }],
    ['a day that does not overlap the session', () => {
      const c = commit();
      const d = c.daily[0]!;
      const shift = (ms: number) => ms + 2 * 86_400_000;
      return { ...c, daily: [{ ...d, date: '2026-11-18', dayStartMs: shift(d.dayStartMs), dayEndMs: shift(d.dayEndMs), totals: { ...d.totals, fromMs: shift(d.dayStartMs), toMs: shift(d.dayEndMs) } }] };
    }],
    ['no daily summary', () => commit({ daily: [] })],
  ];
  for (const [name, body] of badCommits) {
    it(`commit: ${name}`, () => {
      expect(() => parseCommit(body(), NOW)).toThrow();
    });
  }

  it('the valid fixtures pass', () => {
    expect(parseRecords(records(), NOW).steps).toHaveLength(1);
    expect(parseCommit(commit(), NOW).session.id).toBe(`${DEVICE}-mhz3k2a1`);
  });

  it('live: implausible readings, unknown alert kinds and foreign sessions are refused', () => {
    const snap = liveSnapshot();
    const live = (s: object) => ({ deviceId: DEVICE, snapshot: { ...snap, sessionId: null, ...s } });
    expect(() => parseLive(live({ metrics: { ...snap.metrics, voltageV: 99 } }), NOW)).toThrow();
    expect(() => parseLive(live({ metrics: { ...snap.metrics, powerW: 1e6 } }), NOW)).toThrow();
    expect(() => parseLive(live({ metrics: { ...snap.metrics, sustainabilityScore: 1000 } }), NOW)).toThrow();
    expect(() => parseLive(live({ alerts: [{ id: 'a', kind: 'free text', severity: 'info', since: T0, message: 'x' }] }), NOW)).toThrow();
    expect(() => parseLive(live({ alerts: Array.from({ length: 21 }, () => ({ id: 'a', kind: 'no_data', severity: 'info', since: T0, message: '' })) }), NOW)).toThrow();
    expect(() => parseLive(live({ sessionId: `${OTHER}-abc` }), NOW)).toThrow();
    expect(() => parseLive(live({ t: NOW + 3 * 86_400_000 }), NOW)).toThrow();
    expect(parseLive(live({}), NOW).deviceId).toBe(DEVICE);
  });

  it('a mapping failure is a 400 (parked), never a retried 503', async () => {
    const a = await startAgent();
    const r = await a.post('records', records({ minutes: [{ ...records().minutes[0]!, energyNj2: 2 ** 60 }] }));
    expect(r.status).toBe(400);
  });
});

describe('device data (P1, P2)', () => {
  it('profile is rebuilt from known fields only: injected fields are dropped', () => {
    const p = parseProfile({ ...commit().device!.profile, injected: { big: 'x'.repeat(1000) }, scoreWeights: { carbon: 1, energy: 1, wellness: 1, extra: 5 } }, 'profile');
    expect(JSON.stringify(p)).not.toContain('injected');
    expect(JSON.stringify(p)).not.toContain('extra');
    expect(() => parseProfile({ units: { power: 'kW' } }, 'profile')).toThrow();
  });

  it('device name is always the device id; firmware must look like a version', () => {
    const c = commit();
    const named = parseCommit({ ...c, device: { ...c.device!, info: { ...c.device!.info, name: 'Buy cheap pills' } } }, NOW);
    expect(named.device!.info.name).toBe(DEVICE);
    expect(() => parseCommit({ ...c, device: { ...c.device!, info: { ...c.device!.info, firmwareVersion: 'a b c' } } }, NOW)).toThrow();
    expect(() => parseCommit({ ...c, device: { ...c.device!, info: { ...c.device!.info, sampleRateHz: 5000 } } }, NOW)).toThrow();
  });
});
