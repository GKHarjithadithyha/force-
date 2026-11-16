import {
  COLLECTIONS,
  docIds,
  toDailySummaryDoc,
  toDataGapDoc,
  toDeviceConfigDoc,
  toDeviceDoc,
  toEnergyMinuteDoc,
  toFootstepDoc,
  toLiveStatusDoc,
  toSessionDoc,
} from '@force/cloud';
import type {
  AgentPolicy,
  CommitPayload,
  LivePayload,
  RecordsPayload,
  ResetPayload,
} from '@force/cloud';
import type { DocStore, DocWrite } from './docstore.js';
import { MAX_BATCH_WRITES } from './docstore.js';
import { ValidationError } from './validate.js';

export interface WriterOptions {
  /** Private installation details, written only to deviceConfigs. */
  site: { id: string; name: string } | null;
  /** Upload individual footstep documents (default false). */
  footsteps?: boolean;
  /** Minimum time between live-status writes of one device while its connection state is unchanged. */
  liveIntervalMs?: number;
  /** Minimum time between ANY two live-status writes of one device (also on connection changes). */
  minLiveGapMs?: number;
  now?: () => number;
  log?: (level: 'info' | 'warn', message: string) => void;
}

export interface WriterStats {
  writes: number;
  failures: number;
  skippedFootsteps: number;
  lastWriteAt: number | null;
  lastError: string | null;
  inFlight: number;
}

/** `records` for a session that is already complete in Firestore: the dashboard must reset it first. */
export class ConflictError extends Error {}

const CHILDREN = [COLLECTIONS.footsteps, COLLECTIONS.energyMinutes, COLLECTIONS.dataGaps];

/**
 * Turns validated payloads into Firestore writes. Every document id is stable, every write is a
 * full `set`, so repeating a request after a time-out or a restart produces the same documents.
 *
 * Protection of data already in Firestore:
 * - `records` for a session whose session document exists (complete) is refused (409): records
 *   of a finished session are replaced only through `reset`, never overwritten piecemeal.
 * - `reset` deletes only documents whose `deviceId` matches the session's device (the session id
 *   itself is validated to belong to that device).
 * - `commit` refuses a session whose time range differs from the range its records were sent with.
 */
export class CloudWriter {
  readonly stats: WriterStats = {
    writes: 0,
    failures: 0,
    skippedFootsteps: 0,
    lastWriteAt: null,
    lastError: null,
    inFlight: 0,
  };
  private readonly now: () => number;
  private readonly lastLive = new Map<string, { at: number; connection: string }>();
  /** Time range each in-progress session's records were sent with (cleared on commit). */
  private readonly bounds = new Map<string, { startedAt: number; endedAt: number }>();
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly store: DocStore,
    private readonly opts: WriterOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get policy(): AgentPolicy {
    return {
      footsteps: this.opts.footsteps === true,
      liveIntervalMs: this.opts.liveIntervalMs ?? 30_000,
    };
  }

  private ts = (ms: number) => this.store.timestamp(ms);

  private stamp(data: object): Record<string, unknown> {
    return { ...(data as Record<string, unknown>), syncedAt: this.store.serverTime() };
  }

  /** Mapping errors (bad ids, out-of-range times) are the caller's fault: HTTP 400, not a retry. */
  private build(fn: () => DocWrite[]): DocWrite[] {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ValidationError) throw e;
      throw new ValidationError(e instanceof Error ? e.message : String(e));
    }
  }

  private async run(writes: DocWrite[]): Promise<number> {
    this.stats.inFlight++;
    try {
      for (let i = 0; i < writes.length; i += MAX_BATCH_WRITES) {
        await this.store.commit(writes.slice(i, i + MAX_BATCH_WRITES));
      }
      this.stats.writes += writes.length;
      this.stats.lastWriteAt = this.now();
      this.stats.lastError = null;
      return writes.length;
    } catch (e) {
      this.stats.failures++;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.stats.inFlight--;
      if (this.stats.inFlight === 0) {
        for (const w of this.idleWaiters.splice(0)) w();
      }
    }
  }

  /** Resolves when no write is in flight (used for a clean shutdown). */
  idle(): Promise<void> {
    if (this.stats.inFlight === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  /** Removes a session's uploaded documents before they are replaced (the local data changed). */
  async reset(p: ResetPayload): Promise<number> {
    const sessionDoc = await this.store.get(COLLECTIONS.sessions, docIds.session(p.sessionId));
    if (sessionDoc && sessionDoc.deviceId !== p.deviceId) {
      throw new ValidationError('sessionId: belongs to another device in Firestore');
    }
    let removed = 0;
    for (const col of CHILDREN) {
      for (;;) {
        const docs = await this.store.docsWhere(col, 'sessionId', p.sessionId, MAX_BATCH_WRITES, [
          'deviceId',
        ]);
        const mine = docs.filter((d) => d.data.deviceId === p.deviceId);
        if (mine.length < docs.length) {
          this.opts.log?.(
            'warn',
            `reset ${p.sessionId}: ${docs.length - mine.length} ${col} document(s) of another device left untouched`,
          );
        }
        if (mine.length === 0) break;
        removed += await this.run(mine.map((d) => ({ op: 'delete', collection: col, id: d.id })));
        if (docs.length < MAX_BATCH_WRITES) break;
      }
    }
    if (sessionDoc) {
      removed += await this.run([
        { op: 'delete', collection: COLLECTIONS.sessions, id: docIds.session(p.sessionId) },
      ]);
    }
    this.bounds.delete(p.sessionId);
    this.opts.log?.('info', `reset ${p.sessionId}: removed ${removed} document(s)`);
    return removed;
  }

  async records(p: RecordsPayload): Promise<number> {
    if (await this.store.exists(COLLECTIONS.sessions, docIds.session(p.sessionId))) {
      throw new ConflictError(
        `Session ${p.sessionId} is already complete in Firestore: reset it before sending records`,
      );
    }
    const known = this.bounds.get(p.sessionId);
    if (known && (known.startedAt !== p.bounds.startedAt || known.endedAt !== p.bounds.endedAt)) {
      throw new ValidationError('bounds: differ from earlier records of this session');
    }
    this.bounds.set(p.sessionId, p.bounds);
    const footsteps = this.opts.footsteps === true;
    if (!footsteps) this.stats.skippedFootsteps += p.steps.length;
    const writes = this.build(() => [
      ...(footsteps ? p.steps : []).map((e) => ({
        op: 'set' as const,
        collection: COLLECTIONS.footsteps,
        id: docIds.footstep(e),
        data: this.stamp(toFootstepDoc(p.deviceId, p.sessionId, e, this.ts)),
      })),
      ...p.minutes.map((b) => ({
        op: 'set' as const,
        collection: COLLECTIONS.energyMinutes,
        id: docIds.energyMinute(p.sessionId, b.minute),
        data: this.stamp(toEnergyMinuteDoc(p.deviceId, p.sessionId, b, this.ts)),
      })),
      ...p.gaps.map((g) => ({
        op: 'set' as const,
        collection: COLLECTIONS.dataGaps,
        id: docIds.dataGap(p.sessionId, g.startMs),
        data: this.stamp(toDataGapDoc(p.deviceId, p.sessionId, g, this.ts)),
      })),
    ]);
    if (writes.length === 0) return 0;
    return this.run(writes);
  }

  /** Device (public + private config), daily summaries and the session document, atomically. */
  async commit(p: CommitPayload): Promise<number> {
    const s = p.session;
    const known = this.bounds.get(s.id);
    if (known && (known.startedAt !== s.startedAt || known.endedAt !== s.endedAt)) {
      throw new ValidationError('session: time range differs from the records sent for it');
    }
    const existing = await this.store.get(COLLECTIONS.sessions, docIds.session(s.id));
    if (existing && existing.deviceId !== s.deviceId) {
      throw new ValidationError('session.id: belongs to another device in Firestore');
    }
    const writes: DocWrite[] = [];
    if (p.device) {
      const id = docIds.device(p.device.info.deviceId);
      const isNew = !(await this.store.exists(COLLECTIONS.devices, id));
      const device = p.device;
      writes.push(
        ...this.build(() => [
          {
            op: 'set' as const,
            collection: COLLECTIONS.devices,
            id,
            merge: true,
            data: this.stamp({
              ...toDeviceDoc(device, this.ts),
              ...(isNew ? { createdAt: this.store.serverTime() } : {}),
            }),
          },
          {
            op: 'set' as const,
            collection: COLLECTIONS.deviceConfigs,
            id,
            data: this.stamp(toDeviceConfigDoc(device, this.opts.site)),
          },
        ]),
      );
    }
    writes.push(
      ...this.build(() => [
        ...p.daily.map((d) => ({
          op: 'set' as const,
          collection: COLLECTIONS.dailySummaries,
          id: docIds.dailySummary(d.deviceId, d.date),
          data: this.stamp(toDailySummaryDoc(d, this.ts)),
        })),
        {
          op: 'set' as const,
          collection: COLLECTIONS.sessions,
          id: docIds.session(s.id),
          data: this.stamp(toSessionDoc(p, this.ts, this.opts.footsteps === true)),
        },
      ]),
    );
    const n = await this.run(writes);
    this.bounds.delete(s.id);
    return n;
  }

  /**
   * Latest dashboard state of one device. Repeats of the same connection state are limited to one
   * per live interval; connection changes to one per `minLiveGapMs`. Returns 0 when skipped.
   */
  async live(p: LivePayload): Promise<number> {
    const now = this.now();
    const last = this.lastLive.get(p.deviceId);
    if (last) {
      const gap = now - last.at;
      const same = last.connection === p.snapshot.connection;
      if (gap < (this.opts.minLiveGapMs ?? 2_000)) return 0;
      if (same && gap < (this.opts.liveIntervalMs ?? 30_000) / 2) return 0;
    }
    const writes = this.build(() => [
      {
        op: 'set' as const,
        collection: COLLECTIONS.liveStatus,
        id: docIds.liveStatus(p.deviceId),
        data: this.stamp(toLiveStatusDoc(p, this.ts)),
      },
    ]);
    this.lastLive.set(p.deviceId, { at: now, connection: p.snapshot.connection });
    return this.run(writes);
  }
}
