import type {
  ChartBatch,
  DeviceInfo,
  DeviceProfile,
  GapRecord,
  RangeTotals,
  SessionSummary,
  StepEvent,
} from '@force/contracts';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  DEFAULT_PROFILE,
  MEASUREMENT_BOUNDARY,
  Pipeline,
  SHUNT_ASSUMPTION,
  base64ToBytes,
  bytesToBase64,
  decodePacket,
  encodeRawSample,
  parseSessionBackup,
  withProfileDefaults,
} from '@force/engine';
import type { MinuteBucket, PipelineSink, RawSample, SessionBackup } from '@force/engine';
import { FLAG, OFFSET, PACKET_SIZE } from '@force/protocol';
import type { ChunkRow, ConnectionEventRow, GapRow, MinuteRow, SessionRow, StepRow } from './db.js';
import type { ForceDatabase } from './db.js';

export const DEFAULT_PROFILE_ID = 'default';
export const APP_VERSION = '0.1.0';
/** Longer ranges are served from minute buckets, shorter from raw samples (Architecture section 9). */
export const RAW_RANGE_LIMIT_MS = 3_600_000;
const CHUNK_SPAN_MS = 1000;
const CHUNK_CAPACITY = 256;
const MAX_PENDING_SAMPLES = 2_000_000;

export interface QuotaInfo {
  usage: number;
  quota: number;
  ratio: number;
  /** Proposed threshold: warn at 80% (Architecture D6). */
  warn: boolean;
}

export interface StoreOptions {
  /** Defaults to navigator.storage.estimate when available. */
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  now?: () => number;
}

interface OpenChunk {
  sessionId: string;
  startMs: number;
  endMs: number;
  count: number;
  data: Uint8Array;
}

type SessionOp =
  { op: 'put'; row: SessionRow } | { op: 'update'; id: string; fields: Partial<SessionRow> };

interface Batch {
  chunks: ChunkRow[];
  steps: StepRow[];
  gaps: GapRow[];
  minutes: MinuteRow[];
  sessions: SessionOp[];
  events: ConnectionEventRow[];
}

const emptyBatch = (): Batch => ({
  chunks: [],
  steps: [],
  gaps: [],
  minutes: [],
  sessions: [],
  events: [],
});

/**
 * The only writer (the worker owns it) and the query side. Writes are queued by the pipeline
 * sink and flushed in ONE transaction per call (the worker calls it about once a second).
 * Stored raw samples are never edited: a one-second chunk grows while it is open, then is final.
 */
export class Store {
  readonly db: ForceDatabase;
  private readonly estimate: NonNullable<StoreOptions['estimate']>;
  private readonly now: () => number;
  private pending: Batch = emptyBatch();
  private openChunks = new Map<string, OpenChunk>();
  private pendingSamples = 0;
  private lastError_: string | null = null;
  private flushing: Promise<void> | null = null;
  /** Counts transactions, for tests and diagnostics. */
  transactions = 0;

  constructor(db: ForceDatabase, opts: StoreOptions = {}) {
    this.db = db;
    this.now = opts.now ?? Date.now;
    this.estimate =
      opts.estimate ??
      (async () =>
        typeof navigator !== 'undefined' && navigator.storage?.estimate
          ? navigator.storage.estimate()
          : {});
  }

  /** Last write failure, or null. While set, streaming continues in memory and writes retry. */
  get lastError(): string | null {
    return this.lastError_;
  }

  // ===========================================================================================
  // Write path: the pipeline sink
  // ===========================================================================================

  /** Plug into `new Pipeline(cfg, store.sink(extra))`. `extra` receives the same events. */
  sink(extra: PipelineSink = {}): PipelineSink {
    return {
      onChartPoint: (p) => extra.onChartPoint?.(p),
      onSessionOpened: (summary) => {
        this.currentSessionId = summary.id;
        this.pending.sessions.push({
          op: 'put',
          row: {
            ...summary,
            profileId: DEFAULT_PROFILE_ID,
            rawPurgedAt: null,
            firmwareVersion: null,
          },
        });
        extra.onSessionOpened?.(summary);
      },
      onSessionClosed: (summary) => {
        this.sealChunk(summary.id);
        this.pending.sessions.push({
          op: 'update',
          id: summary.id,
          fields: summaryFields(summary),
        });
        if (this.currentSessionId === summary.id) this.currentSessionId = null;
        extra.onSessionClosed?.(summary);
      },
      onRawSample: (sessionId, sample, epochMs) => {
        this.appendSample(sessionId, sample, epochMs);
        extra.onRawSample?.(sessionId, sample, epochMs);
      },
      // Steps, gaps and minute buckets belong to the session open at the moment they are emitted
      // (the pipeline emits a restart gap and the last minute BEFORE it closes the session).
      onStep: (e) => {
        if (this.currentSessionId)
          this.pending.steps.push({ ...e, sessionId: this.currentSessionId });
        extra.onStep?.(e);
      },
      onGap: (g) => {
        if (this.currentSessionId)
          this.pending.gaps.push({ ...g, sessionId: this.currentSessionId });
        extra.onGap?.(g);
      },
      onMinuteClosed: (b) => {
        if (this.currentSessionId)
          this.pending.minutes.push({ ...b, sessionId: this.currentSessionId });
        extra.onMinuteClosed?.(b);
      },
    };
  }

  private currentSessionId: string | null = null;

  private appendSample(sessionId: string, s: RawSample, epochMs: number): void {
    let c = this.openChunks.get(sessionId);
    if (!c || epochMs >= c.startMs + CHUNK_SPAN_MS || c.count >= CHUNK_CAPACITY) {
      if (c) this.pending.chunks.push(this.freeze(c));
      c = {
        sessionId,
        startMs: epochMs,
        endMs: epochMs,
        count: 0,
        data: new Uint8Array(CHUNK_CAPACITY * PACKET_SIZE),
      };
      this.openChunks.set(sessionId, c);
    }
    encodeRawSample(s, c.data, c.count * PACKET_SIZE);
    c.count++;
    c.endMs = epochMs;
    this.pendingSamples++;
  }

  private freeze(c: OpenChunk): ChunkRow {
    return {
      sessionId: c.sessionId,
      startMs: c.startMs,
      endMs: c.endMs,
      count: c.count,
      data: c.data.slice(0, c.count * PACKET_SIZE),
    };
  }

  private sealChunk(sessionId: string): void {
    const c = this.openChunks.get(sessionId);
    if (c) {
      this.pending.chunks.push(this.freeze(c));
      this.openChunks.delete(sessionId);
    }
  }

  /** Records a connection event (Architecture: events store). */
  logEvent(e: Omit<ConnectionEventRow, 'id'>): void {
    this.pending.events.push(e);
  }

  /**
   * One transaction: pending chunks (the open one included), steps, gaps, minute buckets and the
   * session record. On failure nothing is lost: the batch is queued again for the next flush and
   * `lastError` is set (storage full, quota). Never throws.
   */
  flush(open?: { summary: SessionSummary | null; minute: MinuteBucket | null }): Promise<void> {
    // serialise flushes so batches keep their order
    const run = async () => this.flushOnce(open);
    this.flushing = (this.flushing ?? Promise.resolve()).then(run, run);
    return this.flushing;
  }

  private async flushOnce(open?: { summary: SessionSummary | null; minute: MinuteBucket | null }) {
    const batch = this.pending;
    this.pending = emptyBatch();

    // include the chunk(s) still open, and the in-progress session/minute
    const chunks = [...batch.chunks];
    for (const c of this.openChunks.values()) chunks.push(this.freeze(c));
    const sessions = [...batch.sessions];
    const minutes = [...batch.minutes];
    const openId = this.currentSessionId;
    if (open?.summary) {
      sessions.push({ op: 'update', id: open.summary.id, fields: summaryFields(open.summary) });
    }
    if (open?.minute && openId) minutes.push({ ...open.minute, sessionId: openId });

    if (
      chunks.length +
        batch.steps.length +
        batch.gaps.length +
        minutes.length +
        sessions.length +
        batch.events.length ===
      0
    ) {
      return;
    }
    const db = this.db;
    try {
      this.transactions++;
      await db.transaction(
        'rw',
        [db.sessions, db.chunks, db.steps, db.gaps, db.minutes, db.events],
        async () => {
          for (const op of sessions) {
            if (op.op === 'put') await db.sessions.put(op.row);
            else await db.sessions.update(op.id, op.fields);
          }
          if (chunks.length) await db.chunks.bulkPut(chunks);
          if (batch.steps.length) await db.steps.bulkPut(batch.steps);
          if (batch.gaps.length) await db.gaps.bulkPut(batch.gaps);
          if (minutes.length) await db.minutes.bulkPut(minutes);
          if (batch.events.length) await db.events.bulkAdd(batch.events);
        },
      );
      this.lastError_ = null;
    } catch (e) {
      // keep everything for the retry; the still-open chunk is re-frozen next time anyway
      this.pending.chunks.unshift(...batch.chunks);
      this.pending.steps.unshift(...batch.steps);
      this.pending.gaps.unshift(...batch.gaps);
      this.pending.minutes.unshift(...batch.minutes);
      this.pending.sessions.unshift(...batch.sessions);
      this.pending.events.unshift(...batch.events);
      this.lastError_ = e instanceof Error ? e.message : String(e);
      if (this.pendingSamples > MAX_PENDING_SAMPLES) {
        // bounded memory: stop growing the retry queue (oldest data stays, newest is dropped)
        this.pending.chunks.length = Math.min(
          this.pending.chunks.length,
          MAX_PENDING_SAMPLES / CHUNK_CAPACITY,
        );
      }
    }
  }

  // ===========================================================================================
  // Startup
  // ===========================================================================================

  /**
   * Any session still "open" was cut off (tab closed, power lost): mark it interrupted and close
   * it at its last stored sample (Architecture section 9). Returns the recovered sessions.
   */
  async recoverInterrupted(): Promise<SessionSummary[]> {
    const open = await this.db.sessions.where('status').equals('open').toArray();
    const out: SessionSummary[] = [];
    for (const s of open) {
      const last = await this.db.chunks
        .where('[sessionId+startMs]')
        .between([s.id, Dexie_minKey], [s.id, Dexie_maxKey])
        .last();
      const endedAt = last ? last.endMs : s.startedAt;
      await this.db.sessions.update(s.id, { status: 'interrupted', endedAt });
      out.push({ ...stripRow(s), status: 'interrupted', endedAt });
    }
    return out;
  }

  // ===========================================================================================
  // Queries
  // ===========================================================================================

  async listSessions(): Promise<SessionSummary[]> {
    const rows = await this.db.sessions.orderBy('startedAt').reverse().toArray();
    return rows.map(stripRow);
  }

  async getSession(id: string): Promise<SessionRow | undefined> {
    return this.db.sessions.get(id);
  }

  /** Energy (Wh) and steps of finished real-device sessions: the prior totals for M6 and M15. */
  async priorTotals(excludeSessionId?: string): Promise<{ energyWh: number; steps: number }> {
    const rows = await this.db.sessions.where('source').equals('device').toArray();
    let energyWh = 0;
    let steps = 0;
    for (const r of rows) {
      if (r.id === excludeSessionId || r.status === 'open') continue;
      energyWh += r.energyWh;
      steps += r.steps;
    }
    return { energyWh, steps };
  }

  async getSessionSteps(id: string): Promise<StepEvent[]> {
    const rows = await this.db.steps.where('sessionId').equals(id).sortBy('t');
    return rows.map(({ sessionId: _s, ...e }) => e);
  }

  async getSessionGaps(id: string): Promise<GapRecord[]> {
    const rows = await this.db.gaps.where('sessionId').equals(id).sortBy('startMs');
    return rows.map(({ sessionId: _s, ...g }) => g);
  }

  /** Decoded raw samples of a session in time order, each with its epoch time. */
  async readSamples(
    id: string,
    rangeMs?: [number, number],
  ): Promise<Array<{ epochMs: number; sample: RawSample }>> {
    const lo = rangeMs ? rangeMs[0] - CHUNK_SPAN_MS - 1 : Dexie_minKey;
    const hi = rangeMs ? rangeMs[1] : Dexie_maxKey;
    const chunks = await this.db.chunks
      .where('[sessionId+startMs]')
      .between([id, lo], [id, hi], true, true)
      .toArray();
    const out: Array<{ epochMs: number; sample: RawSample }> = [];
    for (const c of chunks) {
      for (const r of unpackChunk(c)) {
        if (rangeMs && (r.epochMs < rangeMs[0] || r.epochMs > rangeMs[1])) continue;
        out.push(r);
      }
    }
    return out;
  }

  /**
   * Chart series. Ranges of an hour or less come from raw samples at full resolution (the
   * frontend reduces to min/max per pixel column so peaks survive); longer ranges come from the
   * minute buckets (average power per minute; voltage and current are not kept per minute, so
   * they are NaN there).
   */
  async getSessionSeries(id: string, rangeMs?: [number, number]): Promise<ChartBatch> {
    const row = await this.db.sessions.get(id);
    if (!row) return emptyBatchSeries();
    const end = row.endedAt ?? this.now();
    const span = rangeMs ? rangeMs[1] - rangeMs[0] : end - row.startedAt;
    if (span > RAW_RANGE_LIMIT_MS || row.rawPurgedAt !== null) {
      const mins = await this.db.minutes.where('sessionId').equals(id).sortBy('minute');
      const sel = rangeMs
        ? mins.filter((m) => (m.minute + 1) * 60_000 > rangeMs[0] && m.minute * 60_000 < rangeMs[1])
        : mins;
      const n = sel.length;
      const b = emptyBatchSeries(n);
      sel.forEach((m, i) => {
        b.times[i] = m.minute * 60_000 + 30_000;
        b.powerW[i] = m.recordedMs > 0 ? m.energyNj2 / 2e9 / (m.recordedMs / 1000) : 0;
        b.voltageV[i] = Number.NaN;
        b.currentMa[i] = Number.NaN;
      });
      return b;
    }
    const samples = (await this.readSamples(id, rangeMs)).filter(
      (r) => (r.sample.flags & FLAG.SENSOR_FAULT) === 0,
    );
    const b = emptyBatchSeries(samples.length);
    samples.forEach((r, i) => {
      b.times[i] = r.epochMs;
      b.powerW[i] = Math.max(0, r.sample.voltageMv * r.sample.currentMa) / 1e6;
      b.voltageV[i] = r.sample.voltageMv / 1000;
      b.currentMa[i] = r.sample.currentMa;
    });
    return b;
  }

  /** Real-device totals over [fromMs, toMs): steps, energy and recorded time (DCR "today"). */
  async getTotals(fromMs: number, toMs: number): Promise<RangeTotals> {
    const sessions = (await this.db.sessions.where('source').equals('device').toArray()).filter(
      (s) => s.startedAt < toMs && (s.endedAt ?? Number.POSITIVE_INFINITY) >= fromMs,
    );
    const ids = new Set(sessions.map((s) => s.id));
    const fromMin = Math.floor(fromMs / 60_000);
    const toMin = Math.ceil(toMs / 60_000);
    const mins = (
      await this.db.minutes.where('minute').between(fromMin, toMin, true, false).toArray()
    ).filter((m) => ids.has(m.sessionId));
    let nj2 = 0;
    let recorded = 0;
    let peakUw = 0;
    for (const m of mins) {
      nj2 += m.energyNj2;
      recorded += m.recordedMs;
      if (m.peakPowerUw > peakUw) peakUw = m.peakPowerUw;
    }
    const steps = (
      await this.db.steps.where('t').between(fromMs, toMs, true, false).toArray()
    ).filter((s) => ids.has(s.sessionId));
    return {
      fromMs,
      toMs,
      steps: steps.length,
      energyWh: nj2 / 2e9 / 3600,
      recordedMs: recorded,
      peakPowerW: peakUw / 1e6,
      sessions: sessions.length,
    };
  }

  // ===========================================================================================
  // Profile, devices, events
  // ===========================================================================================

  async getProfile(id = DEFAULT_PROFILE_ID): Promise<DeviceProfile> {
    const row = await this.db.profiles.get(id);
    // a profile saved by an earlier version lacks newer additive fields: fill them with defaults
    return row ? withProfileDefaults(row.profile) : { ...DEFAULT_PROFILE };
  }

  async saveProfile(profile: DeviceProfile, id = DEFAULT_PROFILE_ID): Promise<void> {
    await this.db.profiles.put({ id, profile, savedAt: this.now() });
  }

  async saveDevice(info: DeviceInfo): Promise<void> {
    await this.db.devices.put({ ...info, lastSeen: this.now() });
  }

  async listEvents(limit = 200): Promise<ConnectionEventRow[]> {
    return this.db.events.orderBy('time').reverse().limit(limit).toArray();
  }

  // ===========================================================================================
  // Session management
  // ===========================================================================================

  async renameSession(id: string, name: string): Promise<void> {
    await this.db.sessions.update(id, { name: name.trim() === '' ? null : name.trim() });
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.chunks, this.db.steps, this.db.gaps, this.db.minutes],
      async () => {
        await this.db.chunks.where('sessionId').equals(id).delete();
        await this.db.steps.where('sessionId').equals(id).delete();
        await this.db.gaps.where('sessionId').equals(id).delete();
        await this.db.minutes.where('sessionId').equals(id).delete();
        await this.db.sessions.delete(id);
      },
    );
  }

  async deleteAllData(): Promise<void> {
    this.pending = emptyBatch();
    this.openChunks.clear();
    this.currentSessionId = null;
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const t of this.db.tables) await t.clear();
    });
  }

  // ===========================================================================================
  // Recompute (reprocess raw samples with a profile)
  // ===========================================================================================

  /**
   * Replays the stored raw samples through a fresh pipeline with `profile` and replaces the
   * DERIVED records (steps, minute buckets, totals). Raw samples and gaps are never touched.
   * With the profile the session was recorded with, the result is identical to live processing.
   */
  async recomputeSession(id: string, profile: DeviceProfile): Promise<SessionSummary> {
    const row = await this.db.sessions.get(id);
    if (!row) throw new Error(`No such session: ${id}`);
    if (row.status === 'open') throw new Error('Cannot recompute a session that is still open');
    if (row.rawPurgedAt !== null)
      throw new Error('Raw samples were removed by retention; cannot recompute');
    const result = await this.reprocess(row, profile);
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.steps, this.db.minutes],
      async () => {
        await this.db.steps.where('sessionId').equals(id).delete();
        await this.db.minutes.where('sessionId').equals(id).delete();
        await this.db.steps.bulkPut(result.steps.map((e) => ({ ...e, sessionId: id })));
        await this.db.minutes.bulkPut(result.minutes.map((m) => ({ ...m, sessionId: id })));
        await this.db.sessions.update(id, {
          energyWh: result.summary.energyWh,
          peakPowerW: result.summary.peakPowerW,
          steps: result.summary.steps,
          recordedMs: result.summary.recordedMs,
          bridgedMs: result.summary.bridgedMs,
          excludedGapMs: result.summary.excludedGapMs,
        });
      },
    );
    return stripRow((await this.db.sessions.get(id)) as SessionRow);
  }

  private async reprocess(
    row: SessionRow,
    profile: DeviceProfile,
    onSample?: (sample: RawSample, epochMs: number, energyJ: number) => void,
  ) {
    const steps: StepEvent[] = [];
    const minutes: MinuteBucket[] = [];
    const holder: { pipe?: Pipeline } = {};
    const pipe = new Pipeline(
      {
        source: row.source,
        deviceId: row.deviceId,
        profile,
        deviceSensorLimitMa: null,
        priorEnergyWh: 0,
        priorSteps: 0,
        checkClockDrift: false,
      },
      {
        onStep: (e) => steps.push(e),
        onMinuteClosed: (m) => minutes.push(m),
        onRawSample: (_id, sample, epoch) =>
          onSample?.(sample, epoch, holder.pipe?.sessionEnergyJ() ?? 0),
      },
    );
    holder.pipe = pipe;
    let first = true;
    const chunks = await this.db.chunks
      .where('[sessionId+startMs]')
      .between([row.id, Dexie_minKey], [row.id, Dexie_maxKey])
      .toArray();
    for (const c of chunks) {
      for (const { epochMs, sample } of unpackChunk(c)) {
        // the first sample anchors the session clock: its arrival time IS the session start
        const arrival = first ? row.startedAt : epochMs;
        first = false;
        pipe.pushPacket(encodeRawSample(sample), arrival);
      }
    }
    const summary = pipe.close(row.endedAt ?? undefined);
    if (!summary) throw new Error('Session has no samples to reprocess');
    return { steps, minutes, summary };
  }

  // ===========================================================================================
  // Export / import
  // ===========================================================================================

  /** Raw samples as CSV: time, voltage, current, power, cumulative energy and step markers (PRD FR-9). */
  async exportCsv(id: string): Promise<Blob> {
    const row = await this.db.sessions.get(id);
    if (!row) throw new Error(`No such session: ${id}`);
    if (row.rawPurgedAt !== null) throw new Error('Raw samples were removed by retention');
    const stepAt = new Map<number, string>();
    for (const s of await this.getSessionSteps(id)) stepAt.set(s.t, s.id);
    const profile = await this.getProfile(row.profileId);
    const lines = [
      'time_utc,device_time_ms,seq,voltage_V,current_mA,power_W,flags,energy_J,step_id',
    ];
    await this.reprocess(row, profile, (s, epoch, energyJ) => {
      const powerW = Math.max(0, s.voltageMv * s.currentMa) / 1e6;
      lines.push(
        [
          new Date(epoch).toISOString(),
          s.deviceTimeMs,
          s.seq,
          (s.voltageMv / 1000).toFixed(3),
          s.currentMa,
          powerW.toFixed(6),
          s.flags,
          energyJ.toFixed(9),
          stepAt.get(epoch) ?? '',
        ].join(','),
      );
    });
    return new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  }

  /** DCR daily report: one row per detected step in [fromMs, toMs), all sessions. */
  async exportStepsCsv(fromMs: number, toMs: number): Promise<Blob> {
    const steps = await this.db.steps.where('t').between(fromMs, toMs, true, false).sortBy('t');
    const sessions = new Map((await this.db.sessions.toArray()).map((s) => [s.id, s]));
    const lines = [
      'timestamp_utc,event_id,session_id,source,device_id,step_number,voltage_V,current_A,power_W,energy_interval_J,power_peak_W,power_avg_W,duration_ms',
    ];
    for (const e of steps) {
      const s = sessions.get(e.sessionId);
      const currentA = e.currentMa / 1000;
      lines.push(
        [
          new Date(e.t).toISOString(),
          e.id,
          e.sessionId,
          s?.source ?? '',
          s?.deviceId ?? '',
          e.stepNumber,
          e.voltageV.toFixed(3),
          currentA.toFixed(4),
          (e.voltageV * currentA).toFixed(4),
          e.energyJ.toFixed(6),
          e.peakW.toFixed(4),
          e.avgW.toFixed(4),
          e.durationMs,
        ].join(','),
      );
    }
    return new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  }

  async exportSessionJson(id: string): Promise<Blob> {
    const row = await this.db.sessions.get(id);
    if (!row) throw new Error(`No such session: ${id}`);
    const chunks = await this.db.chunks
      .where('[sessionId+startMs]')
      .between([id, Dexie_minKey], [id, Dexie_maxKey])
      .toArray();
    const backup: SessionBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      meta: {
        appVersion: APP_VERSION,
        exportedAt: this.now(),
        measurementBoundary: MEASUREMENT_BOUNDARY,
        shuntAssumption: SHUNT_ASSUMPTION,
        firmwareVersion: row.firmwareVersion,
      },
      session: stripRow(row),
      profile: await this.getProfile(row.profileId),
      steps: await this.getSessionSteps(id),
      gaps: await this.getSessionGaps(id),
      chunks: chunks.map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
        count: c.count,
        data: bytesToBase64(c.data),
      })),
    };
    return new Blob([JSON.stringify(backup)], { type: 'application/json' });
  }

  /**
   * Imports a backup as a stored session (never overwrites: a clashing id gets a suffix). Derived
   * records are rebuilt from the raw samples with the profile in the file.
   *
   * Duplicate prevention: a backup of a session that is already stored (same device, same start
   * time, under its own id or an earlier import of it) is refused. Importing it again would count
   * the same energy and steps twice in the daily totals.
   */
  async importSessionJson(text: string): Promise<SessionSummary> {
    const b = parseSessionBackup(text);
    const sameSession = (s: SessionRow): boolean =>
      (s.id === b.session.id || s.id.startsWith(`${b.session.id}-import`)) &&
      s.startedAt === b.session.startedAt &&
      s.deviceId === b.session.deviceId;
    const existing = (await this.db.sessions.toArray()).find(sameSession);
    if (existing) {
      throw new Error(`This backup is already stored (session ${existing.id}).`);
    }
    let id = b.session.id;
    for (let n = 2; await this.db.sessions.get(id); n++) id = `${b.session.id}-import${n}`;
    const row: SessionRow = {
      ...b.session,
      id,
      status: b.session.status === 'open' ? 'interrupted' : b.session.status,
      profileId: DEFAULT_PROFILE_ID,
      rawPurgedAt: null,
      firmwareVersion: b.meta.firmwareVersion,
    };
    await this.db.transaction('rw', [this.db.sessions, this.db.chunks, this.db.gaps], async () => {
      await this.db.sessions.put(row);
      await this.db.chunks.bulkPut(
        b.chunks.map((c) => ({
          sessionId: id,
          startMs: c.startMs,
          endMs: c.endMs,
          count: c.count,
          data: base64ToBytes(c.data),
        })),
      );
      await this.db.gaps.bulkPut(b.gaps.map((g) => ({ ...g, sessionId: id })));
    });
    return this.recomputeSession(id, b.profile);
  }

  // ===========================================================================================
  // Retention and quota
  // ===========================================================================================

  /**
   * Removes raw chunks older than `days` (default policy: 30). Sessions keep their totals, steps,
   * gaps and minute buckets. Offer a CSV/JSON export before calling this.
   */
  async applyRetention(days: number, nowMs = this.now()): Promise<{ sessionsPurged: number }> {
    const cutoff = nowMs - days * 86_400_000;
    const old = (await this.db.sessions.toArray()).filter(
      (s) => s.status !== 'open' && s.rawPurgedAt === null && (s.endedAt ?? s.startedAt) < cutoff,
    );
    for (const s of old) {
      await this.db.chunks.where('sessionId').equals(s.id).delete();
      await this.db.sessions.update(s.id, { rawPurgedAt: nowMs });
    }
    return { sessionsPurged: old.length };
  }

  async checkQuota(warnAt = 0.8): Promise<QuotaInfo> {
    const est = await this.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const ratio = quota > 0 ? usage / quota : 0;
    return { usage, quota, ratio, warn: ratio >= warnAt };
  }

  /** Asks the browser not to evict the database. Returns whether it was granted. */
  async requestPersistence(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    const granted = await navigator.storage.persist();
    await this.db.meta.put({ key: 'persistRequested', value: { at: this.now(), granted } });
    return granted;
  }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

// Dexie key bounds for compound ranges
const Dexie_minKey = -Infinity;
const Dexie_maxKey = Infinity;

function summaryFields(s: SessionSummary): Partial<SessionRow> {
  return {
    status: s.status,
    endedAt: s.endedAt,
    energyWh: s.energyWh,
    peakPowerW: s.peakPowerW,
    steps: s.steps,
    recordedMs: s.recordedMs,
    bridgedMs: s.bridgedMs,
    excludedGapMs: s.excludedGapMs,
  };
}

export function stripRow(r: SessionRow): SessionSummary {
  const { profileId: _p, rawPurgedAt: _r, firmwareVersion: _f, ...summary } = r;
  return summary;
}

function emptyBatchSeries(n = 0): ChartBatch {
  return {
    times: new Float64Array(n),
    powerW: new Float64Array(n),
    voltageV: new Float64Array(n),
    currentMa: new Float64Array(n),
  };
}

/** Decodes a stored chunk back to samples with epoch times (device-time differences, wrap safe). */
export function unpackChunk(c: ChunkRow): Array<{ epochMs: number; sample: RawSample }> {
  const out: Array<{ epochMs: number; sample: RawSample }> = [];
  const view = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  const t0 = view.getUint32(OFFSET.deviceTimeMs, true);
  for (let i = 0; i < c.count; i++) {
    const off = i * PACKET_SIZE;
    const r = decodePacket(c.data.subarray(off, off + PACKET_SIZE), 0);
    if (!r.ok) continue; // cannot happen for rows we wrote; skip rather than invent
    const epochMs = c.startMs + ((r.sample.deviceTimeMs - t0) >>> 0);
    out.push({ epochMs, sample: { ...r.sample, arrivalMs: epochMs } });
  }
  return out;
}
