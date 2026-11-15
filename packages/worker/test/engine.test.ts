import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { ChartBatch, GapRecord, LiveSnapshot, StepEvent } from '@force/contracts';
import { FakeClock } from '@force/device';
import { simulate } from '@force/simulator';
import { ForceDatabase, Store } from '@force/storage';
import { DEFAULT_PROFILE } from '@force/engine';
import { makeBackup } from '../../device/test/backup.js';
import { FakeBluetooth, FakeDevice } from '../../device/test/fakes.js';
import { createEngine, createInlineWorker, createMockEngine } from '../src/index.js';
import type { EngineHandle, FromWorker, InlineWorker, ToWorker, WorkerLike } from '../src/index.js';

let n = 0;

function rig(opts: { bluetooth?: FakeBluetooth | null } = {}) {
  const clock = new FakeClock();
  const store = new Store(new ForceDatabase(`eng-${n++}`), { now: () => clock.now() });
  const sent: Array<{ msg: ToWorker; transfer?: Transferable[] }> = [];
  const inlines: InlineWorker[] = [];
  const createWorker = (): WorkerLike => {
    const inline = createInlineWorker(store, { autoTimers: false, now: () => clock.now() });
    inlines.push(inline);
    const wrapped: WorkerLike = {
      get onmessage() {
        return inline.onmessage;
      },
      set onmessage(v) {
        inline.onmessage = v;
      },
      postMessage: (msg, transfer) => {
        sent.push({ msg, ...(transfer ? { transfer } : {}) });
        inline.postMessage(msg, transfer);
      },
      terminate: () => inline.terminate(),
    };
    return wrapped;
  };
  const engine: EngineHandle = createEngine({
    clock,
    createWorker,
    // a supported browser by default; pass `bluetooth: null` for the unsupported case
    bluetooth:
      opts.bluetooth === undefined
        ? new FakeBluetooth(new FakeDevice(() => clock.now()))
        : opts.bluetooth,
  });
  const snaps: LiveSnapshot[] = [];
  const charts: ChartBatch[] = [];
  const steps: StepEvent[] = [];
  const gaps: GapRecord[] = [];
  engine.subscribeSnapshot((s) => snaps.push(s));
  engine.subscribeChart((b) => charts.push(b));
  engine.subscribeSteps((e) => steps.push(e));
  engine.subscribeGaps((g) => gaps.push(g));
  const host = () => inlines.at(-1)!.host;
  /** Lets the async worker plumbing settle, then publishes once. */
  const settle = async () => {
    // messages hop through promise chains before reaching the worker host...
    for (let i = 0; i < 30; i++) await Promise.resolve();
    // ...then wait for its lifecycle work (database reads and writes) to finish
    await inlines.at(-1)!.idle();
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const publish = async () => {
    await settle();
    host().publish();
    await settle();
  };
  return { clock, store, engine, sent, inlines, snaps, charts, steps, gaps, host, settle, publish };
}

const latest = (r: ReturnType<typeof rig>) => r.snaps.at(-1)!;

describe('engine facade: demo source end to end', () => {
  it('startDemo -> live snapshots, chart batches, steps; disconnect saves a "demo" session', async () => {
    const r = rig();
    r.engine.startDemo({ cadenceSpm: 90, sampleRateHz: 20 });
    await r.settle();
    await r.clock.advanceAsync(10_000);
    await r.publish();

    const s = latest(r);
    expect(s.connection).toBe('streaming');
    expect(s.source).toBe('demo');
    expect(s.sessionId).toMatch(/^DEMO-/);
    expect(s.metrics.steps).toBeGreaterThan(10);
    expect(s.metrics.sessionEnergyJ).toBeGreaterThan(0);
    expect(r.engine.getDeviceInfo()?.deviceId).toBe('DEMO');
    expect(r.charts.length).toBeGreaterThan(0);
    expect(r.charts.reduce((a, b) => a + b.times.length, 0)).toBe(201);
    expect(r.steps.length).toBe(s.metrics.steps);

    await r.engine.disconnect();
    await r.settle();
    const list = await r.engine.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.source).toBe('demo');
    expect(list[0]!.status).toBe('closed');
    expect(r.engine.getDeviceInfo()).toBeNull();
    await r.publish();
    expect(latest(r).connection).toBe('idle');
    expect(latest(r).sessionId).toBeNull();
  });

  it('packets are TRANSFERRED to the worker, not copied', async () => {
    const r = rig();
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(500);
    const packets = r.sent.filter((x) => x.msg.type === 'packet');
    expect(packets.length).toBeGreaterThan(5);
    for (const p of packets) {
      expect(p.transfer).toHaveLength(1);
      expect(p.transfer![0]).toBe((p.msg as Extract<ToWorker, { type: 'packet' }>).buf);
    }
  });

  it('the worker is told a stream begins BEFORE the first packet', async () => {
    const r = rig();
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(500);
    const types = r.sent.map((x) => x.msg.type);
    expect(types.indexOf('start')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('start')).toBeLessThan(types.indexOf('packet'));
  });

  it('a late subscriber is handed the latest snapshot at once; unsubscribe stops delivery', async () => {
    const r = rig();
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(2000);
    await r.publish();
    let got: LiveSnapshot | null = null;
    const off = r.engine.subscribeSnapshot((s) => (got = s));
    expect(got).not.toBeNull();
    off();
    got = null;
    await r.publish();
    expect(got).toBeNull();
  });

  it('starting another source stops the first and keeps one open session at a time', async () => {
    const r = rig();
    r.engine.startDemo({ cadenceSpm: 60 });
    await r.settle();
    await r.clock.advanceAsync(3000);
    r.engine.startDemo({ cadenceSpm: 120 });
    await r.settle();
    await r.clock.advanceAsync(3000);
    await r.publish();
    await r.host().flush(); // the once-a-second timer is off in tests
    const list = await r.engine.listSessions();
    expect(list).toHaveLength(2);
    expect(list.filter((x) => x.status === 'open')).toHaveLength(1);
    expect(list.filter((x) => x.status === 'closed')).toHaveLength(1);
  });
});

describe('engine facade: Bluetooth path', () => {
  function bt() {
    const clock = new FakeClock();
    return new FakeBluetooth(new FakeDevice(() => clock.now()));
  }

  it('unsupported browser: supported() is false, connect() rejects, snapshots say unsupported', async () => {
    const r = rig({ bluetooth: null });
    expect(r.engine.supported()).toBe(false);
    await expect(r.engine.connect()).rejects.toThrow(/Chrome or Edge/);
    await r.publish();
    expect(latest(r).connection).toBe('unsupported');
    // the demo still works: the unsupported screen offers it
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(1000);
    await r.publish();
    expect(latest(r).source).toBe('demo');
  });

  it('connect -> device info, streaming snapshots, packets decoded from the fake unit', async () => {
    const fake = bt();
    const r = rig({ bluetooth: fake });
    // the FakeDevice uses its own clock; share ours so retry timing lines up
    const clock = r.clock;
    (fake.device as unknown as { now: () => number }).now = () => clock.now();
    expect(r.engine.supported()).toBe(true);
    await r.engine.connect();
    expect(r.engine.getDeviceInfo()).toMatchObject({
      deviceId: 'FORCE-A1B2',
      sampleRateHz: 20,
      sensorLimitMa: 3200,
    });
    for (const p of simulate({ cadenceSpm: 90 }, 10_000)) {
      clock.advance(p.arrivalOffsetMs - (clock.now() - 1_700_000_000_000));
      fake.device.telemetry.emit(p.bytes);
    }
    await r.publish();
    const s = latest(r);
    expect(s.connection).toBe('streaming');
    expect(s.source).toBe('device');
    expect(s.sessionId).toMatch(/^FORCE-A1B2-/);
    expect(s.metrics.steps).toBeGreaterThan(10);
    expect(s.quality.lostPackets).toBe(0);
  });

  it('link loss: snapshots show reconnecting; after restore the gap is labelled link_down; same session', async () => {
    const fake = bt();
    const r = rig({ bluetooth: fake });
    const clock = r.clock;
    (fake.device as unknown as { now: () => number }).now = () => clock.now();
    await r.engine.connect();
    const packets = simulate({ cadenceSpm: 90 }, 20_000);
    let i = 0;
    const play = async (untilMs: number) => {
      while (i < packets.length && packets[i]!.arrivalOffsetMs <= untilMs) {
        const target = 1_700_000_000_000 + packets[i]!.arrivalOffsetMs;
        await clock.advanceAsync(target - clock.now());
        if (fake.device.gatt.connected) fake.device.telemetry.emit(packets[i]!.bytes);
        i++;
      }
    };
    await play(5000);
    await r.publish();
    const sessionBefore = latest(r).sessionId;
    expect(latest(r).connection).toBe('streaming');

    fake.device.dropLink();
    await r.publish();
    expect(latest(r).connection).toBe('reconnecting');
    await play(9000); // the unit keeps sampling; nothing arrives until the retry succeeds at +1 s
    await clock.advanceAsync(1500);
    await play(20_000);
    await r.publish();
    expect(latest(r).connection).toBe('streaming');
    expect(latest(r).sessionId).toBe(sessionBefore); // continues the same session
    expect(r.gaps.some((g) => g.cause === 'link_down')).toBe(true);
    expect(latest(r).quality.excludedGapMs + latest(r).quality.bridgedMs).toBeGreaterThan(0);
  });

  it('disconnect(): closes the session, stops notifications, releases GATT', async () => {
    const fake = bt();
    const r = rig({ bluetooth: fake });
    const clock = r.clock;
    (fake.device as unknown as { now: () => number }).now = () => clock.now();
    await r.engine.connect();
    for (const p of simulate({}, 3000)) {
      clock.advance(50);
      fake.device.telemetry.emit(p.bytes);
    }
    await r.engine.disconnect();
    await r.settle();
    expect(fake.device.telemetry.notifying).toBe(false);
    expect(fake.device.gatt.connected).toBe(false);
    const list = await r.engine.listSessions();
    expect(list[0]!.status).toBe('closed');
    expect(list[0]!.source).toBe('device');
  });

  it('picker cancelled: stays idle, no error alert', async () => {
    const fake = bt();
    fake.outcome = { name: 'NotFoundError', message: 'cancelled' };
    const r = rig({ bluetooth: fake });
    await r.engine.connect();
    await r.publish();
    expect(latest(r).connection).toBe('idle');
    expect(latest(r).alerts.some((a) => a.kind === 'source_error')).toBe(false);
  });

  it('connect failure surfaces a plain-language alert', async () => {
    const fake = bt();
    fake.device.failConnects = 1;
    const r = rig({ bluetooth: fake });
    await r.engine.connect();
    await r.publish();
    expect(latest(r).connection).toBe('error');
    expect(latest(r).alerts.find((a) => a.kind === 'source_error')?.message).toMatch(
      /Could not connect/,
    );
  });
});

describe('engine facade: replay', () => {
  it('replays a backup file as source "replay" and labels the session', async () => {
    const r = rig();
    const file = { text: async () => makeBackup(10_000) } as unknown as File;
    await r.engine.startReplay(file);
    await r.settle();
    await r.clock.advanceAsync(6000);
    await r.publish();
    expect(latest(r).source).toBe('replay');
    expect(latest(r).connection).toBe('streaming');
    expect(latest(r).metrics.steps).toBeGreaterThan(5);
    await r.clock.advanceAsync(6000);
    await r.settle();
    const list = await r.engine.listSessions();
    expect(list[0]!.source).toBe('replay');
    expect(list[0]!.status).toBe('closed');
    // replays never feed real all-time totals
    const totals = await r.engine.getTotals(0, 4_000_000_000_000);
    expect(totals.steps).toBe(0);
  });

  it('rejects a bad file with a plain message and does not start anything', async () => {
    const r = rig();
    const file = { text: async () => 'definitely not a backup' } as unknown as File;
    await expect(r.engine.startReplay(file)).rejects.toThrow(/valid JSON/);
    await r.publish();
    expect(latest(r).connection).toBe('idle');
  });
});

describe('engine facade: settings, history and resilience', () => {
  it('profile round trip and validation come back as rejections', async () => {
    const r = rig();
    expect(await r.engine.getProfile()).toEqual(DEFAULT_PROFILE);
    await r.engine.saveProfile({ ...DEFAULT_PROFILE, stepThresholdW: 2 });
    expect((await r.engine.getProfile()).stepThresholdW).toBe(2);
    await expect(r.engine.saveProfile({ ...DEFAULT_PROFILE, ledWatts: 0 })).rejects.toThrow(
      /Invalid profile/,
    );
  });

  it('history: series, steps, gaps, exports, totals, recompute, rename, delete, delete all', async () => {
    const r = rig();
    r.engine.startDemo({ cadenceSpm: 90 });
    await r.settle();
    await r.clock.advanceAsync(15_000);
    await r.engine.disconnect();
    await r.settle();
    const [s] = await r.engine.listSessions();
    const id = s!.id;
    expect((await r.engine.getSessionSeries(id)).times.length).toBe(301);
    expect(
      (await r.engine.getSessionSeries(id, [r.clock.now() - 15_000, r.clock.now() - 14_000])).times
        .length,
    ).toBeLessThan(25);
    expect((await r.engine.getSessionSteps(id)).length).toBe(s!.steps);
    expect(await r.engine.getSessionGaps(id)).toEqual([]);
    expect(await (await r.engine.exportCsv(id)).text()).toContain('time_utc');
    expect(JSON.parse(await (await r.engine.exportSessionJson(id)).text()).session.id).toBe(id);
    const re = await r.engine.recomputeSession(id, DEFAULT_PROFILE);
    expect(re.steps).toBe(s!.steps);
    expect(re.energyWh).toBe(s!.energyWh);
    await r.engine.renameSession(id, 'my walk');
    expect((await r.engine.listSessions())[0]!.name).toBe('my walk');
    await r.engine.deleteSession(id);
    expect(await r.engine.listSessions()).toEqual([]);
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(2000);
    await r.engine.deleteAllData();
    expect(await r.engine.listSessions()).toEqual([]);
  });

  it('a worker "fatal" replaces the worker, rejects pending calls, and shows an alert; history survives', async () => {
    const r = rig();
    r.engine.startDemo({ cadenceSpm: 90 });
    await r.settle();
    await r.clock.advanceAsync(6000);
    await r.settle();
    await r.host().flush();
    expect(r.inlines).toHaveLength(1);
    const pending = r.engine.listSessions();
    const msg: FromWorker = { type: 'fatal', message: 'boom' };
    r.inlines[0]!.onmessage?.({ data: msg });
    await expect(pending).rejects.toThrow(/restarted/);
    await r.settle();
    expect(r.inlines).toHaveLength(2); // a new worker
    await r.publish();
    expect(latest(r).connection).toBe('idle');
    expect(latest(r).alerts.find((a) => a.kind === 'source_error')?.message).toMatch(/boom/);
    const list = await r.engine.listSessions(); // stored history is intact, served by the new worker
    expect(list.length).toBeGreaterThanOrEqual(1);
    // connecting again clears the alert
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(1000);
    await r.publish();
    expect(latest(r).alerts.some((a) => a.kind === 'source_error')).toBe(false);
  });

  it('dispose() stops timers and the worker', async () => {
    const r = rig();
    r.engine.startDemo();
    await r.settle();
    await r.clock.advanceAsync(1000);
    r.engine.dispose();
    await r.settle();
    expect(r.clock.pendingTimers).toBe(0);
  });
});

describe('mock engine: the whole DashboardEngine surface with no hardware', () => {
  it('connect() streams simulated steps; every seam method works; faults can be injected', async () => {
    const clock = new FakeClock();
    const mock = createMockEngine({
      dbName: `mock-${n++}`,
      clock,
      host: { autoTimers: false, now: () => clock.now() },
    });
    expect(mock.supported()).toBe(true);
    const snaps: LiveSnapshot[] = [];
    const gaps: GapRecord[] = [];
    mock.subscribeSnapshot((s) => snaps.push(s));
    mock.subscribeGaps((g) => gaps.push(g));
    expect(() => mock.injectFault({ kind: 'drop', durationMs: 100 })).toThrow(/Start the mock/);

    await mock.connect();
    await clock.advanceAsync(3000);
    mock.injectFault({ kind: 'drop', durationMs: 500 }, 0); // short: bridged, lost packets
    await clock.advanceAsync(2000);
    mock.injectFault({ kind: 'stale', durationMs: 3000 }, 0); // long: the source goes stale
    await clock.advanceAsync(8000);
    // the mock's worker runs on real IndexedDB work: poll for the result instead of sleeping
    const waitFor = async (cond: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 400 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10));
    };
    await waitFor(() => gaps.length >= 2);
    expect(gaps.map((g) => g.cause)).toEqual(['lost_packets', 'stale']);

    expect(mock.getDeviceInfo()?.name).toMatch(/Demo/);
    await mock.disconnect();
    await waitFor(async () => (await mock.listSessions()).some((s) => s.status === 'closed'));
    const sessions = await mock.listSessions();
    expect(sessions[0]!.source).toBe('demo');
    expect(sessions[0]!.excludedGapMs).toBeGreaterThan(2500);

    // the rest of the surface
    const id = sessions[0]!.id;
    expect(await mock.getProfile()).toEqual(DEFAULT_PROFILE);
    await mock.saveProfile(DEFAULT_PROFILE);
    expect((await mock.getSessionSeries(id)).times.length).toBeGreaterThan(0);
    expect(await mock.getSessionSteps(id)).toBeInstanceOf(Array);
    expect((await mock.getSessionGaps(id)).length).toBe(gaps.length);
    expect(await (await mock.exportCsv(id)).text()).toContain('energy_J');
    expect(await (await mock.exportSessionJson(id)).text()).toContain('force-session-backup');
    expect((await mock.getTotals(0, 4e12)).steps).toBe(0); // demo never counts
    expect(await (await mock.exportStepsCsv(0, 4e12)).text()).toContain('event_id');
    expect((await mock.recomputeSession(id, DEFAULT_PROFILE)).id).toBe(id);
    await mock.renameSession(id, 'x');
    mock.startDemo({ cadenceSpm: 60 });
    await clock.advanceAsync(1000);
    mock.stop();
    await mock.deleteSession(id);
    await mock.deleteAllData();
    expect(await mock.listSessions()).toEqual([]);
    mock.dispose();
  });
});
