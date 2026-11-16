import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, Pipeline } from '@force/engine';
import type { SessionBackup } from '@force/engine';
import { simulate } from '@force/simulator';
import type { SimConfig } from '@force/simulator';
import type { DeviceProfile, SourceKind, StepEvent } from '@force/contracts';
import { ForceDatabase, LATEST_SCHEMA_VERSION, SCHEMA, Store, openDatabase } from '../src/index.js';

const ANCHOR = 1_700_000_000_000;
let counter = 0;
const mkStore = (opts: ConstructorParameters<typeof Store>[1] = {}) =>
  new Store(new ForceDatabase(`test-${counter++}`), { now: () => ANCHOR + 10_000_000, ...opts });

/** Runs a simulated stream through a pipeline wired to the store, flushing like the worker does. */
async function runLive(
  store: Store,
  cfg: Partial<SimConfig>,
  durationMs: number,
  opts: {
    close?: boolean;
    flushEveryMs?: number;
    source?: SourceKind;
    profile?: DeviceProfile;
    anchor?: number;
  } = {},
) {
  const steps: StepEvent[] = [];
  const profile = opts.profile ?? DEFAULT_PROFILE;
  const anchor = opts.anchor ?? ANCHOR;
  const pipe = new Pipeline(
    {
      source: opts.source ?? 'device',
      deviceId: 'FORCE-STORE',
      profile,
      deviceSensorLimitMa: 3200,
      priorEnergyWh: 0,
      priorSteps: 0,
      checkClockDrift: false,
    },
    store.sink({ onStep: (e) => steps.push(e) }),
  );
  const flushEvery = opts.flushEveryMs ?? 1000;
  let nextFlush = flushEvery;
  let flushes = 0;
  for (const p of simulate(cfg, durationMs)) {
    pipe.pushPacket(p.bytes, anchor + p.arrivalOffsetMs);
    if (p.arrivalOffsetMs >= nextFlush) {
      await store.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
      flushes++;
      nextFlush += flushEvery;
    }
  }
  if (opts.close !== false) pipe.close();
  await store.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
  flushes++;
  const snap = pipe.snapshot({ nowMs: anchor + durationMs, connection: 'streaming' });
  return { pipe, steps, snap, flushes };
}

async function onlySession(store: Store) {
  const list = await store.listSessions();
  expect(list).toHaveLength(1);
  return list[0]!;
}

describe('write path and reads', () => {
  it('stores a live session: summary, one-second chunks, series, steps', async () => {
    const store = mkStore();
    const live = await runLive(store, { cadenceSpm: 90 }, 60_000);
    const s = await onlySession(store);
    expect(s.status).toBe('closed');
    expect(s.source).toBe('device');
    expect(s.energyWh).toBeCloseTo(live.snap.metrics.sessionEnergyWh, 15);
    expect(s.steps).toBe(live.steps.length);
    expect(s.recordedMs).toBe(live.snap.quality.recordedMs);
    expect(s.startedAt).toBe(ANCHOR);

    const chunks = await store.db.chunks.where('sessionId').equals(s.id).toArray();
    expect(chunks.length).toBeGreaterThanOrEqual(60);
    expect(chunks.length).toBeLessThanOrEqual(62); // about one chunk per second
    expect(chunks.reduce((n, c) => n + c.count, 0)).toBe(1201); // every accepted sample, 20 Hz x 60 s

    const series = await store.getSessionSeries(s.id);
    expect(series.times.length).toBe(1201);
    expect(series.times[0]).toBe(ANCHOR);
    expect(series.times[1200]).toBe(ANCHOR + 60_000);
    expect(Math.max(...series.powerW)).toBeGreaterThan(1.5);

    const steps = await store.getSessionSteps(s.id);
    expect(steps.map((e) => e.t)).toEqual(live.steps.map((e) => e.t));
    expect(steps[0]!.id).toMatch(/^FORCE-STORE_/);
  });

  it('writes one transaction per flush', async () => {
    const store = mkStore();
    const live = await runLive(store, {}, 20_000);
    expect(store.transactions).toBe(live.flushes);
    expect(store.transactions).toBeLessThanOrEqual(22);
  });

  it('range reads return only samples inside the range', async () => {
    const store = mkStore();
    await runLive(store, {}, 30_000);
    const s = await onlySession(store);
    const b = await store.getSessionSeries(s.id, [ANCHOR + 10_000, ANCHOR + 12_000]);
    expect(b.times.length).toBe(41);
    expect(b.times[0]).toBe(ANCHOR + 10_000);
    expect(b.times[40]).toBe(ANCHOR + 12_000);
  });

  it('stores gaps with their cause and keeps raw data free of invented samples', async () => {
    const store = mkStore();
    await runLive(store, { faults: [{ kind: 'drop', atMs: 5000, durationMs: 3000 }] }, 20_000);
    const s = await onlySession(store);
    const gaps = await store.getSessionGaps(s.id);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.cause).toBe('lost_packets');
    const raw = await store.readSamples(s.id);
    expect(raw.length).toBe(401 - 60); // 60 samples never arrived and are not stored
  });

  it('keeps a restart as two sessions with the gap on the first', async () => {
    const store = mkStore();
    await runLive(store, { faults: [{ kind: 'restart', atMs: 10_000 }] }, 20_000);
    const list = await store.listSessions();
    expect(list).toHaveLength(2);
    expect(list.every((x) => x.status === 'closed')).toBe(true);
    const first = list.find((x) => x.startedAt === ANCHOR)!;
    const gaps = await store.getSessionGaps(first.id);
    expect(gaps.map((g) => g.cause)).toContain('device_restart');
  });
});

describe('reprocessing a stored session', () => {
  const faults: SimConfig['faults'] = [
    { kind: 'drop', atMs: 8000, durationMs: 100 },
    { kind: 'drop', atMs: 20_000, durationMs: 5000 },
    { kind: 'duplicate', atMs: 12_000 },
    { kind: 'clip', atMs: 30_000, durationMs: 500 },
  ];

  it('gives totals IDENTICAL to live processing (and never edits raw samples)', async () => {
    const store = mkStore();
    const live = await runLive(store, { cadenceSpm: 100, faults }, 60_000);
    const before = await store.listSessions();
    const id = before[0]!.id;
    const rawBefore = (await store.db.chunks.where('sessionId').equals(id).toArray()).map((c) =>
      [...c.data].join(),
    );
    const stepsBefore = await store.getSessionSteps(id);

    const after = await store.recomputeSession(id, DEFAULT_PROFILE);
    expect(after.energyWh).toBe(before[0]!.energyWh);
    expect(after.steps).toBe(before[0]!.steps);
    expect(after.recordedMs).toBe(before[0]!.recordedMs);
    expect(after.bridgedMs).toBe(before[0]!.bridgedMs);
    expect(after.excludedGapMs).toBe(before[0]!.excludedGapMs);
    expect(after.peakPowerW).toBe(before[0]!.peakPowerW);
    expect(await store.getSessionSteps(id)).toEqual(stepsBefore);
    expect(after.steps).toBe(live.steps.length);

    const rawAfter = (await store.db.chunks.where('sessionId').equals(id).toArray()).map((c) =>
      [...c.data].join(),
    );
    expect(rawAfter).toEqual(rawBefore);
  });

  it('applies a corrected threshold to an old session: steps change, energy and raw do not', async () => {
    const store = mkStore();
    await runLive(store, { cadenceSpm: 90 }, 30_000);
    const id = (await store.listSessions())[0]!.id;
    const before = (await store.listSessions())[0]!;
    const strict = await store.recomputeSession(id, { ...DEFAULT_PROFILE, stepThresholdW: 50 });
    expect(strict.steps).toBe(0);
    expect(strict.energyWh).toBe(before.energyWh);
    expect(await store.getSessionSteps(id)).toHaveLength(0);
    const back = await store.recomputeSession(id, DEFAULT_PROFILE);
    expect(back.steps).toBe(before.steps);
  });

  it('refuses sessions that are open or whose raw data was purged', async () => {
    const store = mkStore();
    await runLive(store, {}, 10_000, { close: false });
    const id = (await store.listSessions())[0]!.id;
    await expect(store.recomputeSession(id, DEFAULT_PROFILE)).rejects.toThrow(/still open/);
    await expect(store.recomputeSession('nope', DEFAULT_PROFILE)).rejects.toThrow(
      /No such session/,
    );
  });
});

describe('interrupted-session recovery', () => {
  it('marks a cut-off session interrupted and closes it at its last stored sample', async () => {
    const store = mkStore();
    await runLive(store, {}, 12_000, { close: false });
    const dbName = store.db.name;
    store.db.close();
    // "next start": a fresh Store on the same database
    const again = new Store(new ForceDatabase(dbName));
    const open = await again.db.sessions.where('status').equals('open').toArray();
    expect(open).toHaveLength(1);
    const recovered = await again.recoverInterrupted();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.status).toBe('interrupted');
    const row = (await again.listSessions())[0]!;
    expect(row.status).toBe('interrupted');
    // last flush happened at the last 1 s boundary: at most about a second is lost
    expect(row.endedAt!).toBeGreaterThanOrEqual(ANCHOR + 11_000);
    expect(row.endedAt!).toBeLessThanOrEqual(ANCHOR + 12_000);
    expect(row.energyWh).toBeGreaterThan(0);
  });
});

describe('write failures', () => {
  it('keeps everything and retries: nothing is lost when a transaction fails', async () => {
    const store = mkStore();
    const live = await runLive(store, {}, 5000);
    const total = (await store.readSamples((await store.listSessions())[0]!.id)).length;
    expect(total).toBe(101);

    // second session: first flush fails (storage full), second succeeds
    const failing = mkStore();
    const realPut = failing.db.chunks.bulkPut.bind(failing.db.chunks);
    let failures = 1;
    (failing.db.chunks as unknown as { bulkPut: unknown }).bulkPut = (rows: never) => {
      if (failures-- > 0) return Promise.reject(new Error('QuotaExceededError'));
      return realPut(rows);
    };
    const pipe = new Pipeline(
      {
        source: 'device',
        deviceId: 'F',
        profile: DEFAULT_PROFILE,
        deviceSensorLimitMa: 3200,
        priorEnergyWh: 0,
        priorSteps: 0,
        checkClockDrift: false,
      },
      failing.sink(),
    );
    const pk = simulate({}, 5000);
    for (const p of pk.slice(0, 50)) pipe.pushPacket(p.bytes, ANCHOR + p.arrivalOffsetMs);
    await failing.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
    expect(failing.lastError).toContain('QuotaExceeded');
    for (const p of pk.slice(50)) pipe.pushPacket(p.bytes, ANCHOR + p.arrivalOffsetMs);
    pipe.close();
    await failing.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
    expect(failing.lastError).toBeNull();
    const id = (await failing.listSessions())[0]!.id;
    expect((await failing.readSamples(id)).length).toBe(101);
    expect(live.snap.metrics.sessionEnergyJ).toBeCloseTo(
      (await failing.listSessions())[0]!.energyWh * 3600,
      9,
    );
  });
});

describe('exports and import', () => {
  it('CSV has one row per stored sample with energy and step markers', async () => {
    const store = mkStore();
    const live = await runLive(store, { cadenceSpm: 90 }, 20_000);
    const id = (await store.listSessions())[0]!.id;
    const csv = await (await store.exportCsv(id)).text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'time_utc,device_time_ms,seq,voltage_V,current_mA,power_W,flags,energy_J,step_id',
    );
    expect(lines).toHaveLength(1 + 401);
    const markers = lines.slice(1).filter((l) => l.split(',')[8] !== '');
    expect(markers).toHaveLength(live.steps.length);
    const last = lines[lines.length - 1]!.split(',');
    expect(Number(last[7])).toBeCloseTo(live.snap.metrics.sessionEnergyJ, 6);
    expect(lines[1]!.split(',')[0]).toBe(new Date(ANCHOR).toISOString());
  });

  it('JSON backup round-trips into a fresh database with identical totals', async () => {
    const a = mkStore();
    await runLive(
      a,
      { cadenceSpm: 90, faults: [{ kind: 'drop', atMs: 5000, durationMs: 2000 }] },
      30_000,
    );
    const id = (await a.listSessions())[0]!.id;
    const text = await (await a.exportSessionJson(id)).text();
    const parsed = JSON.parse(text) as SessionBackup;
    expect(parsed.format).toBe('force-session-backup');
    expect(parsed.meta.measurementBoundary).toContain('TBD');
    expect(parsed.meta.shuntAssumption).toContain('0.1 ohm');

    const b = mkStore();
    const imported = await b.importSessionJson(text);
    const orig = (await a.listSessions())[0]!;
    expect(imported.energyWh).toBe(orig.energyWh);
    expect(imported.steps).toBe(orig.steps);
    expect(imported.recordedMs).toBe(orig.recordedMs);
    expect(imported.excludedGapMs).toBe(orig.excludedGapMs);
    expect(await b.getSessionSteps(imported.id)).toEqual(await a.getSessionSteps(id));
    expect(await b.getSessionGaps(imported.id)).toEqual(await a.getSessionGaps(id));

    // importing the same session again is refused: it would double-count the daily totals
    await expect(b.importSessionJson(text)).rejects.toThrow(/already stored/);
    expect(await b.listSessions()).toHaveLength(1);

    // a DIFFERENT session that happens to share the id never overwrites: it gets a suffix
    const other = {
      ...parsed,
      session: { ...parsed.session, startedAt: parsed.session.startedAt + 1 },
    };
    const second = await b.importSessionJson(JSON.stringify(other));
    expect(second.id).toBe(`${id}-import2`);
    expect(await b.listSessions()).toHaveLength(2);
    // and a re-import of that one is caught under its suffixed id too
    await expect(b.importSessionJson(JSON.stringify(other))).rejects.toThrow(/already stored/);

    // after deleting the stored copy, the backup restores again
    await b.deleteSession(imported.id);
    const restored = await b.importSessionJson(text);
    expect(restored.id).toBe(id);
    expect(restored.energyWh).toBe(orig.energyWh);
  });

  it('rejects malformed, oversized-shape and wrong-format imports', async () => {
    const store = mkStore();
    await expect(store.importSessionJson('not json')).rejects.toThrow(/valid JSON/);
    await expect(store.importSessionJson('{"format":"other"}')).rejects.toThrow(/session backup/);
    const a = mkStore();
    await runLive(a, {}, 3000);
    const id = (await a.listSessions())[0]!.id;
    const good = JSON.parse(await (await a.exportSessionJson(id)).text()) as SessionBackup;
    const bad1 = { ...good, chunks: [{ ...good.chunks[0]!, count: 5000 }] };
    await expect(store.importSessionJson(JSON.stringify(bad1))).rejects.toThrow(/sample count/);
    const bad2 = { ...good, chunks: [{ ...good.chunks[0]!, data: 'AAAA' }] };
    await expect(store.importSessionJson(JSON.stringify(bad2))).rejects.toThrow(/longer|length/);
    const bad3 = { ...good, profile: { ...good.profile, stepThresholdW: -1 } };
    await expect(store.importSessionJson(JSON.stringify(bad3))).rejects.toThrow(
      /profile is invalid/,
    );
    const bad4 = { ...good, version: 99 };
    await expect(store.importSessionJson(JSON.stringify(bad4))).rejects.toThrow(/version/);
    expect(await store.listSessions()).toHaveLength(0);
  });
});

describe('totals and the daily report (DCR)', () => {
  it('getTotals sums real-device sessions in a range and excludes demo', async () => {
    const store = mkStore();
    const live = await runLive(store, { cadenceSpm: 90 }, 30_000);
    await runLive(store, { cadenceSpm: 90 }, 30_000, {
      source: 'demo',
      anchor: ANCHOR + 3_600_000,
    });
    const day = await store.getTotals(ANCHOR - 1000, ANCHOR + 86_400_000);
    expect(day.sessions).toBe(1);
    expect(day.steps).toBe(live.steps.length);
    expect(day.energyWh).toBeCloseTo(live.snap.metrics.sessionEnergyWh, 12);
    const none = await store.getTotals(ANCHOR + 7_200_000, ANCHOR + 9_000_000);
    expect(none.steps).toBe(0);
    expect(none.energyWh).toBe(0);
  });

  it('getTotalsExact matches getTotals, filters by device and keeps the exact energy', async () => {
    const store = mkStore();
    await runLive(store, { cadenceSpm: 90 }, 30_000);
    const all = await store.getTotals(ANCHOR - 1000, ANCHOR + 86_400_000);
    const exact = await store.getTotalsExact(ANCHOR - 1000, ANCHOR + 86_400_000);
    expect(exact.totals).toEqual(all);
    const mine = await store.getTotalsExact(ANCHOR - 1000, ANCHOR + 86_400_000, 'FORCE-STORE');
    expect(mine.totals).toEqual(all);
    const other = await store.getTotalsExact(ANCHOR - 1000, ANCHOR + 86_400_000, 'FORCE-0000');
    expect(other.totals.sessions).toBe(0);
    expect(other.energyNj2).toBe(0n);
    const [s] = await store.listSessions();
    const minutes = await store.getSessionMinutes(s!.id);
    expect(minutes.map((m) => m.minute)).toEqual(
      [...minutes.map((m) => m.minute)].sort((a, b) => a - b),
    );
    expect(exact.energyNj2).toBe(minutes.reduce((a, m) => a + BigInt(m.energyNj2), 0n));
    expect(Number(exact.energyNj2) / 2e9 / 3600).toBeCloseTo(all.energyWh, 15);
  });

  it('exportStepsCsv has the DCR columns, one row per step in range, all sessions', async () => {
    const store = mkStore();
    const live = await runLive(store, { cadenceSpm: 60 }, 20_000);
    const csv = await (await store.exportStepsCsv(ANCHOR, ANCHOR + 86_400_000)).text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'timestamp_utc,event_id,session_id,source,device_id,step_number,voltage_V,current_A,power_W,energy_interval_J,power_peak_W,power_avg_W,duration_ms',
    );
    expect(lines).toHaveLength(1 + live.steps.length);
    const row = lines[1]!.split(',');
    expect(row[1]).toBe(live.steps[0]!.id);
    expect(row[3]).toBe('device');
    expect(row[5]).toBe('1');
    const half = await (await store.exportStepsCsv(ANCHOR, ANCHOR + 10_000)).text();
    expect(half.trim().split('\n').length - 1).toBeLessThan(live.steps.length);
  });

  it('priorTotals counts finished real-device sessions only', async () => {
    const store = mkStore();
    const a = await runLive(store, { cadenceSpm: 90 }, 20_000);
    await runLive(store, { cadenceSpm: 90 }, 20_000, {
      source: 'demo',
      anchor: ANCHOR + 1_000_000,
    });
    await runLive(store, { cadenceSpm: 90 }, 5000, { close: false, anchor: ANCHOR + 2_000_000 });
    const p = await store.priorTotals();
    expect(p.steps).toBe(a.steps.length);
    expect(p.energyWh).toBeCloseTo(a.snap.metrics.sessionEnergyWh, 12);
  });
});

describe('long ranges, retention, quota', () => {
  it('ranges beyond an hour are served from minute buckets', async () => {
    const store = mkStore();
    await runLive(store, { sampleRateHz: 20 }, 70 * 60_000, { flushEveryMs: 30_000 });
    const id = (await store.listSessions())[0]!.id;
    const long = await store.getSessionSeries(id);
    expect(long.times.length).toBeGreaterThanOrEqual(70);
    expect(long.times.length).toBeLessThanOrEqual(72);
    expect(Number.isNaN(long.voltageV[0])).toBe(true); // not kept per minute
    expect(long.powerW.every((w) => w >= 0)).toBe(true);
    const short = await store.getSessionSeries(id, [ANCHOR, ANCHOR + 60_000]);
    expect(short.times.length).toBe(1201);
    expect(Number.isNaN(short.voltageV[0])).toBe(false);
  }, 120_000);

  it('retention removes raw chunks but keeps totals, steps and buckets', async () => {
    const store = mkStore();
    await runLive(store, { cadenceSpm: 90 }, 30_000);
    const before = (await store.listSessions())[0]!;
    const res = await store.applyRetention(30, ANCHOR + 31 * 86_400_000);
    expect(res.sessionsPurged).toBe(1);
    expect(await store.db.chunks.count()).toBe(0);
    const after = (await store.listSessions())[0]!;
    expect(after.energyWh).toBe(before.energyWh);
    expect(after.steps).toBe(before.steps);
    expect((await store.getSessionSteps(after.id)).length).toBe(before.steps);
    expect((await store.getSessionSeries(after.id)).times.length).toBeGreaterThan(0); // from buckets
    await expect(store.recomputeSession(after.id, DEFAULT_PROFILE)).rejects.toThrow(/retention/);
    await expect(store.exportCsv(after.id)).rejects.toThrow(/retention/);
    // a second run purges nothing more
    expect((await store.applyRetention(30, ANCHOR + 40 * 86_400_000)).sessionsPurged).toBe(0);
  });

  it('retention leaves recent sessions alone', async () => {
    const store = mkStore();
    await runLive(store, {}, 10_000);
    expect((await store.applyRetention(30, ANCHOR + 5 * 86_400_000)).sessionsPurged).toBe(0);
    expect(await store.db.chunks.count()).toBeGreaterThan(0);
  });

  it('quota warning at 80%', async () => {
    const warn = mkStore({ estimate: async () => ({ usage: 85, quota: 100 }) });
    const q = await warn.checkQuota();
    expect(q.warn).toBe(true);
    expect(q.ratio).toBe(0.85);
    const fine = mkStore({ estimate: async () => ({ usage: 50, quota: 100 }) });
    expect((await fine.checkQuota()).warn).toBe(false);
    const unknown = mkStore({ estimate: async () => ({}) });
    expect((await unknown.checkQuota()).warn).toBe(false);
  });
});

describe('profile, sessions management', () => {
  it('returns the default profile until one is saved, then the saved one', async () => {
    const store = mkStore();
    expect(await store.getProfile()).toEqual(DEFAULT_PROFILE);
    await store.saveProfile({ ...DEFAULT_PROFILE, stepThresholdW: 3 });
    expect((await store.getProfile()).stepThresholdW).toBe(3);
  });

  it('renames, deletes one session, and deletes everything', async () => {
    const store = mkStore();
    await runLive(store, {}, 5000);
    await runLive(store, {}, 5000, { anchor: ANCHOR + 100_000 });
    const [a, b] = await store.listSessions();
    await store.renameSession(a!.id, '  10 people, 5 minutes ');
    expect((await store.listSessions()).find((s) => s.id === a!.id)!.name).toBe(
      '10 people, 5 minutes',
    );
    await store.renameSession(a!.id, '   ');
    expect((await store.listSessions()).find((s) => s.id === a!.id)!.name).toBeNull();
    await store.deleteSession(b!.id);
    expect(await store.listSessions()).toHaveLength(1);
    expect(await store.db.chunks.where('sessionId').equals(b!.id).count()).toBe(0);
    await store.deleteAllData();
    expect(await store.listSessions()).toHaveLength(0);
    expect(await store.db.chunks.count()).toBe(0);
    expect(await store.db.minutes.count()).toBe(0);
  });

  it('logs connection events', async () => {
    const store = mkStore();
    store.logEvent({ time: 1, deviceId: 'F', type: 'connected', detail: 'x' });
    store.logEvent({ time: 2, deviceId: 'F', type: 'dropped', detail: 'y' });
    await store.flush();
    expect((await store.listEvents()).map((e) => e.type)).toEqual(['dropped', 'connected']);
  });
});

describe('additive migrations and rollback tolerance', () => {
  it('data written at schema v1 survives the upgrade to the latest version', async () => {
    const name = `mig-${counter++}`;
    const v1 = new ForceDatabase(name, 1);
    await v1.open();
    await v1.sessions.put({
      id: 's1',
      source: 'device',
      deviceId: 'F',
      startedAt: 5,
      endedAt: 6,
      status: 'closed',
      energyWh: 1,
      peakPowerW: 2,
      steps: 3,
      recordedMs: 4,
      bridgedMs: 0,
      excludedGapMs: 0,
      name: null,
      profileId: 'default',
      rawPurgedAt: null,
      firmwareVersion: null,
    });
    v1.close();
    const latest = new ForceDatabase(name);
    await latest.open();
    expect((await latest.sessions.get('s1'))!.steps).toBe(3);
    expect(latest.tables.map((t) => t.name)).toContain('meta');
    expect(SCHEMA.length).toBe(LATEST_SCHEMA_VERSION);
  });

  it('every schema version only adds stores or indexes (never drops)', () => {
    const seen = new Set<string>();
    for (const v of SCHEMA) {
      for (const k of Object.keys(v.stores)) seen.add(k);
    }
    // a later version never lists a store as null/deleted
    for (const v of SCHEMA) expect(Object.values(v.stores).every((s) => s !== null)).toBe(true);
    expect(seen.has('chunks') && seen.has('sessions') && seen.has('steps')).toBe(true);
  });

  it('opens a database that a NEWER app version already upgraded', async () => {
    const name = `newer-${counter++}`;
    const newer = new Dexie(name);
    newer.version(1).stores(SCHEMA[0]!.stores);
    newer.version(2).stores(SCHEMA[1]!.stores);
    newer.version(3).stores({ somethingFromTheFuture: 'id' });
    await newer.open();
    await newer
      .table('sessions')
      .put({ id: 'keep', startedAt: 1, status: 'closed', source: 'device' });
    newer.close();
    // opening at our lower version works because migrations are additive
    const { db, newerThanApp } = await openDatabase(name);
    expect(newerThanApp).toBe(true);
    expect((await db.sessions.get('keep'))!.id).toBe('keep');
    db.close();
  });

  it('opens a fresh database normally', async () => {
    const { db, newerThanApp } = await openDatabase(`fresh-${counter++}`);
    expect(newerThanApp).toBe(false);
    expect(await db.sessions.count()).toBe(0);
    db.close();
  });
});
