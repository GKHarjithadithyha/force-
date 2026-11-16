/**
 * The small slice of Firestore the agent needs. `AdminDocStore` (admin.ts) implements it with the
 * Firebase Admin SDK; `MemoryDocStore` implements it in memory for tests, so ordinary tests need
 * neither credentials nor the emulator.
 */

export type DocWrite =
  | { op: 'set'; collection: string; id: string; data: Record<string, unknown>; merge?: boolean }
  | { op: 'delete'; collection: string; id: string };

export interface DocStore {
  /** Applies all writes atomically. At most 500 writes (Firestore batch limit). */
  commit(writes: DocWrite[]): Promise<void>;
  /** Documents whose `field` equals `value` (at most `limit`), with only the listed fields. */
  docsWhere(
    collection: string,
    field: string,
    value: string,
    limit: number,
    fields: string[],
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
  /** One document, or null. */
  get(collection: string, id: string): Promise<Record<string, unknown> | null>;
  exists(collection: string, id: string): Promise<boolean>;
  /** Firestore timestamp for an epoch-ms value. */
  timestamp(epochMs: number): unknown;
  /** Server-time sentinel for `syncedAt`. */
  serverTime(): unknown;
  /** A cheap read that proves the credentials and the database work. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export const MAX_BATCH_WRITES = 500;

/** In-memory DocStore. Timestamps are Date objects; server time is the store's clock. */
export class MemoryDocStore implements DocStore {
  readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  commits = 0;
  /** Set to make the next commits fail (simulates an outage). */
  failNext = 0;
  failWith: Error = Object.assign(new Error('UNAVAILABLE: simulated outage'), { code: 14 });

  constructor(private readonly now: () => number = Date.now) {}

  col(name: string): Map<string, Record<string, unknown>> {
    let c = this.collections.get(name);
    if (!c) this.collections.set(name, (c = new Map()));
    return c;
  }

  async commit(writes: DocWrite[]): Promise<void> {
    if (writes.length > MAX_BATCH_WRITES) throw new Error('Batch too large');
    if (this.failNext > 0) {
      this.failNext--;
      throw this.failWith;
    }
    this.commits++;
    for (const w of writes) {
      const c = this.col(w.collection);
      if (w.op === 'delete') c.delete(w.id);
      else c.set(w.id, w.merge ? { ...(c.get(w.id) ?? {}), ...w.data } : { ...w.data });
    }
  }

  async docsWhere(
    collection: string,
    field: string,
    value: string,
    limit: number,
    fields: string[],
  ) {
    return [...this.col(collection).entries()]
      .filter(([, d]) => d[field] === value)
      .slice(0, limit)
      .map(([id, d]) => ({ id, data: Object.fromEntries(fields.map((f) => [f, d[f]])) }));
  }

  async get(collection: string, id: string) {
    const d = this.col(collection).get(id);
    return d ? { ...d } : null;
  }

  async exists(collection: string, id: string) {
    return this.col(collection).has(id);
  }

  timestamp(epochMs: number): unknown {
    return new Date(epochMs);
  }

  serverTime(): unknown {
    return new Date(this.now());
  }

  async ping(): Promise<void> {
    if (this.failNext > 0) throw this.failWith;
  }

  async close(): Promise<void> {}
}
