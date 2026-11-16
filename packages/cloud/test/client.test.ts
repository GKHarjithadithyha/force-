import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  BACKOFF_MAX_MS,
  DexieSyncStateStore,
  MemorySyncStateStore,
  StoreLocalSource,
  SyncClient,
  backoffMs,
  fetchTransport,
} from '../src/index.js';
import type {
  AgentPolicy,
  CommitPayload,
  RecordsPayload,
  SyncPath,
  Transport,
  TransportResult,
} from '../src/index.js';
import { ANCHOR, liveSnapshot, mkStore, record } from './helpers.js';

const DOWN: TransportResult = { ok: false, status: 0, error: 'Sync agent unreachable', retryable: true };

/**
 * Fake agent. `policy` is what it answers; `script` may override any call's result.
 * Every call is recorded (policy calls included).
 */
function fakeTransport(
  script: (path: SyncPath, n: number) => TransportResult | null = () => null,
  policy: AgentPolicy = { footsteps: true, liveIntervalMs: 30_000 },
) {
  const calls: Array<{ path: SyncPath; body: unknown }> = [];
  const t: Transport = async (path, body) => {
    calls.push({ path, body: structuredClone(body) });
    return (
      script(path, calls.length) ?? {
        ok: true,
        status: 200,
        error: null,
        retryable: false,
        data: { ok: true, policy },
      }
    );
  };
  return { t, calls, policy };
}
const work = (calls: Array<{ path: SyncPath }>) => calls.filter((c) => c.path !== 'policy');

function sourceFor(store: ReturnType<typeof mkStore>) {
  return new StoreLocalSource(store, { databaseName: store.db.name });
}

async function setup() {
  const store = mkStore();
  await record(store, { durationMs: 150_000 });
  return store;
}

const recordsOf = (calls: Array<{ path: SyncPath; body: unknown }>) =>
  calls.filter((c) => c.path === 'records').map((c) => c.body as RecordsPayload);

describe('SyncClient', () => {
  it('uploads a finished device session: records in chunks, then one commit with exact totals', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport();
    const c = new SyncClient({
      source: sourceFor(store),
      state: new MemorySyncStateStore(),
      transport: t,
      chunkSize: 50,
      now: () => ANCHOR + 10_000_000,
    });
    await c.syncNow();

    expect(calls[0]!.path).toBe('policy');
    const [s] = await store.listSessions();
    const steps = await store.getSessionSteps(s!.id);
    const minutes = await store.getSessionMinutes(s!.id);
    expect(steps.length).toBeGreaterThan(100);
    const sent = recordsOf(calls);
    expect(sent.flatMap((r) => r.steps).map((x) => x.id)).toEqual(steps.map((x) => x.id));
    expect(sent.flatMap((r) => r.minutes).map((x) => x.minute)).toEqual(minutes.map((m) => m.minute));
    expect(sent.every((r) => r.bounds.startedAt === s!.startedAt && r.bounds.endedAt === s!.endedAt)).toBe(true);
    expect(Math.max(...sent.map((r) => r.steps.length + r.minutes.length + r.gaps.length))).toBeLessThanOrEqual(50);

    const commits = calls.filter((x) => x.path === 'commit');
    expect(commits).toHaveLength(1);
    expect(calls.at(-1)!.path).toBe('commit'); // the session document goes last
    const commit = commits[0]!.body as CommitPayload;
    const exact = minutes.reduce((a, m) => a + BigInt(m.energyNj2), 0n);
    expect(commit.energyNj2).toBe(exact.toString());
    expect(commit.counts).toEqual({ steps: steps.length, minutes: minutes.length, gaps: 0 });
    const day = commit.daily[0]!;
    expect(day.totals).toEqual(await store.getTotals(day.dayStartMs, day.dayEndMs));
    expect(c.status()).toMatchObject({ state: 'idle', syncedSessions: 1, pendingSessions: 0 });
  });

  it('footsteps off (the default policy): no footstep is sent, minute step counts are', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport(() => null, { footsteps: false, liveIntervalMs: 30_000 });
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    const sent = recordsOf(calls);
    expect(sent.flatMap((r) => r.steps)).toHaveLength(0);
    const minuteSteps = sent.flatMap((r) => r.minutes).reduce((a, m) => a + m.steps, 0);
    const [s] = await store.listSessions();
    expect(minuteSteps).toBe(s!.steps); // per-minute counts carry every step
    expect((calls.at(-1)!.body as CommitPayload).counts.steps).toBe(s!.steps);
    expect(c.status().policy).toEqual({ footsteps: false, liveIntervalMs: 30_000 });
    // all footsteps remain in the local database
    expect((await store.getSessionSteps(s!.id)).length).toBe(s!.steps);
  });

  it('turning footsteps on later uploads the footsteps of sessions synced without them', async () => {
    const store = await setup();
    const state = new MemorySyncStateStore();
    const off = fakeTransport(() => null, { footsteps: false, liveIntervalMs: 30_000 });
    await new SyncClient({ source: sourceFor(store), state, transport: off.t }).syncNow();
    const on = fakeTransport(() => null, { footsteps: true, liveIntervalMs: 30_000 });
    const c = new SyncClient({ source: sourceFor(store), state, transport: on.t });
    await c.syncNow();
    const sent = recordsOf(on.calls);
    const [s] = await store.listSessions();
    expect(sent.flatMap((r) => r.steps)).toHaveLength(s!.steps);
    expect(sent.flatMap((r) => r.minutes)).toHaveLength(0); // minutes were already uploaded
    expect(on.calls.at(-1)!.path).toBe('commit');
    const before = on.calls.length;
    await c.syncNow();
    expect(work(on.calls.slice(before))).toHaveLength(0);
  });

  it('is idempotent: a second pass sends nothing but the policy check', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport();
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    const n = work(calls).length;
    await c.syncNow();
    await c.syncNow();
    expect(work(calls).length).toBe(n);
  });

  it('never sends demo or replay sessions, nor a session that is still open', async () => {
    const store = mkStore();
    await record(store, { source: 'demo', deviceId: 'demo' });
    await record(store, { source: 'replay', anchor: ANCHOR + 1_000_000 });
    await record(store, { anchor: ANCHOR + 2_000_000, close: false });
    const { t, calls } = fakeTransport();
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    expect(work(calls)).toHaveLength(0);
    await store.recoverInterrupted();
    await c.syncNow();
    const commits = calls.filter((x) => x.path === 'commit').map((x) => (x.body as CommitPayload).session);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.status).toBe('interrupted');
    expect(commits[0]!.source).toBe('device');
  });

  it('backs off on a network failure, keeps local data untouched, and resumes from the confirmed chunk', async () => {
    const store = await setup();
    let now = ANCHOR;
    // calls: 1 policy, 2-3 records ok, 4 records fails
    const { t, calls } = fakeTransport((path, n) => (path === 'records' && n === 4 ? DOWN : null));
    const state = new MemorySyncStateStore();
    const c = new SyncClient({ source: sourceFor(store), state, transport: t, chunkSize: 40, now: () => now, random: () => 0.5 });
    const before = await store.listSessions();

    await c.syncNow();
    expect(calls).toHaveLength(4);
    expect(c.status().state).toBe('offline');
    expect(c.status().nextRetryAt).toBe(ANCHOR + 2_000);
    expect([...state.rows.values()][0]!.cursor.steps).toBe(80);
    expect(await store.listSessions()).toEqual(before);

    await c.syncNow(); // inside the back-off window: nothing at all is sent
    expect(calls).toHaveLength(4);

    now += 2_000;
    await c.syncNow();
    expect(recordsOf(calls)[2]!.steps[0]!.stepNumber).toBe(81);
    expect(c.status()).toMatchObject({ state: 'idle', syncedSessions: 1, lastError: null });

    expect(backoffMs(1, () => 0.5)).toBe(2_000);
    expect(backoffMs(4, () => 0.5)).toBe(16_000);
    expect(backoffMs(30, () => 0.5)).toBe(BACKOFF_MAX_MS);
  });

  it('recovers after a restart: a new client with the saved state finishes the upload', async () => {
    const store = await setup();
    const name = `sync-state-${Math.random()}`;
    const state1 = new DexieSyncStateStore(name);
    const a = fakeTransport((path) => (path === 'commit' ? DOWN : null));
    await new SyncClient({ source: sourceFor(store), state: state1, transport: a.t }).syncNow();
    expect(a.calls.at(-1)!.path).toBe('commit');
    state1.close();

    const state2 = new DexieSyncStateStore(name);
    const b = fakeTransport();
    const c = new SyncClient({ source: sourceFor(store), state: state2, transport: b.t });
    await c.syncNow();
    expect(work(b.calls).map((x) => x.path)).toEqual(['commit']);
    expect(c.status().syncedSessions).toBe(1);
    state2.close();
  });

  it('agent says the session already exists (409): the client resets it and uploads it again', async () => {
    const store = await setup();
    let conflicted = false;
    const { t, calls } = fakeTransport((path) => {
      if (path === 'records' && !conflicted) {
        conflicted = true;
        return { ok: false, status: 409, error: 'already complete', retryable: false };
      }
      return null;
    });
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    const paths = work(calls).map((x) => x.path);
    expect(paths[0]).toBe('records');
    expect(paths[1]).toBe('reset');
    expect(paths.at(-1)).toBe('commit');
    expect(c.status()).toMatchObject({ syncedSessions: 1, parkedSessions: 0 });
  });

  it('replaces the uploaded records when the local session is recomputed, and only rewrites the session on a rename', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport();
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    const [s] = await store.listSessions();

    calls.length = 0;
    await store.renameSession(s!.id, 'Lobby tile');
    await c.syncNow();
    expect(work(calls).map((x) => x.path)).toEqual(['commit']);
    expect((work(calls)[0]!.body as CommitPayload).session.name).toBe('Lobby tile');

    calls.length = 0;
    const profile = await store.getProfile();
    await store.recomputeSession(s!.id, { ...profile, stepThresholdW: 1000 });
    await c.syncNow();
    expect(work(calls)[0]!.path).toBe('reset');
    expect(calls.at(-1)!.path).toBe('commit');
  });

  it('parks a session the agent refuses as invalid instead of retrying it in a loop', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport((path) =>
      path === 'commit' ? { ok: false, status: 400, error: 'session.steps: bad', retryable: false } : null,
    );
    let now = ANCHOR;
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t, now: () => now });
    await c.syncNow();
    const n = work(calls).length;
    await c.syncNow();
    expect(work(calls).length).toBe(n);
    expect(c.status()).toMatchObject({ state: 'error', parkedSessions: 1 });
    now += 3_600_001;
    await c.syncNow();
    expect(work(calls).length).toBeGreaterThan(n);
  });

  it('unpaired (no or wrong token): stops at the policy check and says so', async () => {
    const store = await setup();
    const { t, calls } = fakeTransport((path) =>
      path === 'policy' ? { ok: false, status: 401, error: 'Not paired: missing or wrong sync token', retryable: false } : null,
    );
    const c = new SyncClient({ source: sourceFor(store), state: new MemorySyncStateStore(), transport: t });
    await c.syncNow();
    expect(calls.map((x) => x.path)).toEqual(['policy']);
    expect(c.status()).toMatchObject({ state: 'unpaired' });
    // without a token the real transport does not even send the request
    let fetched = 0;
    const tr = fetchTransport('http://127.0.0.1:1/api/sync/v1', {
      getToken: () => null,
      fetchFn: (async () => {
        fetched++;
        return new Response('{}');
      }) as typeof fetch,
    });
    expect((await tr('policy', {})).status).toBe(401);
    expect(fetched).toBe(0);
  });

  it('sends the token as a bearer header and never cookies', async () => {
    let seen: RequestInit | undefined;
    const tr = fetchTransport('/api/sync/v1/', {
      getToken: () => 'x'.repeat(43),
      fetchFn: (async (_url: string, init: RequestInit) => {
        seen = init;
        return new Response(JSON.stringify({ ok: true, policy: { footsteps: false, liveIntervalMs: 30_000 } }));
      }) as unknown as typeof fetch,
    });
    const r = await tr('policy', {});
    expect(r.ok).toBe(true);
    expect((seen!.headers as Record<string, string>).Authorization).toBe(`Bearer ${'x'.repeat(43)}`);
    expect(seen!.credentials).toBe('omit');
  });

  it('live status: 30 s by default, device snapshots only, immediate update on a connection change', async () => {
    let now = ANCHOR;
    const { t, calls } = fakeTransport();
    const c = new SyncClient({ source: sourceFor(mkStore()), state: new MemorySyncStateStore(), transport: t, now: () => now });
    c.start();
    const info = { deviceId: 'FORCE-71B6', name: 'FORCE-71B6', firmwareVersion: '1.0.0', sampleRateHz: 20, sensorLimitMa: 3200 };
    const snap = liveSnapshot();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const live = () => calls.filter((x) => x.path === 'live');

    c.reportLive(snap, info);
    await flush();
    for (let i = 0; i < 116; i++) {
      now += 250; // 29 s of 4 Hz snapshots
      c.reportLive(snap, info);
      await flush();
    }
    expect(live()).toHaveLength(1);
    now += 1_000;
    c.reportLive(snap, info);
    await flush();
    expect(live()).toHaveLength(2); // 30 s after the first
    c.reportLive({ ...snap, connection: 'stale' }, info);
    await flush();
    expect(live()).toHaveLength(3);
    c.reportLive({ ...snap, source: 'demo', connection: 'idle' }, info);
    c.reportLive(snap, null);
    await flush();
    expect(live()).toHaveLength(3);
    await c.stop();
  });

  it('a broken local database or agent never throws out of the client', async () => {
    const broken = {
      completedDeviceSessions: async () => {
        throw new Error('IndexedDB closed');
      },
    } as unknown as StoreLocalSource;
    const c = new SyncClient({ source: broken, state: new MemorySyncStateStore(), transport: fakeTransport().t });
    await expect(c.syncNow()).resolves.toBeUndefined();
    expect(c.status().state).toBe('offline');
    expect(c.status().lastError).toMatch(/IndexedDB closed/);
  });

  it('refuses to read the mock database', () => {
    const store = mkStore();
    Object.defineProperty(store.db, 'name', { value: 'force-mock' });
    expect(() => new StoreLocalSource(store, { databaseName: 'force-mock' })).toThrow();
    expect(() => new StoreLocalSource(mkStore())).toThrow(/only the "force" database/);
  });
});
