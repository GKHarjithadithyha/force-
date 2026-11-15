import type {
  Alert,
  ChartBatch,
  ConnectionState,
  DashboardEngine,
  DeviceInfo,
  DeviceProfile,
  GapRecord,
  LiveSnapshot,
  RangeTotals,
  SessionSummary,
  StepEvent,
} from '@force/contracts';
import {
  BluetoothSource,
  DemoSource,
  ReplaySource,
  bluetoothSupported,
  realClock,
} from '@force/device';
import type { BluetoothLike, Clock, DataSource, SourceHandlers } from '@force/device';
import type { FromWorker, RpcMethod, RpcMethods, ToWorker } from './messages.js';

/** The part of `Worker` the engine uses; `createInlineWorker` provides the same shape in-process. */
export interface WorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  terminate(): void;
}

export interface EngineDeps {
  /** Creates the worker. Default: the real module worker next to this package. */
  createWorker?: () => WorkerLike;
  /** Default: `navigator.bluetooth` when it exists. Pass `null` to force "unsupported". */
  bluetooth?: BluetoothLike | null;
  clock?: Clock;
  /** Replaces the Bluetooth source (the mock engine uses a demo source here). */
  createDeviceSource?: () => DataSource;
  /** Replaces the demo source (the mock engine keeps a handle on it to inject faults). */
  createDemoSource?: (opts: { cadenceSpm?: number; sampleRateHz?: number }) => DemoSource;
}

export type EngineHandle = DashboardEngine & {
  /** Stops sources, timers and the worker. Not part of the seam; call it on page teardown or in tests. */
  dispose(): void;
};

const UNSUPPORTED_MESSAGE =
  'Web Bluetooth is not available in this browser. Use Chrome or Edge, or try the demo.';

type Listener<T> = (v: T) => void;

class Engine implements EngineHandle {
  private worker: WorkerLike;
  private readonly clock: Clock;
  private readonly bluetooth: BluetoothLike | null;
  private source: DataSource | null = null;
  private connection: ConnectionState;
  private deviceInfo: DeviceInfo | null = null;
  private last: LiveSnapshot | null = null;
  private fatalMessage: string | null = null;

  private readonly snapshotSubs = new Set<Listener<LiveSnapshot>>();
  private readonly chartSubs = new Set<Listener<ChartBatch>>();
  private readonly stepSubs = new Set<Listener<StepEvent>>();
  private readonly gapSubs = new Set<Listener<GapRecord>>();

  private nextRpc = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly deps: EngineDeps) {
    this.clock = deps.clock ?? realClock;
    const bt =
      deps.bluetooth !== undefined
        ? deps.bluetooth
        : typeof navigator !== 'undefined'
          ? ((navigator as unknown as { bluetooth?: unknown }).bluetooth ?? null)
          : null;
    this.bluetooth = bluetoothSupported(bt) ? bt : null;
    this.connection = this.supported() ? 'idle' : 'unsupported';
    this.worker = this.spawn();
    if (this.connection === 'unsupported') this.sendLink('unsupported', UNSUPPORTED_MESSAGE);
  }

  // ---------------------------------------------------------------------------------------
  // Worker plumbing
  // ---------------------------------------------------------------------------------------

  private spawn(): WorkerLike {
    const w = (this.deps.createWorker ?? defaultWorker)();
    w.onmessage = (e) => this.onWorker(e.data);
    return w;
  }

  private onWorker(m: FromWorker): void {
    switch (m.type) {
      case 'snapshot': {
        // The main thread owns the connection state machine, so its value is the truth.
        const s: LiveSnapshot = { ...m.snapshot, connection: this.connection };
        if (this.fatalMessage !== null) {
          const alert: Alert = {
            id: 'source_error',
            kind: 'source_error',
            severity: 'error',
            since: s.t,
            message: this.fatalMessage,
          };
          s.alerts = [...s.alerts.filter((a) => a.id !== 'source_error'), alert];
        }
        this.last = s;
        for (const cb of this.snapshotSubs) cb(s);
        break;
      }
      case 'chart':
        for (const cb of this.chartSubs) cb(m.batch);
        break;
      case 'step':
        for (const cb of this.stepSubs) cb(m.step);
        break;
      case 'gap':
        for (const cb of this.gapSubs) cb(m.gap);
        break;
      case 'rpcResult': {
        const p = this.pending.get(m.id);
        if (!p) break;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.error));
        break;
      }
      case 'fatal':
        void this.recoverWorker(m.message);
        break;
      case 'ready':
        break;
    }
  }

  /** Failure isolation: the worker is replaced, stored history is untouched, the user reconnects. */
  private async recoverWorker(message: string): Promise<void> {
    this.fatalMessage = `The data worker hit an error (${message}). The session was saved and ended; connect again to continue.`;
    const src = this.source;
    this.source = null;
    this.deviceInfo = null;
    this.connection = 'idle';
    try {
      await src?.stop();
    } catch {
      /* already gone */
    }
    const old = this.worker;
    old.onmessage = null;
    old.terminate();
    for (const p of this.pending.values()) p.reject(new Error('The data worker restarted'));
    this.pending.clear();
    this.worker = this.spawn();
  }

  private post(msg: ToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(msg, transfer);
  }

  private sendLink(state: ConnectionState, detail?: string): void {
    this.post({
      type: 'link',
      state,
      ...(detail !== undefined ? { detail } : {}),
      atMs: this.clock.now(),
    });
  }

  private call<M extends RpcMethod>(
    method: M,
    ...args: RpcMethods[M]['args']
  ): Promise<RpcMethods[M]['result']> {
    return new Promise((resolve, reject) => {
      const id = this.nextRpc++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ type: 'rpc', id, method, args });
    });
  }

  // ---------------------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------------------

  private handlersFor(src: DataSource): SourceHandlers {
    const live = () => this.source === src;
    return {
      onReady: (info) => {
        if (!live()) return;
        this.deviceInfo = info.deviceInfo;
        this.fatalMessage = null;
        this.post({
          type: 'start',
          source: src.kind,
          deviceId: info.deviceId,
          deviceInfo: info.deviceInfo,
        });
      },
      onPacket: (buf, arrivalMs) => {
        if (!live()) return;
        this.post({ type: 'packet', buf, arrivalMs }, [buf]); // transferred, not copied
      },
      onState: (state, detail) => {
        if (!live()) return;
        // in a browser without Web Bluetooth, "idle" is really "unsupported": Connect stays disabled
        const shown = state === 'idle' && !this.supported() ? 'unsupported' : state;
        this.connection = shown;
        this.sendLink(shown, detail);
      },
      onRssi: (dbm) => {
        if (live()) this.post({ type: 'rssi', dbm });
      },
    };
  }

  private async begin(src: DataSource): Promise<void> {
    await this.endSource();
    this.source = src;
    await src.start(this.handlersFor(src));
  }

  private async endSource(): Promise<void> {
    const src = this.source;
    if (!src) return;
    try {
      await src.stop(); // reports 'idle' through the handlers
    } finally {
      this.source = null;
      this.deviceInfo = null;
      this.post({ type: 'stop' });
    }
  }

  // ---------------------------------------------------------------------------------------
  // DashboardEngine
  // ---------------------------------------------------------------------------------------

  supported(): boolean {
    return this.bluetooth !== null || this.deps.createDeviceSource !== undefined;
  }

  async connect(): Promise<void> {
    if (!this.supported()) throw new Error(UNSUPPORTED_MESSAGE);
    const src = this.deps.createDeviceSource
      ? this.deps.createDeviceSource()
      : new BluetoothSource(this.bluetooth ?? undefined, this.clock);
    await this.begin(src);
  }

  async disconnect(): Promise<void> {
    await this.endSource();
    this.connection = this.supported() ? 'idle' : 'unsupported';
  }

  startDemo(opts?: { cadenceSpm?: number; sampleRateHz?: number }): void {
    const o = opts ?? {};
    void this.begin(this.deps.createDemoSource?.(o) ?? new DemoSource(o, this.clock));
  }

  async startReplay(file: File): Promise<void> {
    const text = await file.text();
    const src = new ReplaySource(text, {}, this.clock); // throws a plain Error for bad files
    await this.begin(src);
  }

  stop(): void {
    void this.disconnect();
  }

  subscribeSnapshot(cb: (s: LiveSnapshot) => void): () => void {
    this.snapshotSubs.add(cb);
    if (this.last) cb(this.last);
    return () => void this.snapshotSubs.delete(cb);
  }
  subscribeChart(cb: (b: ChartBatch) => void): () => void {
    this.chartSubs.add(cb);
    return () => void this.chartSubs.delete(cb);
  }
  subscribeSteps(cb: (e: StepEvent) => void): () => void {
    this.stepSubs.add(cb);
    return () => void this.stepSubs.delete(cb);
  }
  subscribeGaps(cb: (g: GapRecord) => void): () => void {
    this.gapSubs.add(cb);
    return () => void this.gapSubs.delete(cb);
  }

  getDeviceInfo(): DeviceInfo | null {
    return this.deviceInfo;
  }
  getProfile(): Promise<DeviceProfile> {
    return this.call('getProfile');
  }
  saveProfile(p: DeviceProfile): Promise<void> {
    return this.call('saveProfile', p);
  }
  listSessions(): Promise<SessionSummary[]> {
    return this.call('listSessions');
  }
  getSessionSeries(id: string, rangeMs?: [number, number]): Promise<ChartBatch> {
    return rangeMs ? this.call('getSessionSeries', id, rangeMs) : this.call('getSessionSeries', id);
  }
  exportCsv(id: string): Promise<Blob> {
    return this.call('exportCsv', id);
  }
  exportSessionJson(id: string): Promise<Blob> {
    return this.call('exportSessionJson', id);
  }
  recomputeSession(id: string, profile: DeviceProfile): Promise<SessionSummary> {
    return this.call('recomputeSession', id, profile);
  }
  deleteAllData(): Promise<void> {
    return this.call('deleteAllData');
  }
  getSessionSteps(id: string): Promise<StepEvent[]> {
    return this.call('getSessionSteps', id);
  }
  getSessionGaps(id: string): Promise<GapRecord[]> {
    return this.call('getSessionGaps', id);
  }
  renameSession(id: string, name: string): Promise<void> {
    return this.call('renameSession', id, name);
  }
  deleteSession(id: string): Promise<void> {
    return this.call('deleteSession', id);
  }
  getTotals(fromMs: number, toMs: number): Promise<RangeTotals> {
    return this.call('getTotals', fromMs, toMs);
  }
  exportStepsCsv(fromMs: number, toMs: number): Promise<Blob> {
    return this.call('exportStepsCsv', fromMs, toMs);
  }
  async importSession(file: File): Promise<SessionSummary> {
    const text = await file.text();
    return this.call('importSessionJson', text);
  }

  dispose(): void {
    void this.source?.stop();
    this.source = null;
    this.worker.onmessage = null;
    this.worker.terminate();
    this.snapshotSubs.clear();
    this.chartSubs.clear();
    this.stepSubs.clear();
    this.gapSubs.clear();
  }
}

/** Default worker: the module worker in this package. Bundlers detect this exact pattern. */
function defaultWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** Engine with injectable parts (tests, the mock, and custom hosts). */
export function createEngine(deps: EngineDeps = {}): EngineHandle {
  return new Engine(deps);
}

/** The real engine: Web Worker + IndexedDB + Web Bluetooth. Client-side only ("use client"). */
export function createDashboardEngine(): DashboardEngine {
  return createEngine();
}
