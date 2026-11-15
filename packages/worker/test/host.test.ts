import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type {
  ChartBatch,
  DeviceInfo,
  GapRecord,
  LiveSnapshot,
  SourceKind,
  StepEvent,
} from '@force/contracts';
import { DEFAULT_PROFILE } from '@force/engine';
import { simulate } from '@force/simulator';
import type { SimConfig } from '@force/simulator';
import { ForceDatabase, Store } from '@force/storage';
import { WorkerHost } from '../src/host.js';
import type { FromWorker, RpcMethod, ToWorker } from '../src/messages.js';

const ANCHOR = 1_700_000_000_000;
let n = 0;
let nowMs = ANCHOR;

const INFO: DeviceInfo = {
  deviceId: 'FORCE-HOST',
  name: 'FORCE-HOST',
  firmwareVersion: '1.0.0',
  sampleRateHz: 20,
  sensorLimitMa: 3200,
};

async function mkHost(storeOpts: ConstructorParameters<typeof Store>[1] = {}) {
  const store = new Store(new ForceDatabase(`host-${n++}`), { now: () => nowMs, ...storeOpts });
  const out: FromWorker[] = [];
  const host = new WorkerHost(store, (m) => out.push(m), {
    now: () => nowMs,
    autoTimers: false,
  });
  await host.init();
  const of = <T extends FromWorker['type']>(t: T) =>
    out.filter((m): m is Extract<FromWorker, { type: T }> => m.type === t);
  let rpcId = 0;
  const rpc = async (method: RpcMethod, ...args: unknown[]) => {
    const id = ++rpcId;
    host.handle({ type: 'rpc', id, method, args } as ToWorker);
    for (let i = 0; i < 200; i++) {
      const r = out.find((m) => m.type === 'rpcResult' && m.id === id);
      if (r && r.type === 'rpcResult') {
        if (!r.ok) throw new Error(r.error);
        return r.value;
      }
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error('rpc timed out');
  };
  const settle = () => host.whenIdle();
  return { host, store, out, of, rpc, settle };
}
type H = Awaited<ReturnType<typeof mkHost>>;

async function startStream(h: H, source: SourceKind = 'device') {
  h.host.handle({ type: 'link', state: 'connecting', atMs: ANCHOR });
  h.host.handle({ type: 'start', source, deviceId: INFO.deviceId, deviceInfo: INFO });
  await h.settle();
  h.host.handle({ type: 'link', state: 'streaming', atMs: ANCHOR });
}

function feed(h: H, cfg: Partial<SimConfig>, durationMs: number, anchor = ANCHOR) {
  for (const p of simulate(cfg, durationMs)) {
    nowMs = anchor + p.arrivalOffsetMs;
    const buf = p.bytes.slice().buffer;
    h.host.handle({ type: 'packet', buf, arrivalMs: nowMs });
  }
}

describe('worker host: live pipeline', () => {
  it('publishes snapshots, chart batches, steps and gaps from raw packets', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 90, faults: [{ kind: 'drop', atMs: 10_000, durationMs: 3000 }] }, 30_000);
    h.host.publish();
    const snap = h.of('snapshot').at(-1)!.snapshot as LiveSnapshot;
    expect(snap.connection).toBe('streaming');
    expect(snap.source).toBe('device');
    expect(snap.sessionId).toMatch(/^FORCE-HOST-/);
    expect(snap.metrics.steps).toBeGreaterThan(30);
    expect(snap.metrics.sessionEnergyJ).toBeGreaterThan(0);
    expect(snap.quality.lostPackets).toBe(60);
    expect(snap.lastPacketAt).not.toBeNull();

    const chart = h.of('chart').at(-1)!.batch as ChartBatch;
    expect(chart.times.length).toBe(601 - 60);
    expect(chart.powerW.length).toBe(chart.times.length);
    expect(h.of('step').length).toBe(snap.metrics.steps);
    expect(h.of('gap').map((g) => (g.gap as GapRecord).cause)).toEqual(['lost_packets']);
  });

  it('a second publish carries only the points since the first (batches do not repeat)', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 5000);
    h.host.publish();
    h.host.publish();
    expect(h.of('chart')).toHaveLength(1); // nothing new, no empty batch
    feed(h, { startSeq: 101, startDeviceTimeMs: 6000 }, 1000, ANCHOR + 6000); // a short gap
    h.host.publish();
    expect(h.of('chart')).toHaveLength(2);
  });

  it('idle snapshots exist before any data and carry no session', async () => {
    const h = await mkHost();
    h.host.publish();
    const snap = h.of('snapshot')[0]!.snapshot as LiveSnapshot;
    expect(snap.connection).toBe('idle');
    expect(snap.sessionId).toBeNull();
    expect(snap.metrics.steps).toBe(0);
    expect(h.of('chart')).toHaveLength(0);
  });

  it('stores while streaming and the session shows up in history after stop', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 90 }, 20_000);
    await h.host.flush();
    expect(((await h.rpc('listSessions')) as Array<{ status: string }>)[0]!.status).toBe('open');
    h.host.handle({ type: 'stop' });
    await h.settle();
    const list = (await h.rpc('listSessions')) as Array<{
      status: string;
      steps: number;
      energyWh: number;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('closed');
    expect(list[0]!.steps).toBeGreaterThan(20);
    // after stop the final numbers stay visible, but there is no open session
    h.host.publish();
    const snap = h.of('snapshot').at(-1)!.snapshot as LiveSnapshot;
    expect(snap.sessionId).toBeNull();
    expect(snap.metrics.steps).toBe(list[0]!.steps);
  });

  it('a stored session reprocessed through the worker equals live totals exactly', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 100, faults: [{ kind: 'drop', atMs: 8000, durationMs: 4000 }] }, 40_000);
    h.host.handle({ type: 'stop' });
    await h.settle();
    const [live] = (await h.rpc('listSessions')) as Array<Record<string, unknown> & { id: string }>;
    const re = (await h.rpc('recomputeSession', live!.id, DEFAULT_PROFILE)) as Record<
      string,
      unknown
    >;
    for (const k of [
      'energyWh',
      'steps',
      'recordedMs',
      'bridgedMs',
      'excludedGapMs',
      'peakPowerW',
    ]) {
      expect(re[k]).toBe(live![k]);
    }
  });
});

describe('worker host: connection states and sources', () => {
  it('stale and reconnecting label the next gap; the session stays open', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 5000);
    h.host.handle({ type: 'link', state: 'stale', atMs: nowMs });
    feed(h, { startSeq: 101, startDeviceTimeMs: 7000 }, 2000, ANCHOR + 7000);
    h.host.handle({ type: 'link', state: 'streaming', atMs: nowMs });
    h.host.handle({ type: 'link', state: 'reconnecting', atMs: nowMs });
    feed(h, { startSeq: 160, startDeviceTimeMs: 12_000 }, 2000, ANCHOR + 12_000);
    const causes = h.of('gap').map((g) => (g.gap as GapRecord).cause);
    expect(causes).toEqual(['stale', 'link_down']);
    expect(h.host.snapshot().sessionId).not.toBeNull();
  });

  it('going idle closes the session, and logs connection events', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 3000);
    h.host.handle({ type: 'link', state: 'reconnecting', atMs: nowMs });
    h.host.handle({ type: 'link', state: 'idle', atMs: nowMs + 60_000 });
    await h.settle();
    expect(h.host.snapshot().sessionId).toBeNull();
    const events = (await h.store.listEvents()).map((e) => e.type);
    expect(events).toContain('dropped');
  });

  it('a source error is shown as an alert until the next start', async () => {
    const h = await mkHost();
    h.host.handle({ type: 'link', state: 'error', detail: 'Device not found', atMs: nowMs });
    const a = h.host.snapshot().alerts.find((x) => x.kind === 'source_error');
    expect(a?.message).toBe('Device not found');
  });

  it('demo sessions never feed all-time totals; real sessions do', async () => {
    const h = await mkHost();
    await startStream(h, 'demo');
    feed(h, { cadenceSpm: 90 }, 20_000);
    h.host.handle({ type: 'stop' });
    await h.settle();
    await startStream(h, 'device');
    feed(h, { cadenceSpm: 90 }, 1000, ANCHOR + 100_000);
    const s1 = h.host.snapshot();
    expect(s1.source).toBe('device');
    expect(s1.metrics.totalEnergyWh).toBeCloseTo(s1.metrics.sessionEnergyWh, 12); // demo energy not included
    h.host.handle({ type: 'stop' });
    await h.settle();
    await startStream(h, 'device');
    feed(h, { cadenceSpm: 90 }, 1000, ANCHOR + 200_000);
    const s2 = h.host.snapshot();
    expect(s2.metrics.totalEnergyWh).toBeGreaterThan(s2.metrics.sessionEnergyWh); // earlier real session counts
  });

  it('starting a new stream closes the previous session first', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 3000);
    await startStream(h);
    const list = (await h.rpc('listSessions')) as Array<{ status: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('closed');
  });
});

describe('worker host: settings and history RPC', () => {
  it('saves a profile, validates it, and applies it to the next samples', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 90 }, 5000);
    const before = h.host.snapshot().metrics.steps;
    expect(before).toBeGreaterThan(0);
    await h.rpc('saveProfile', { ...DEFAULT_PROFILE, stepThresholdW: 50 });
    expect(((await h.rpc('getProfile')) as { stepThresholdW: number }).stepThresholdW).toBe(50);
    feed(h, { cadenceSpm: 90, startSeq: 101, startDeviceTimeMs: 5050 }, 5000, ANCHOR + 5050);
    expect(h.host.snapshot().metrics.steps).toBe(before); // 2 W pulses never reach 50 W
    await expect(h.rpc('saveProfile', { ...DEFAULT_PROFILE, stepThresholdW: -1 })).rejects.toThrow(
      /Invalid profile/,
    );
    expect(((await h.rpc('getProfile')) as { stepThresholdW: number }).stepThresholdW).toBe(50);
  });

  it('series, steps, gaps, CSV, JSON, totals, rename, delete, delete-all', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 90, faults: [{ kind: 'drop', atMs: 5000, durationMs: 2000 }] }, 20_000);
    h.host.handle({ type: 'stop' });
    await h.settle();
    const [s] = (await h.rpc('listSessions')) as Array<{ id: string; steps: number }>;
    const id = s!.id;
    expect(((await h.rpc('getSessionSeries', id)) as ChartBatch).times.length).toBe(401 - 40);
    expect(((await h.rpc('getSessionSteps', id)) as StepEvent[]).length).toBe(s!.steps);
    expect(((await h.rpc('getSessionGaps', id)) as GapRecord[]).length).toBe(1);
    expect(await ((await h.rpc('exportCsv', id)) as Blob).text()).toContain(
      'time_utc,device_time_ms',
    );
    expect(JSON.parse(await ((await h.rpc('exportSessionJson', id)) as Blob).text()).format).toBe(
      'force-session-backup',
    );
    const totals = (await h.rpc('getTotals', ANCHOR - 1, ANCHOR + 86_400_000)) as { steps: number };
    expect(totals.steps).toBe(s!.steps);
    expect(
      await ((await h.rpc('exportStepsCsv', ANCHOR - 1, ANCHOR + 86_400_000)) as Blob).text(),
    ).toContain('event_id');
    await h.rpc('renameSession', id, 'walk test');
    expect(((await h.rpc('listSessions')) as Array<{ name: string }>)[0]!.name).toBe('walk test');
    await h.rpc('deleteSession', id);
    expect(await h.rpc('listSessions')).toEqual([]);
    await startStream(h);
    feed(h, {}, 2000, ANCHOR + 500_000);
    await h.rpc('deleteAllData');
    expect(await h.rpc('listSessions')).toEqual([]);
    expect(h.host.snapshot().sessionId).toBeNull();
  });

  it('refuses to delete the session that is still recording', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 2000);
    await h.host.flush();
    const sid = h.host.snapshot().sessionId!;
    await expect(h.rpc('deleteSession', sid)).rejects.toThrow(/Stop the session/);
  });

  it('imports a backup as a stored session', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, { cadenceSpm: 90 }, 10_000);
    h.host.handle({ type: 'stop' });
    await h.settle();
    const [s] = (await h.rpc('listSessions')) as Array<{ id: string; steps: number }>;
    const text = await ((await h.rpc('exportSessionJson', s!.id)) as Blob).text();
    // the same session is still stored, so a restore would double-count it
    await expect(h.rpc('importSessionJson', text)).rejects.toThrow(/already stored/);
    await h.rpc('deleteSession', s!.id);
    const imported = (await h.rpc('importSessionJson', text)) as { steps: number };
    expect(imported.steps).toBe(s!.steps);
    expect(((await h.rpc('listSessions')) as unknown[]).length).toBe(1);
  });
});

describe('worker host: resilience', () => {
  it('a storage failure raises an alert, streaming continues, and nothing is lost on retry', async () => {
    const h = await mkHost();
    await startStream(h);
    const realPut = h.store.db.chunks.bulkPut.bind(h.store.db.chunks);
    let fail = true;
    (h.store.db.chunks as unknown as { bulkPut: unknown }).bulkPut = (rows: never) =>
      fail ? Promise.reject(new Error('QuotaExceededError')) : realPut(rows);
    feed(h, { cadenceSpm: 90 }, 5000);
    await h.host.flush();
    expect(h.host.snapshot().alerts.some((a) => a.kind === 'storage_error')).toBe(true);
    feed(h, { cadenceSpm: 90, startSeq: 101, startDeviceTimeMs: 5050 }, 5000, ANCHOR + 5050);
    expect(h.host.snapshot().metrics.sessionEnergyJ).toBeGreaterThan(0); // still computing in memory
    fail = false;
    h.host.handle({ type: 'stop' });
    await h.settle();
    expect(h.host.snapshot().alerts.some((a) => a.kind === 'storage_error')).toBe(false);
    const id = ((await h.rpc('listSessions')) as Array<{ id: string }>)[0]!.id;
    expect(((await h.rpc('getSessionSeries', id)) as ChartBatch).times.length).toBe(202);
  });

  it('a low-storage quota raises an alert', async () => {
    const h = await mkHost({ estimate: async () => ({ usage: 90, quota: 100 }) });
    expect(h.host.snapshot().alerts.some((a) => a.kind === 'storage_low')).toBe(true);
  });

  it('an unexpected decoder exception ends only the session, keeps stored data, tells main', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 4000);
    await h.host.flush();
    // not an ArrayBuffer: decoding throws
    h.host.handle({ type: 'packet', buf: null as unknown as ArrayBuffer, arrivalMs: nowMs });
    await h.settle();
    const fatal = h.of('fatal');
    expect(fatal).toHaveLength(1);
    expect(h.host.snapshot().alerts.some((a) => a.kind === 'source_error')).toBe(true);
    const list = (await h.rpc('listSessions')) as Array<{ status: string; energyWh: number }>;
    expect(list[0]!.status).toBe('closed');
    expect(list[0]!.energyWh).toBeGreaterThan(0);
  });

  it('startup recovers a session that was cut off', async () => {
    const h = await mkHost();
    await startStream(h);
    feed(h, {}, 6000);
    await h.host.flush(); // open session on disk, then "the tab dies"
    const name = h.store.db.name;
    h.store.db.close();
    const store2 = new Store(new ForceDatabase(name), { now: () => nowMs });
    const out2: FromWorker[] = [];
    const host2 = new WorkerHost(store2, (m) => out2.push(m), {
      now: () => nowMs,
      autoTimers: false,
    });
    await host2.init();
    const list = await store2.listSessions();
    expect(list[0]!.status).toBe('interrupted');
    expect(out2[0]!.type).toBe('ready');
  });

  it('auto timers publish and flush on their own', async () => {
    const store = new Store(new ForceDatabase(`host-${n++}`));
    const out: FromWorker[] = [];
    const host = new WorkerHost(store, (m) => out.push(m), {
      publishIntervalMs: 10,
      flushIntervalMs: 20,
      quotaIntervalMs: 1000,
    });
    await host.init();
    // poll instead of a fixed sleep: a loaded machine delays timers, the behaviour is unchanged
    const snapshots = () => out.filter((m) => m.type === 'snapshot').length;
    for (let i = 0; i < 100 && snapshots() < 3; i++) await new Promise((r) => setTimeout(r, 20));
    host.dispose();
    expect(snapshots()).toBeGreaterThanOrEqual(3);
  });
});
