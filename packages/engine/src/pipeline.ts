import type {
  Alert,
  ConnectionState,
  DeviceProfile,
  LiveSnapshot,
  SessionSummary,
  SourceKind,
} from '@force/contracts';
import { decodePacket } from './decoder.js';
import type { RawSample } from './decoder.js';
import { cloneProfile } from './profile.js';
import { SequenceTracker } from './sequence.js';
import { SessionEngine } from './session.js';
import type { GapCause, SessionSink } from './session.js';

export interface PipelineSink extends SessionSink {
  /** A session opened (first valid packet, or after a device restart). */
  onSessionOpened?(summary: SessionSummary): void;
  /** A session closed; the summary is final. */
  onSessionClosed?(summary: SessionSummary): void;
  /** Every ACCEPTED sample (valid, in order). Raw log: never edited afterwards. */
  onRawSample?(sessionId: string, sample: RawSample, epochMs: number): void;
}

export interface PipelineConfig {
  source: SourceKind;
  deviceId: string;
  profile: DeviceProfile;
  /** From Device Info; null until known. */
  deviceSensorLimitMa: number | null;
  /** Energy and steps of earlier real sessions (M6, M15). Pass 0 for demo and replay. */
  priorEnergyWh: number;
  priorSteps: number;
  checkClockDrift: boolean;
}

export type PushResult = 'accepted' | 'restart' | 'malformed' | 'duplicate' | 'late';

const RESTART_NOTICE_MS = 60_000;

/**
 * Decoder -> sequence check -> calculation engine, plus session lifecycle (Architecture
 * sections 7, 11, 12). Pure: no DOM, no storage, no Bluetooth. Time never comes from a clock in
 * here: arrival times and "now" are passed in, so tests are deterministic.
 */
export class Pipeline {
  private profile: DeviceProfile;
  private deviceSensorLimitMa: number | null;
  private priorEnergyWh: number;
  private priorSteps: number;
  private readonly seq = new SequenceTracker();
  private engine: SessionEngine | null = null;
  private closed = false;
  private hint: GapCause | null = null;
  private pendingMalformed = 0;
  private rssi: number | null = null;
  private notices: Alert[] = [];
  private external: Alert[] = [];
  private sessionCounter = 0;

  constructor(
    private readonly cfg: PipelineConfig,
    private readonly sink: PipelineSink = {},
  ) {
    this.profile = cloneProfile(cfg.profile);
    this.deviceSensorLimitMa = cfg.deviceSensorLimitMa;
    this.priorEnergyWh = cfg.priorEnergyWh;
    this.priorSteps = cfg.priorSteps;
  }

  // ---- input -------------------------------------------------------------------------------

  /** One telemetry notification, exactly as received. */
  pushPacket(data: ArrayBuffer | ArrayBufferView, arrivalMs: number): PushResult {
    const decoded = decodePacket(data, arrivalMs);
    if (!decoded.ok) {
      if (this.engine && !this.closed) this.engine.noteDropped('malformed');
      else this.pendingMalformed++;
      return 'malformed';
    }
    const s = decoded.sample;
    const cls = this.seq.classify(s.seq, s.deviceTimeMs);
    switch (cls.kind) {
      case 'duplicate':
      case 'late':
        this.engine?.noteDropped(cls.kind);
        return cls.kind;
      case 'first':
        this.openSession(s);
        this.accept(s, 0, null);
        return 'accepted';
      case 'restart': {
        const old = this.engine;
        const oldId = old?.sessionId ?? null;
        if (old && !this.closed) {
          // The gap belongs to the session that ends here.
          this.sink.onGap?.({
            startMs: old.lastSampleEpochMs,
            endMs: s.arrivalMs,
            cause: 'device_restart',
          });
          this.priorEnergyWh += old.sessionEnergyWh;
          this.priorSteps += old.totalSteps;
          this.closeEngine(old, s.arrivalMs);
        }
        this.hint = null;
        this.openSession(s);
        const newId = this.engine?.sessionId ?? '';
        this.notices = [
          {
            id: 'device_restart',
            kind: 'device_restart',
            severity: 'info',
            since: s.arrivalMs,
            message: oldId
              ? `The device restarted. Session ${oldId} was closed and session ${newId} started.`
              : `The device restarted. Session ${newId} started.`,
          },
        ];
        this.accept(s, 0, null);
        return 'restart';
      }
      case 'ok':
        if (this.closed || !this.engine) {
          // Stream resumed after stop(): a fresh session.
          this.openSession(s);
          this.accept(s, 0, null);
          return 'accepted';
        }
        this.accept(s, cls.lostBefore, this.hint);
        this.hint = null;
        return 'accepted';
    }
  }

  /** The link dropped: the next gap is labelled "link down". */
  notifyLinkDown(): void {
    this.hint = 'link_down';
  }

  /** No packet for over 1 s while the link is open. Does not override "link down". */
  notifyStale(): void {
    if (this.hint === null) this.hint = 'stale';
  }

  setProfile(p: DeviceProfile): void {
    this.profile = cloneProfile(p);
    this.engine?.setProfile(p);
  }

  setDeviceSensorLimit(ma: number | null): void {
    this.deviceSensorLimitMa = ma;
    this.engine?.setDeviceSensorLimit(ma);
  }

  setRssi(dbm: number | null): void {
    this.rssi = dbm;
  }

  /** Alerts that come from outside the engine (storage warnings, source errors). */
  setExternalAlerts(alerts: Alert[]): void {
    this.external = alerts;
  }

  setPriorTotals(energyWh: number, steps: number): void {
    this.priorEnergyWh = energyWh;
    this.priorSteps = steps;
    this.engine?.setPriorTotals(energyWh, steps);
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  /** Closes the open session (stop or disconnect). No-op if none is open. */
  close(endedAtMs?: number): SessionSummary | null {
    const e = this.engine;
    if (!e || this.closed) return null;
    return this.closeEngine(e, endedAtMs ?? e.lastSampleEpochMs);
  }

  /** Forget sequence history so the next packet starts a fresh session (new source). */
  resetStream(): void {
    this.seq.reset();
    this.hint = null;
  }

  get hasOpenSession(): boolean {
    return this.engine !== null && !this.closed;
  }

  get sessionId(): string | null {
    return this.engine && !this.closed ? this.engine.sessionId : null;
  }

  /** Live summary of the open session (status "open"), for the once-a-second flush. */
  openSummary(): SessionSummary | null {
    return this.engine && !this.closed ? this.engine.summary('open', null) : null;
  }

  /** Joules so far in the open or just-closed session (exact). */
  sessionEnergyJ(): number {
    return this.engine ? this.engine.energyJ() : 0;
  }

  peekMinute() {
    return this.engine && !this.closed ? this.engine.peekMinute() : null;
  }

  // ---- output ------------------------------------------------------------------------------

  snapshot(opts: { nowMs: number; connection: ConnectionState }): LiveSnapshot {
    const live = this.engine !== null && !this.closed;
    // With no session yet, a throwaway engine yields zeros plus the prior totals.
    const e = this.engine ?? this.makeEngine('none', 0);
    const expecting =
      live &&
      (opts.connection === 'streaming' ||
        opts.connection === 'stale' ||
        opts.connection === 'reconnecting');
    const alerts: Alert[] = [
      ...e.alerts(opts.nowMs, expecting),
      ...this.notices.filter((n) => opts.nowMs - n.since < RESTART_NOTICE_MS),
      ...this.external,
    ];
    return {
      t: this.engine ? e.lastSampleEpochMs : opts.nowMs,
      lastPacketAt: this.engine && e.lastArrivalEpochMs > 0 ? e.lastArrivalEpochMs : null,
      source: this.cfg.source,
      connection: opts.connection,
      sessionId: live ? e.sessionId : null,
      metrics: e.metrics(this.rssi),
      quality: e.quality(),
      alerts,
    };
  }

  // ---- internals ---------------------------------------------------------------------------

  private makeEngine(id: string, startedAt: number): SessionEngine {
    return new SessionEngine(
      {
        sessionId: id,
        source: this.cfg.source,
        deviceId: this.cfg.deviceId,
        profile: this.profile,
        deviceSensorLimitMa: this.deviceSensorLimitMa,
        priorEnergyWh: this.priorEnergyWh,
        priorSteps: this.priorSteps,
        checkClockDrift: this.cfg.checkClockDrift,
      },
      this.sink,
    );
    void startedAt;
  }

  private openSession(first: RawSample): void {
    this.sessionCounter++;
    const id = `${this.cfg.deviceId}-${first.arrivalMs.toString(36)}${this.sessionCounter > 1 ? '-' + this.sessionCounter : ''}`;
    this.engine = this.makeEngine(id, first.arrivalMs);
    this.closed = false;
    // Malformed packets seen before the session existed belong to it.
    if (this.pendingMalformed > 0) {
      this.engine.noteDropped('malformed', this.pendingMalformed);
      this.pendingMalformed = 0;
    }
  }

  private accept(s: RawSample, lostBefore: number, hint: GapCause | null): void {
    const e = this.engine as SessionEngine;
    const first =
      e.startedAtMs === 0 &&
      e.totalSteps === 0 &&
      e.quality().recordedMs === 0 &&
      !this.openedAnnounced(e);
    e.ingest(s, lostBefore, hint);
    if (first) this.sink.onSessionOpened?.(e.summary('open', null));
    this.sink.onRawSample?.(e.sessionId, s, e.lastSampleEpochMs);
  }

  private announced = new WeakSet<SessionEngine>();
  private openedAnnounced(e: SessionEngine): boolean {
    if (this.announced.has(e)) return true;
    this.announced.add(e);
    return false;
  }

  private closeEngine(e: SessionEngine, endedAt: number): SessionSummary {
    e.finish();
    const summary = e.summary('closed', endedAt);
    this.closed = true;
    this.sink.onSessionClosed?.(summary);
    return summary;
  }
}
