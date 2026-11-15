/// <reference lib="webworker" />
// Entry point of the Web Worker. Bundlers load it with:
//   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
// All logic is in WorkerHost; this file only connects it to the worker's message port.
import { Store, openDatabase } from '@force/storage';
import { WorkerHost } from './host.js';
import type { FromWorker, ToWorker } from './messages.js';

const scope = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

// Attach the handler at once: a message that arrives while the database is opening would
// otherwise be dropped. Queue until the host is ready, then replay in order.
let host: WorkerHost | null = null;
const queue: ToWorker[] = [];
scope.onmessage = (e) => {
  if (host) host.handle(e.data);
  else queue.push(e.data);
};

async function main(): Promise<void> {
  try {
    const { db } = await openDatabase('force');
    const h = new WorkerHost(new Store(db), (msg, transfer) =>
      scope.postMessage(msg, transfer ?? []),
    );
    await h.init();
    host = h;
    for (const m of queue.splice(0)) h.handle(m);
  } catch (e) {
    scope.postMessage({ type: 'fatal', message: e instanceof Error ? e.message : String(e) });
  }
}

void main();
