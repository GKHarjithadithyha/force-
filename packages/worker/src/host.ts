import type {
  Alert,
  ChartBatch,
  ConnectionState,
  DeviceInfo,
  DeviceProfile,
  LiveSnapshot,
  SourceKind,
} from '@force/contracts';
import { DEFAULT_PROFILE, Pipeline, validateProfile, withProfileDefaults } from '@force/engine';
import type { ChartPoint } from '@force/engine';
import type { Store } from '@force/storage';
import type { Post, RpcMethod, ToWorker } from './messages.js';

export interface HostOptions {
  now?: () => number;
  /** Snapshot and chart publish interval (Architecture: about 100 ms). */
  publishIntervalMs?: number;
  /** Storage flush interval (Architecture: once a second). */
  flushIntervalMs?: number;
  /** How often to check the storage quota. */
  quotaIntervalMs?: number;
  /** false in tests: they drive `publish()` and `flush()` themselves. */
  autoTimers?: boolean;
}

/**
 * The worker's brain, free of any `self` or `postMessage` so it runs in plain tests:
 * decoder -> sequence check -> engine -> storage writer, a snapshot about every 100 ms, history
 * queries. `worker.ts` is the thin shell that connects it to a real Web Worker.
 */
export class WorkerHost {
  private pipe: Pipeline;
  private source: SourceKind = 'device';
  private deviceId = 'unknown';
  private connection: ConnectionState = 'idle';
  private profile: DeviceProfile = { ...DEFAULT_PROFILE };
  private rssi: number | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private sourceError: string | null = null;
  private quotaWarn = false;

  // chart accumulation: grown arrays, copied out on publish (so buffers can be transferred)
  private cap = 4096;
  private n = 0;
  private times = new Float64Array(this.cap);
  private power = new Float64Array(this.cap);
  private volt = new Float64Array(this.cap);
  private curr = new Float64Array(this.cap);

  private timers: Array<ReturnType<typeof setInterval>> = [];
  private readonly now: () => number;
  private readonly publishMs: number;
  private readonly flushMs: number;
  private readonly quotaMs: number;
  private readonly auto: boolean;

  constructor(
    private readonly store: Store,
    private readonly post: Post,
    opts: HostOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.publishMs = opts.publishIntervalMs ?? 100;
    this.flushMs = opts.flushIntervalMs ?? 1000;
    this.quotaMs = opts.quotaIntervalMs ?? 30_000;
    this.auto = opts.autoTimers ?? true;
    this.pipe = this.makePipeline(0, 0);
  }

  /** Startup: recover cut-off sessions, load the profile, start timers, announce ready. */
  async init(): Promise<void> {
    await this.store.recoverInterrupted();
    this.profile = await this.store.getProfile();
    this.pipe = this.makePipeline(...(await this.priors()));
    await this.store.requestPersistence().catch(() => false);
    await this.checkQuota();
    if (this.auto) {
      this.timers.push(setInterval(() => this.publish(), this.publishMs));
      this.timers.push(setInterval(() => void this.flush(), this.flushMs));
      this.timers.push(setInterval(() => void this.checkQuota(), this.quotaMs));
    }
    this.post({ type: 'ready' });
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------------------------------------------------------------------------------------
  // Messages from the main thread
  // ---------------------------------------------------------------------------------------

  /**
   * Lifecycle messages (start, stop, a link that closes the session, delete-all) are async and
   * must finish IN ORDER before anything after them is handled, or the first packets after a
   * `start` would land in the previous pipeline. While one runs, later messages wait in a queue.
   * Packets stay synchronous when nothing is in flight; history queries run concurrently so a
   * long CSV export never delays live samples.
   */
  private queue: ToWorker[] = [];
  private busy = false;

  handle(msg: ToWorker): void {
    if (this.busy) {
      this.queue.push(msg);
      return;
    }
    this.dispatch(msg);
  }

  private idleWaiters: Array<() => void> = [];

  /** Resolves when no lifecycle operation is running or waiting (start, stop, close, delete-all). */
  whenIdle(): Promise<void> {
    if (!this.busy && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private exclusive(op: () => Promise<void>): void {
    this.busy = true;
    void op()
      .catch((e) => this.failImpl(e))
      .finally(() => {
        this.busy = false;
        while (!this.busy && this.queue.length > 0) this.dispatch(this.queue.shift() as ToWorker);
        if (!this.busy) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const w of waiters) w();
        }
      });
  }

  private dispatch(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case 'packet':
          this.pipe.pushPacket(msg.buf, msg.arrivalMs);
          break;
        case 'start':
          this.exclusive(() => this.startStream(msg.source, msg.deviceId, msg.deviceInfo));
          break;
        case 'stop':
          this.exclusive(() => this.closeSession());
          break;
        case 'link':
          this.onLink(msg.state, msg.detail, msg.atMs);
          break;
        case 'rssi':
          this.rssi = msg.dbm;
          this.pipe.setRssi(msg.dbm);
          break;
        case 'rpc':
          if (msg.method === 'deleteAllData') {
            this.exclusive(() => this.runRpc(msg.id, msg.method, msg.args));
          } else {
            void this.runRpc(msg.id, msg.method, msg.args);
          }
          break;
      }
    } catch (e) {
      this.exclusive(() => this.failImpl(e));
    }
  }

  /** Failure isolation (Architecture section 12): end the session, keep stored history, tell main. */
  private async failImpl(e: unknown): Promise<void> {
    const message = e instanceof Error ? e.message : String(e);
    this.sourceError = `Internal error, session ended: ${message}`;
    try {
      this.pipe.close();
      await this.flush();
    } catch {
      /* the store is what failed; nothing more to do */
    }
    this.post({ type: 'fatal', message });
  }

  private async startStream(
    source: SourceKind,
    deviceId: string,
    deviceInfo: DeviceInfo | null,
  ): Promise<void> {
    await this.closeSession();
    this.source = source;
    this.deviceId = deviceId;
    this.deviceInfo = deviceInfo;
    this.sourceError = null;
    this.profile = await this.store.getProfile();
    const [energyWh, steps] = await this.priors();
    this.pipe = this.makePipeline(energyWh, steps);
    if (deviceInfo) {
      await this.store.saveDevice(deviceInfo);
      this.pipe.setDeviceSensorLimit(deviceInfo.sensorLimitMa);
    }
    this.pipe.setRssi(this.rssi);
    this.n = 0;
  }

  private async closeSession(): Promise<void> {
    if (this.pipe.hasOpenSession) {
      this.pipe.close();
      await this.flush();
    }
  }

  private onLink(state: ConnectionState, detail: string | undefined, atMs: number): void {
    const was = this.connection;
    this.connection = state;
    if (state === 'stale') this.pipe.notifyStale();
    if (state === 'reconnecting') this.pipe.notifyLinkDown();
    if (state === 'error') this.sourceError = detail ?? 'The connection failed.';
    else if (state === 'streaming' || state === 'connecting') this.sourceError = null;
    if (state !== was) {
      this.store.logEvent({
        time: atMs,
        deviceId: this.deviceId,
        type:
          state === 'reconnecting'
            ? 'dropped'
            : state === 'streaming' && was === 'reconnecting'
              ? 'reconnected'
              : state === 'streaming'
                ? 'connected'
                : state === 'error'
                  ? 'error'
                  : 'state',
        detail: detail ?? `${was} -> ${state}`,
      });
    }
    // Transition 11 / user disconnect / failure: the session closes, stored data is kept.
    if (state === 'idle' || state === 'error' || state === 'unsupported') {
      this.exclusive(() => this.closeSession());
    }
  }

  // ---------------------------------------------------------------------------------------
  // Publishing and persistence
  // ---------------------------------------------------------------------------------------

  /** Posts the live snapshot and the new chart points. About every 100 ms. */
  publish(): void {
    const snapshot = this.snapshot();
    this.post({ type: 'snapshot', snapshot });
    if (this.n > 0) {
      const batch = this.drainChart();
      this.post({ type: 'chart', batch }, [
        batch.times.buffer,
        batch.powerW.buffer,
        batch.voltageV.buffer,
        batch.currentMa.buffer,
      ]);
    }
  }

  snapshot(): LiveSnapshot {
    const s = this.pipe.snapshot({ nowMs: this.now(), connection: this.connection });
    const extra: Alert[] = [];
    if (this.quotaWarn) {
      extra.push({
        id: 'storage_low',
        kind: 'storage_low',
        severity: 'warning',
        since: this.now(),
        message: 'Browser storage is nearly full. Export your sessions and delete old ones.',
      });
    }
    if (this.store.lastError !== null) {
      extra.push({
        id: 'storage_error',
        kind: 'storage_error',
        severity: 'error',
        since: this.now(),
        message: `Saving failed (${this.store.lastError}). Data is kept in memory and saving retries; export what you can.`,
      });
    }
    if (this.sourceError !== null) {
      extra.push({
        id: 'source_error',
        kind: 'source_error',
        severity: 'error',
        since: this.now(),
        message: this.sourceError,
      });
    }
    if (extra.length > 0) s.alerts = [...s.alerts, ...extra];
    return s;
  }

  /** One storage transaction: chunks, steps, gaps, the minute in progress, the session record. */
  async flush(): Promise<void> {
    await this.store.flush({ summary: this.pipe.openSummary(), minute: this.pipe.peekMinute() });
  }

  private async checkQuota(): Promise<void> {
    try {
      this.quotaWarn = (await this.store.checkQuota()).warn;
    } catch {
      this.quotaWarn = false;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Pipeline construction and chart buffer
  // ---------------------------------------------------------------------------------------

  private async priors(): Promise<[number, number]> {
    if (this.source !== 'device') return [0, 0]; // demo and replay never feed all-time totals
    const p = await this.store.priorTotals();
    return [p.energyWh, p.steps];
  }

  private makePipeline(priorEnergyWh: number, priorSteps: number): Pipeline {
    return new Pipeline(
      {
        source: this.source,
        deviceId: this.deviceId,
        profile: this.profile,
        deviceSensorLimitMa: this.deviceInfo?.sensorLimitMa ?? null,
        priorEnergyWh,
        priorSteps,
        // arrival time is only a clock for a live device; demo and replay arrive on their own schedule
        checkClockDrift: this.source === 'device',
      },
      this.store.sink({
        onChartPoint: (p) => this.addPoint(p),
        onStep: (step) => this.post({ type: 'step', step }),
        onGap: (gap) => this.post({ type: 'gap', gap }),
      }),
    );
  }

  private addPoint(p: ChartPoint): void {
    if (this.n === this.cap) {
      this.cap *= 2;
      for (const k of ['times', 'power', 'volt', 'curr'] as const) {
        const bigger = new Float64Array(this.cap);
        bigger.set(this[k]);
        this[k] = bigger;
      }
    }
    this.times[this.n] = p.tMs;
    this.power[this.n] = p.powerW;
    this.volt[this.n] = p.voltageV;
    this.curr[this.n] = p.currentMa;
    this.n++;
  }

  private drainChart(): ChartBatch {
    const n = this.n;
    this.n = 0;
    return {
      times: this.times.slice(0, n),
      powerW: this.power.slice(0, n),
      voltageV: this.volt.slice(0, n),
      currentMa: this.curr.slice(0, n),
    };
  }

  // ---------------------------------------------------------------------------------------
  // RPC: history queries and settings
  // ---------------------------------------------------------------------------------------

  private async runRpc(id: number, method: RpcMethod, args: unknown[]): Promise<void> {
    try {
      const value = await this.callRpc(method, args);
      this.post({ type: 'rpcResult', id, ok: true, value });
    } catch (e) {
      this.post({
        type: 'rpcResult',
        id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async callRpc(method: RpcMethod, a: unknown[]): Promise<unknown> {
    const s = this.store;
    switch (method) {
      case 'getProfile':
        return s.getProfile();
      case 'saveProfile': {
        const p = withProfileDefaults(a[0] as Partial<DeviceProfile>);
        const problems = validateProfile(p);
        if (problems.length > 0) throw new Error('Invalid profile: ' + problems.join('; '));
        await s.saveProfile(p);
        this.profile = p;
        this.pipe.setProfile(p); // applies from the next sample
        return undefined;
      }
      case 'listSessions':
        return s.listSessions();
      case 'getSessionSeries':
        return s.getSessionSeries(a[0] as string, a[1] as [number, number] | undefined);
      case 'getSessionSteps':
        return s.getSessionSteps(a[0] as string);
      case 'getSessionGaps':
        return s.getSessionGaps(a[0] as string);
      case 'exportCsv':
        await this.flush();
        return s.exportCsv(a[0] as string);
      case 'exportSessionJson':
        await this.flush();
        return s.exportSessionJson(a[0] as string);
      case 'exportStepsCsv':
        await this.flush();
        return s.exportStepsCsv(a[0] as number, a[1] as number);
      case 'getTotals':
        await this.flush();
        return s.getTotals(a[0] as number, a[1] as number);
      case 'recomputeSession': {
        const p = withProfileDefaults(a[1] as Partial<DeviceProfile>);
        const problems = validateProfile(p);
        if (problems.length > 0) throw new Error('Invalid profile: ' + problems.join('; '));
        return s.recomputeSession(a[0] as string, p);
      }
      case 'renameSession':
        return s.renameSession(a[0] as string, a[1] as string);
      case 'deleteSession': {
        if (this.pipe.sessionId === a[0]) throw new Error('Stop the session before deleting it');
        return s.deleteSession(a[0] as string);
      }
      case 'deleteAllData': {
        await this.closeSession();
        await s.deleteAllData();
        this.pipe = this.makePipeline(0, 0);
        this.n = 0;
        return undefined;
      }
      case 'importSessionJson':
        return s.importSessionJson(a[0] as string);
    }
  }
}
