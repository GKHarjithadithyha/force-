import type { DashboardEngine } from '@force/contracts';
import { DemoSource, realClock } from '@force/device';
import type { Clock } from '@force/device';
import type { Fault, SimConfig } from '@force/simulator';
import { ForceDatabase, Store } from '@force/storage';
import { createEngine } from './engine.js';
import type { EngineHandle } from './engine.js';
import { createInlineWorker } from './inline.js';
import type { HostOptions } from './host.js';

export interface MockOptions {
  /** IndexedDB name. Default 'force-mock' so a mock never touches real recorded sessions. */
  dbName?: string;
  /** Simulator settings (cadence, amplitude, seed, scripted faults...). */
  sim?: Partial<SimConfig>;
  /** Start streaming right away instead of waiting for connect(). */
  autoStart?: boolean;
  clock?: Clock;
  host?: HostOptions;
}

export interface MockEngine extends DashboardEngine {
  dispose(): void;
  /**
   * Schedules a fault in the simulated stream, `inMs` from now, so the frontend can see every
   * error state: 'drop', 'stale', 'duplicate', 'reorder', 'restart', 'clip', 'sensor_fault',
   * 'malformed', 'bad_voltage'.
   */
  injectFault(fault: Omit<Fault, 'atMs'>, inMs?: number): void;
}

/**
 * The whole `DashboardEngine` with no hardware: the real worker pipeline, storage and exports,
 * fed by the packet simulator. connect() starts the simulator instead of opening Bluetooth.
 * Sessions are labelled source "demo" so nothing here can be mistaken for real generation.
 * Runs on the main thread (no Web Worker) and needs IndexedDB, which every browser has.
 */
export function createMockEngine(opts: MockOptions = {}): MockEngine {
  const clock = opts.clock ?? realClock;
  const store = new Store(new ForceDatabase(opts.dbName ?? 'force-mock'));
  let demo: DemoSource | null = null;
  const makeDemo = (o: { cadenceSpm?: number; sampleRateHz?: number }) => {
    demo = new DemoSource({ ...o, sim: opts.sim }, clock);
    return demo;
  };
  const handle: EngineHandle = createEngine({
    clock,
    createWorker: () => createInlineWorker(store, opts.host),
    createDeviceSource: () => makeDemo({}),
    createDemoSource: makeDemo,
  });
  const engine: MockEngine = Object.assign(handle, {
    injectFault(fault: Omit<Fault, 'atMs'>, inMs = 0) {
      if (!demo) throw new Error('Start the mock first (connect() or startDemo()).');
      demo.inject(fault, inMs);
    },
  });
  if (opts.autoStart) void engine.connect();
  return engine;
}
