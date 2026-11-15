import type { Store } from '@force/storage';
import type { WorkerLike } from './engine.js';
import { WorkerHost } from './host.js';
import type { HostOptions } from './host.js';
import type { FromWorker, ToWorker } from './messages.js';

/**
 * Runs the worker host on the CALLING thread, behind the same interface as a Web Worker.
 * Used by the mock engine and by tests. Messages keep their order and arrive asynchronously, like
 * a real worker; nothing is actually transferred or cloned.
 */
export type InlineWorker = WorkerLike & {
  /** The host behind it, so tests can call `publish()` and `flush()` themselves. */
  host: WorkerHost;
  /** Resolves when every message posted so far has been handled and the host is idle. */
  idle(): Promise<void>;
};

export function createInlineWorker(store: Store, opts: HostOptions = {}): InlineWorker {
  let alive = true;
  const w: WorkerLike = {
    onmessage: null,
    postMessage: (msg: ToWorker) => {
      chain = chain.then(() => {
        if (alive) host.handle(msg);
      });
    },
    terminate: () => {
      alive = false;
      host.dispose();
    },
  };
  const deliver = (m: FromWorker) => {
    queueMicrotask(() => {
      if (alive) w.onmessage?.({ data: m });
    });
  };
  const host = new WorkerHost(store, deliver, opts);
  // messages posted before the database work in init() finishes wait for it, in order
  let chain: Promise<void> = host.init().catch((e) => {
    deliver({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
  });
  const idle = async () => {
    for (;;) {
      const c = chain;
      await c;
      await host.whenIdle();
      if (c === chain) return;
    }
  };
  return Object.assign(w, { host, idle });
}
