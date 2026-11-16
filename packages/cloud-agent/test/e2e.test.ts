import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  MemorySyncStateStore,
  StoreLocalSource,
  SyncClient,
  fetchTransport,
} from '@force/cloud';
import { ANCHOR, mkStore, record } from '../../cloud/test/helpers.js';
import { MemoryDocStore } from '../src/index.js';
import { TOKEN, closeAll, startAgent } from './fixtures.js';

afterEach(closeAll);

const source = (store: ReturnType<typeof mkStore>) =>
  new StoreLocalSource(store, { databaseName: store.db.name });
const client = (store: ReturnType<typeof mkStore>, base: string, token: string | null = TOKEN, extra = {}) =>
  new SyncClient({
    source: source(store),
    state: new MemorySyncStateStore(),
    transport: fetchTransport(base, { getToken: () => token }),
    ...extra,
  });

async function recorded() {
  const store = mkStore();
  await store.saveDevice({ deviceId: 'FORCE-71B6', name: 'FORCE-71B6', firmwareVersion: '1.0.0', sampleRateHz: 20, sensorLimitMa: 3200 });
  await record(store, { durationMs: 150_000 });
  await record(store, { source: 'demo', deviceId: 'demo', anchor: ANCHOR + 500_000 });
  return store;
}

describe('end to end: local database -> sync client -> HTTP agent -> Firestore documents', () => {
  it('default policy: no footstep documents, exact minutes, correct daily totals, private config', async () => {
    const store = await recorded();
    const agent = await startAgent();
    const c = client(store, agent.base, TOKEN, { chunkSize: 100 });
    await c.syncNow();
    expect(c.status()).toMatchObject({ state: 'idle', syncedSessions: 1, pendingSessions: 0 });

    const col = (n: string) => agent.docs.col(n);
    const [s] = (await store.listSessions()).filter((x) => x.source === 'device');
    const minutes = await store.getSessionMinutes(s!.id);

    expect([...col(COLLECTIONS.sessions).keys()]).toEqual([s!.id]); // demo never reaches Firestore
    expect(col(COLLECTIONS.footsteps).size).toBe(0); // footsteps disabled by default
    expect((await store.getSessionSteps(s!.id)).length).toBe(s!.steps); // still all stored locally
    expect(col(COLLECTIONS.energyMinutes).size).toBe(minutes.length);
    const minuteSteps = [...col(COLLECTIONS.energyMinutes).values()].reduce((a, d) => a + (d.steps as number), 0);
    expect(minuteSteps).toBe(s!.steps); // per-minute step counts carry every step

    const sessionDoc = col(COLLECTIONS.sessions).get(s!.id)!;
    const exact = minutes.reduce((a, m) => a + BigInt(m.energyNj2), 0n);
    expect(sessionDoc.energyNj2).toBe(exact.toString());
    expect(sessionDoc.footstepsUploaded).toBe(false);
    expect(sessionDoc.startedAt).toEqual(new Date(s!.startedAt));

    const day = [...col(COLLECTIONS.dailySummaries).values()][0]!;
    const totals = await store.getTotals((day.dayStart as Date).getTime(), (day.dayEnd as Date).getTime());
    expect(day.steps).toBe(totals.steps);
    expect(day.energyWh).toBe(totals.energyWh);
    expect(day.sessions).toBe(1);

    const device = col(COLLECTIONS.devices).get('FORCE-71B6')!;
    expect(device).not.toHaveProperty('profile');
    expect(device).not.toHaveProperty('site');
    const config = col(COLLECTIONS.deviceConfigs).get('FORCE-71B6')!;
    expect(config.site).toEqual({ id: 'lab-1', name: 'Florix lab, ground floor' });
    expect(config.profile).toHaveProperty('emissionFactorKgPerKwh');
  });

  it('footsteps on: every footstep is uploaded under the engine key; re-syncing is idempotent', async () => {
    const store = await recorded();
    const agent = await startAgent({ writer: { footsteps: true } });
    await client(store, agent.base).syncNow();
    const [s] = (await store.listSessions()).filter((x) => x.source === 'device');
    const steps = await store.getSessionSteps(s!.id);
    expect(agent.docs.col(COLLECTIONS.footsteps).size).toBe(steps.length);
    expect(agent.docs.col(COLLECTIONS.footsteps).has(steps[0]!.id)).toBe(true);
    expect(agent.docs.col(COLLECTIONS.sessions).get(s!.id)!.footstepsUploaded).toBe(true);

    const dump = () =>
      JSON.stringify(
        [...agent.docs.collections.entries()].map(([k, v]) => [
          k,
          [...v.entries()].map(([id, d]) => [id, { ...d, syncedAt: 0, createdAt: d.createdAt ? 1 : 0, computedAt: 0 }]),
        ]),
      );
    const before = dump();
    // a lost sync state: the agent answers 409, the client resets and uploads again
    const again = client(store, agent.base);
    await again.syncNow();
    expect(again.status().syncedSessions).toBe(1);
    expect(dump()).toBe(before); // identical documents, no duplicates
  });

  it('Firestore outage: 503, back-off, recording continues, then everything arrives', async () => {
    const store = mkStore();
    await record(store, { durationMs: 90_000 });
    const docs = new MemoryDocStore();
    docs.failNext = 1;
    const agent = await startAgent({ docs });
    let now = ANCHOR;
    const c = client(store, agent.base, TOKEN, { now: () => now, random: () => 0.5 });
    await c.syncNow();
    expect(c.status().state).toBe('offline');
    expect(c.status().lastError).toMatch(/Firestore unavailable/);
    await record(store, { durationMs: 60_000, anchor: ANCHOR + 1_000_000 });
    expect((await store.listSessions()).length).toBe(2);
    now += 2_000;
    await c.syncNow();
    expect(c.status()).toMatchObject({ state: 'idle', syncedSessions: 2 });
    expect(docs.col(COLLECTIONS.sessions).size).toBe(2);
  });

  it('wrong token: nothing is written and the dashboard shows "unpaired"', async () => {
    const store = await recorded();
    const agent = await startAgent();
    const c = client(store, agent.base, 'w'.repeat(43));
    await c.syncNow();
    expect(c.status().state).toBe('unpaired');
    expect(agent.writer.stats.writes).toBe(0);
  });

  it('agent down entirely: the client reports it and retries later', async () => {
    const store = mkStore();
    await record(store, { durationMs: 60_000 });
    const c = new SyncClient({
      source: source(store),
      state: new MemorySyncStateStore(),
      transport: fetchTransport('http://127.0.0.1:9/api/sync/v1', { timeoutMs: 2_000, getToken: () => TOKEN }),
    });
    await c.syncNow();
    expect(c.status().state).toBe('offline');
    expect(c.status().lastError).toMatch(/unreachable|did not answer/);
  });
});
