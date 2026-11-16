import type { DeviceInfo, GapRecord, LiveSnapshot, RangeTotals, StepEvent } from '@force/contracts';
import type { MinuteBucket } from '@force/engine';
import { currentTimeZone, localDaysSpanned } from './days.js';
import {
  MAX_RECORDS_PER_REQUEST,
  SYNC_PATHS,
  bigintToString,
  dataFingerprint,
  fullFingerprint,
  sumNj2,
} from './model.js';
import type {
  AgentPolicy,
  CommitPayload,
  DailyPayload,
  DevicePayload,
  RecordsPayload,
  SessionRecord,
  SyncPath,
} from './model.js';

/**
 * Browser-side cloud sync. It READS the local database (never writes it) and sends finished
 * real-device sessions to the local sync agent, which writes Firestore.
 *
 * Reliability
 * - What is pending is DERIVED from the local database on every pass: a completed device session
 *   whose fingerprint differs from the last confirmed upload. A restart, a crash or a lost sync
 *   state therefore never loses work; at worst a session is sent again, which is harmless because
 *   every document id is stable (idempotent overwrite).
 * - Progress is saved only AFTER the agent confirms the Firestore write: reset -> records (with a
 *   cursor per record kind) -> commit. The session document is written last, in the commit.
 * - Network or agent failure: exponential backoff with jitter (2 s doubling, 5 min cap).
 *   A request the agent rejects as invalid is parked for an hour, so it cannot loop.
 * - Every pass starts by asking the agent for its policy (this also proves the pairing token).
 *   Individual footsteps are sent only when the agent accepts them; turning them on later
 *   uploads the footsteps of sessions that were synced without them.
 * - Nothing here can throw into the engine: every error ends up in `status()`.
 */

export interface LocalSource {
  /** Real-device sessions that are no longer open (closed or interrupted). */
  completedDeviceSessions(): Promise<SessionRecord[]>;
  sessionSteps(id: string): Promise<StepEvent[]>;
  sessionMinutes(id: string): Promise<MinuteBucket[]>;
  sessionGaps(id: string): Promise<GapRecord[]>;
  device(deviceId: string): Promise<DevicePayload | null>;
  /** The existing daily aggregation (`getTotals`), for one device, plus exact energy and CO2. */
  dailyTotals(
    deviceId: string,
    fromMs: number,
    toMs: number,
  ): Promise<{
    totals: RangeTotals;
    energyNj2: bigint;
    co2AvoidedKg: number;
    emissionFactorKgPerKwh: number;
  }>;
}

export type SyncPhase = 'reset' | 'records' | 'commit' | 'synced';

export interface SessionSyncState {
  sessionId: string;
  deviceId: string;
  dataFingerprint: string;
  fullFingerprint: string;
  phase: SyncPhase;
  /** Records confirmed in Firestore, by kind, in local order. */
  cursor: { steps: number; minutes: number; gaps: number };
  /** Whether individual footsteps were included in the confirmed upload (null: not yet known). */
  footsteps?: boolean | null;
  attempts: number;
  lastError: string | null;
  /** Set when the agent refused the data as invalid: not retried before this time. */
  parkedUntil: number | null;
  syncedAt: number | null;
}

export interface SyncStateStore {
  all(): Promise<SessionSyncState[]>;
  put(s: SessionSyncState): Promise<void>;
}

export interface TransportResult {
  ok: boolean;
  /** HTTP status, 0 for a network failure or time-out. */
  status: number;
  error: string | null;
  /** True for network failures, time-outs, 5xx and 429: worth trying again later. */
  retryable: boolean;
  /** Parsed JSON response body, when there was one. */
  data?: unknown;
}

export type Transport = (path: SyncPath, body: unknown) => Promise<TransportResult>;

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'unpaired' | 'stopped';

export interface SyncStatus {
  state: SyncState;
  pendingSessions: number;
  syncedSessions: number;
  /** Sessions the agent refused (invalid data); see `lastError`. */
  parkedSessions: number;
  lastSuccessAt: number | null;
  lastError: string | null;
  nextRetryAt: number | null;
  /** The agent's policy from the last answer; null until the agent has answered. */
  policy: AgentPolicy | null;
  live: { lastSentAt: number | null; lastError: string | null };
}

export interface SyncClientOptions {
  source: LocalSource;
  state: SyncStateStore;
  transport: Transport;
  now?: () => number;
  random?: () => number;
  timeZone?: () => string;
  /** How often the local database is checked for new work. */
  intervalMs?: number;
  /** Minimum time between two live-status updates while nothing changes (the agent may raise it). */
  liveIntervalMs?: number;
  chunkSize?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Diagnostics only. Never receives credentials. */
  log?: (level: 'info' | 'warn', message: string) => void;
}

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 300_000;
export const PARK_MS = 3_600_000;
export const DEFAULT_LIVE_INTERVAL_MS = 30_000;

export function backoffMs(failures: number, random = Math.random): number {
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(raw * (0.8 + 0.4 * random()));
}

/** Reads `{ policy }` from an agent answer, or null. */
export function policyOf(data: unknown): AgentPolicy | null {
  const p = (data as { policy?: unknown } | null | undefined)?.policy as
    | Partial<AgentPolicy>
    | undefined;
  if (!p || typeof p.footsteps !== 'boolean' || typeof p.liveIntervalMs !== 'number') return null;
  return { footsteps: p.footsteps, liveIntervalMs: p.liveIntervalMs };
}

type Outcome = 'done' | 'retry' | 'parked' | 'again' | 'unpaired';
const SKIP = Number.MAX_SAFE_INTEGER;

export class SyncClient {
  private readonly o: Required<Omit<SyncClientOptions, 'log'>> & Pick<SyncClientOptions, 'log'>;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  /** True between start() and stop(): the timer is scheduled. */
  private started = false;
  /** Set by stop(): work in progress ends at the next confirmed step. */
  private stopped = false;
  private failures = 0;
  private retryAt = 0;
  private listeners = new Set<(s: SyncStatus) => void>();
  private st: SyncStatus = {
    state: 'idle',
    pendingSessions: 0,
    syncedSessions: 0,
    parkedSessions: 0,
    lastSuccessAt: null,
    lastError: null,
    nextRetryAt: null,
    policy: null,
    live: { lastSentAt: null, lastError: null },
  };
  private liveInFlight = false;
  private liveLastConnection: string | null = null;
  private liveLastAttempt = -Infinity;

  constructor(opts: SyncClientOptions) {
    this.o = {
      now: Date.now,
      random: Math.random,
      timeZone: currentTimeZone,
      intervalMs: 15_000,
      liveIntervalMs: DEFAULT_LIVE_INTERVAL_MS,
      chunkSize: MAX_RECORDS_PER_REQUEST,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...opts,
    };
    if (this.o.chunkSize < 1 || this.o.chunkSize > MAX_RECORDS_PER_REQUEST) {
      throw new Error(`chunkSize must be 1..${MAX_RECORDS_PER_REQUEST}`);
    }
  }

  status(): SyncStatus {
    return {
      ...this.st,
      policy: this.st.policy ? { ...this.st.policy } : null,
      live: { ...this.st.live },
    };
  }

  subscribe(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status());
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.update({ state: 'idle' });
    this.schedule(0);
  }

  /** Stops scheduling and waits for the request in flight. Unfinished work resumes next start. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.started = false;
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
    this.update({ state: 'stopped', nextRetryAt: null });
  }

  /** Clears the back-off (for example after a new pairing token) and runs a pass now. */
  retryNow(): Promise<void> {
    this.retryAt = 0;
    this.failures = 0;
    return this.syncNow();
  }

  /** Runs one pass now (passes never overlap). Never rejects. */
  syncNow(): Promise<void> {
    if (!this.running) {
      this.running = this.pass()
        .catch((e) => this.fail(`Sync pass failed: ${message(e)}`))
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  private schedule(ms: number): void {
    if (!this.started) return;
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      void this.syncNow().then(() => {
        const wait = Math.max(this.o.intervalMs, this.retryAt - this.o.now());
        this.schedule(wait);
      });
    }, ms);
  }

  // -------------------------------------------------------------------------------------------
  // Session upload
  // -------------------------------------------------------------------------------------------

  private async pass(): Promise<void> {
    const now = this.o.now();
    if (now < this.retryAt) return;

    // the policy call proves the agent is up and the pairing token is accepted
    const pr = await this.o.transport(SYNC_PATHS.policy, {});
    if (!pr.ok) {
      if (pr.status === 401) this.unpaired(pr.error);
      else this.fail(pr.error ?? `HTTP ${pr.status}`);
      return;
    }
    const policy = policyOf(pr.data);
    if (!policy) {
      this.fail('The sync agent answered without a policy (version mismatch?)');
      return;
    }
    this.update({ policy });

    const sessions = (await this.o.source.completedDeviceSessions())
      .filter((s) => s.source === 'device' && s.status !== 'open')
      .sort((a, b) => a.startedAt - b.startedAt);
    const states = new Map((await this.o.state.all()).map((s) => [s.sessionId, s]));

    const work = sessions.filter((s) => !this.isDone(states.get(s.id), s, policy));
    if (work.length > 0) this.update({ state: 'syncing' });
    for (const s of work) {
      if (this.stopped) break;
      const prev = states.get(s.id);
      if (
        prev?.parkedUntil &&
        now < prev.parkedUntil &&
        prev.fullFingerprint === fullFingerprint(s)
      ) {
        continue;
      }
      let outcome = await this.syncSession(s, prev, policy);
      if (outcome === 'again') {
        // the agent already had this session: replace it once, then move on
        const latest = (await this.o.state.all()).find((x) => x.sessionId === s.id);
        outcome = await this.syncSession(s, latest, policy);
      }
      if (outcome === 'retry' || outcome === 'unpaired' || outcome === 'again') {
        await this.refreshCounts(sessions, policy);
        return;
      }
    }
    this.failures = 0;
    this.retryAt = 0;
    await this.refreshCounts(sessions, policy);
    const parked = this.st.parkedSessions > 0;
    this.update({
      state: this.stopped ? 'stopped' : parked ? 'error' : 'idle',
      nextRetryAt: null,
      ...(parked ? {} : { lastError: null }),
    });
  }

  private isDone(st: SessionSyncState | undefined, s: SessionRecord, policy: AgentPolicy) {
    if (!st || st.phase !== 'synced' || st.fullFingerprint !== fullFingerprint(s)) return false;
    // footsteps were turned on after this session was synced without them
    return !(policy.footsteps && st.footsteps === false);
  }

  private async refreshCounts(sessions: SessionRecord[], policy: AgentPolicy): Promise<void> {
    const states = new Map((await this.o.state.all()).map((s) => [s.sessionId, s]));
    let synced = 0;
    let parked = 0;
    let pending = 0;
    const now = this.o.now();
    for (const s of sessions) {
      const st = states.get(s.id);
      if (this.isDone(st, s, policy)) synced++;
      else if (st?.parkedUntil && now < st.parkedUntil) parked++;
      else pending++;
    }
    this.update({ syncedSessions: synced, parkedSessions: parked, pendingSessions: pending });
  }

  private async syncSession(
    s: SessionRecord,
    prev: SessionSyncState | undefined,
    policy: AgentPolicy,
  ): Promise<Outcome> {
    const dataFp = dataFingerprint(s);
    const fullFp = fullFingerprint(s);
    let st: SessionSyncState;
    if (!prev) {
      st = fresh(s, dataFp, fullFp, 'records');
    } else if (prev.dataFingerprint !== dataFp) {
      // the stored data changed (recompute, or the session was still growing): replace it
      st = fresh(s, dataFp, fullFp, 'reset');
    } else if (prev.phase === 'synced' && policy.footsteps && prev.footsteps === false) {
      // footsteps were enabled: upload only the footsteps, then rewrite the session document
      st = {
        ...prev,
        fullFingerprint: fullFp,
        phase: 'records',
        cursor: { steps: 0, minutes: SKIP, gaps: SKIP },
      };
    } else if (prev.fullFingerprint !== fullFp) {
      // only the name changed: rewrite the session document
      st = {
        ...prev,
        fullFingerprint: fullFp,
        phase: prev.phase === 'synced' ? 'commit' : prev.phase,
      };
    } else {
      st = { ...prev };
    }
    st.parkedUntil = null;
    await this.o.state.put(st);

    if (st.phase === 'reset') {
      const r = await this.o.transport(SYNC_PATHS.reset, { deviceId: s.deviceId, sessionId: s.id });
      if (!r.ok) return this.onFailure(st, r);
      st = { ...st, phase: 'records', cursor: { steps: 0, minutes: 0, gaps: 0 } };
      await this.o.state.put(st);
    }

    if (st.phase === 'records') {
      const [steps, minutes, gaps] = await Promise.all([
        policy.footsteps ? this.o.source.sessionSteps(s.id) : Promise.resolve([]),
        this.o.source.sessionMinutes(s.id),
        this.o.source.sessionGaps(s.id),
      ]);
      const kinds = [
        ['steps', steps],
        ['minutes', minutes],
        ['gaps', gaps],
      ] as const;
      const bounds = { startedAt: s.startedAt, endedAt: s.endedAt ?? s.startedAt };
      for (const [kind, list] of kinds) {
        while (st.cursor[kind] < list.length) {
          if (this.stopped) return 'retry';
          const from = st.cursor[kind];
          const part = list.slice(from, from + this.o.chunkSize);
          const body: RecordsPayload = {
            deviceId: s.deviceId,
            sessionId: s.id,
            bounds,
            steps: kind === 'steps' ? (part as StepEvent[]) : [],
            minutes: kind === 'minutes' ? (part as MinuteBucket[]) : [],
            gaps: kind === 'gaps' ? (part as GapRecord[]) : [],
          };
          const r = await this.o.transport(SYNC_PATHS.records, body);
          if (!r.ok) {
            if (r.status === 409) {
              // already in Firestore (for example a lost local sync state): replace it
              await this.o.state.put({ ...st, phase: 'reset' });
              return 'again';
            }
            return this.onFailure(st, r);
          }
          st = { ...st, cursor: { ...st.cursor, [kind]: from + part.length } };
          await this.o.state.put(st);
        }
      }
      st = { ...st, phase: 'commit', footsteps: policy.footsteps };
      await this.o.state.put(st);
    }

    if (st.phase === 'commit') {
      const body = await this.commitPayload(s);
      const r = await this.o.transport(SYNC_PATHS.commit, body);
      if (!r.ok) return this.onFailure(st, r);
      const at = this.o.now();
      const confirmed = policyOf(r.data)?.footsteps ?? policy.footsteps;
      st = {
        ...st,
        phase: 'synced',
        attempts: 0,
        lastError: null,
        syncedAt: at,
        footsteps: (st.footsteps ?? confirmed) && confirmed,
      };
      await this.o.state.put(st);
      this.update({ lastSuccessAt: at });
      this.o.log?.('info', `Session ${s.id} synced`);
    }
    return 'done';
  }

  private async commitPayload(s: SessionRecord): Promise<CommitPayload> {
    const [steps, minutes, gaps, device] = await Promise.all([
      this.o.source.sessionSteps(s.id),
      this.o.source.sessionMinutes(s.id),
      this.o.source.sessionGaps(s.id),
      this.o.source.device(s.deviceId),
    ]);
    const tz = this.o.timeZone();
    const computedAtMs = this.o.now();
    const daily: DailyPayload[] = [];
    for (const day of localDaysSpanned(s.startedAt, s.endedAt ?? s.startedAt)) {
      const d = await this.o.source.dailyTotals(s.deviceId, day.startMs, day.endMs);
      daily.push({
        deviceId: s.deviceId,
        date: day.date,
        timeZone: tz,
        dayStartMs: day.startMs,
        dayEndMs: day.endMs,
        totals: d.totals,
        energyNj2: bigintToString(d.energyNj2),
        co2AvoidedKg: d.co2AvoidedKg,
        emissionFactorKgPerKwh: d.emissionFactorKgPerKwh,
        computedAtMs,
      });
    }
    return {
      session: s,
      energyNj2: bigintToString(sumNj2(minutes.map((m) => m.energyNj2))),
      counts: { steps: steps.length, minutes: minutes.length, gaps: gaps.length },
      device,
      daily,
    };
  }

  private async onFailure(
    st: SessionSyncState,
    r: { error: string | null; retryable: boolean; status: number },
  ): Promise<Outcome> {
    const err = r.error ?? `HTTP ${r.status}`;
    if (r.status === 401) {
      this.unpaired(err);
      return 'unpaired';
    }
    if (r.retryable) {
      await this.o.state.put({ ...st, attempts: st.attempts + 1, lastError: err });
      this.fail(err);
      return 'retry';
    }
    await this.o.state.put({
      ...st,
      attempts: st.attempts + 1,
      lastError: err,
      parkedUntil: this.o.now() + PARK_MS,
    });
    this.o.log?.('warn', `Session ${st.sessionId} refused by the sync agent: ${err}`);
    this.update({ lastError: `Session ${st.sessionId}: ${err}` });
    return 'parked';
  }

  private unpaired(err: string | null): void {
    // checked again at the normal interval, or at once by retryNow() after pairing
    this.retryAt = this.o.now() + this.o.intervalMs;
    this.update({
      state: 'unpaired',
      lastError: err ?? 'Not paired with the sync agent: enter the sync token',
      nextRetryAt: null,
    });
  }

  private fail(err: string): void {
    this.failures++;
    const wait = backoffMs(this.failures, this.o.random);
    this.retryAt = this.o.now() + wait;
    this.o.log?.('warn', `Cloud sync failed (${err}); retry in ${Math.round(wait / 1000)} s`);
    this.update({ state: 'offline', lastError: err, nextRetryAt: this.retryAt });
  }

  // -------------------------------------------------------------------------------------------
  // Live status: latest-value only, throttled, never queued
  // -------------------------------------------------------------------------------------------

  /**
   * Called with every engine snapshot. Sends at most one update per live interval (30 s by
   * default, or the agent's policy if longer), plus one immediately when the connection state
   * changes. Only real-device snapshots are sent.
   */
  reportLive(snapshot: LiveSnapshot, info: DeviceInfo | null): void {
    if (this.stopped || !info || snapshot.source !== 'device' || this.liveInFlight) return;
    const now = this.o.now();
    const interval = Math.max(this.o.liveIntervalMs, this.st.policy?.liveIntervalMs ?? 0);
    const changed = snapshot.connection !== this.liveLastConnection;
    if (!changed && now - this.liveLastAttempt < interval) return;
    this.liveInFlight = true;
    this.liveLastAttempt = now;
    const connection = snapshot.connection;
    void this.o
      .transport(SYNC_PATHS.live, { deviceId: info.deviceId, snapshot })
      .then((r) => {
        if (r.ok) {
          this.liveLastConnection = connection;
          this.update({ live: { lastSentAt: this.o.now(), lastError: null } });
        } else {
          this.update({ live: { ...this.st.live, lastError: r.error ?? `HTTP ${r.status}` } });
        }
      })
      .catch((e) => this.update({ live: { ...this.st.live, lastError: message(e) } }))
      .finally(() => {
        this.liveInFlight = false;
      });
  }

  private update(p: Partial<SyncStatus>): void {
    this.st = { ...this.st, ...p };
    const snap = this.status();
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch {
        /* a listener must not break sync */
      }
    }
  }
}

function fresh(
  s: SessionRecord,
  dataFp: string,
  fullFp: string,
  phase: SyncPhase,
): SessionSyncState {
  return {
    sessionId: s.id,
    deviceId: s.deviceId,
    dataFingerprint: dataFp,
    fullFingerprint: fullFp,
    phase,
    cursor: { steps: 0, minutes: 0, gaps: 0 },
    footsteps: null,
    attempts: 0,
    lastError: null,
    parkedUntil: null,
    syncedAt: null,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** In-memory state store, for tests and for running without IndexedDB. */
export class MemorySyncStateStore implements SyncStateStore {
  readonly rows = new Map<string, SessionSyncState>();
  async all(): Promise<SessionSyncState[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async put(s: SessionSyncState): Promise<void> {
    this.rows.set(s.sessionId, structuredClone(s));
  }
}

/**
 * POSTs JSON to the local sync agent. `baseUrl` is e.g. "/api/sync/v1" or a full URL.
 * `getToken` returns the pairing token (sent as `Authorization: Bearer`), or null if not paired.
 */
export function fetchTransport(
  baseUrl: string,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch; getToken?: () => string | null } = {},
): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  const fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (path, body) => {
    const token = opts.getToken?.() ?? null;
    if (!token) {
      return { ok: false, status: 401, error: 'Not paired: enter the sync token', retryable: false };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: ctrl.signal,
      });
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = undefined;
      }
      if (res.ok) return { ok: true, status: res.status, error: null, retryable: false, data };
      const j = data as { error?: unknown } | undefined;
      const error = typeof j?.error === 'string' ? j.error : `HTTP ${res.status}`;
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      return { ok: false, status: res.status, error, retryable, data };
    } catch (e) {
      const error = ctrl.signal.aborted
        ? 'Sync agent did not answer in time'
        : 'Sync agent unreachable';
      return { ok: false, status: 0, error: `${error} (${message(e)})`, retryable: true };
    } finally {
      clearTimeout(timer);
    }
  };
}
