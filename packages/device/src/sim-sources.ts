import type { ConnectionState, DeviceInfo } from '@force/contracts';
import { backupPackets, parseSessionBackup } from '@force/engine';
import { PacketSimulator } from '@force/simulator';
import type { Fault, SimConfig } from '@force/simulator';
import { realClock } from './clock.js';
import type { Clock } from './clock.js';
import type { DataSource, SourceHandlers } from './types.js';

const TICK_MS = 50;
const STALE_AFTER_MS = 1000;

/**
 * Shared by demo and replay: delivers packets as their time comes due, and runs the same stale
 * rule as the Bluetooth source (no packet for over 1 s -> 'stale', next packet -> 'streaming').
 */
abstract class TimedSource implements DataSource {
  abstract readonly kind: 'demo' | 'replay';
  protected h: SourceHandlers | null = null;
  protected clock: Clock;
  private timer: unknown = null;
  private state: ConnectionState = 'idle';
  private lastPacketAt = 0;
  protected startedAt = 0;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  protected abstract info(): { deviceId: string; deviceInfo: DeviceInfo };
  /** Packets due up to `elapsedMs` since start, as (offset, bytes). */
  protected abstract due(elapsedMs: number): Array<{ offsetMs: number; bytes: Uint8Array }>;
  protected abstract finished(): boolean;

  async start(h: SourceHandlers): Promise<void> {
    this.h = h;
    this.setState('connecting');
    h.onReady(this.info());
    this.startedAt = this.clock.now();
    this.lastPacketAt = this.startedAt;
    this.timer = this.clock.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    this.timer = null;
    if (this.h) this.setState('idle');
    this.h = null;
  }

  private tick(): void {
    const h = this.h;
    if (!h) return;
    const now = this.clock.now();
    for (const p of this.due(now - this.startedAt)) {
      const buf = p.bytes.slice().buffer;
      this.lastPacketAt = this.startedAt + p.offsetMs;
      if (this.state !== 'streaming') this.setState('streaming');
      h.onPacket(buf, this.startedAt + p.offsetMs);
    }
    if (this.finished()) {
      void this.stop();
      return;
    }
    if (this.state === 'streaming' && now - this.lastPacketAt > STALE_AFTER_MS)
      this.setState('stale');
  }

  private setState(s: ConnectionState, detail?: string): void {
    if (s === this.state) return;
    this.state = s;
    this.h?.onState(s, detail);
  }
}

export interface DemoOptions {
  cadenceSpm?: number;
  sampleRateHz?: number;
  /** Full simulator config (seed, amplitude, scripted faults). Overrides the two shortcuts above. */
  sim?: Partial<SimConfig>;
}

/** Simulated footsteps from the packet simulator. Always reported as source "demo". */
export class DemoSource extends TimedSource {
  readonly kind = 'demo' as const;
  private readonly sim: PacketSimulator;

  constructor(opts: DemoOptions = {}, clock: Clock = realClock) {
    super(clock);
    this.sim = new PacketSimulator({
      ...(opts.cadenceSpm !== undefined ? { cadenceSpm: opts.cadenceSpm } : {}),
      ...(opts.sampleRateHz !== undefined ? { sampleRateHz: opts.sampleRateHz } : {}),
      ...opts.sim,
    });
  }

  /** Schedules a fault `inMs` from now (mock engine uses this to show error states). */
  inject(fault: Omit<Fault, 'atMs'>, inMs = 0): void {
    const elapsed = this.clock.now() - this.startedAt;
    this.sim.cfg.faults.push({ ...fault, atMs: elapsed + inMs });
  }

  protected info() {
    return {
      deviceId: 'DEMO',
      deviceInfo: {
        deviceId: 'DEMO',
        name: 'Demo (simulated)',
        firmwareVersion: 'demo',
        sampleRateHz: this.sim.cfg.sampleRateHz,
        sensorLimitMa: this.sim.cfg.limitMa,
      },
    };
  }

  protected due(elapsedMs: number) {
    return this.sim.until(elapsedMs).map((p) => ({ offsetMs: p.arrivalOffsetMs, bytes: p.bytes }));
  }

  protected finished(): boolean {
    return false;
  }
}

/**
 * Replays a session backup file at its original timing (`speed` 1 = real time). Always reported
 * as source "replay". A backup can only supply samples: nothing else in the file is used.
 */
export class ReplaySource extends TimedSource {
  readonly kind = 'replay' as const;
  private readonly packets: Array<{ offsetMs: number; bytes: Uint8Array }>;
  private readonly deviceId: string;
  private readonly firmware: string;
  private readonly rate: number;
  private readonly limit: number;
  private next = 0;
  private readonly speed: number;

  /** Throws an Error with a plain message if the text is not a valid backup. */
  constructor(backupJson: string, opts: { speed?: number } = {}, clock: Clock = realClock) {
    super(clock);
    const backup = parseSessionBackup(backupJson);
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.deviceId = backup.session.deviceId;
    this.firmware = backup.meta.firmwareVersion ?? 'unknown';
    this.limit = backup.profile.sensorLimitOverrideMa ?? 3200;
    const all = [...backupPackets(backup)];
    const t0 = all[0]?.epochMs ?? 0;
    this.packets = all.map((p) => ({ offsetMs: (p.epochMs - t0) / this.speed, bytes: p.bytes }));
    const spanMs = this.packets.length > 1 ? this.packets[this.packets.length - 1]!.offsetMs : 0;
    this.rate =
      spanMs > 0 ? Math.round(((this.packets.length - 1) * 1000) / (spanMs * this.speed)) : 20;
  }

  protected info() {
    return {
      deviceId: this.deviceId,
      deviceInfo: {
        deviceId: this.deviceId,
        name: `Replay of ${this.deviceId}`,
        firmwareVersion: this.firmware,
        sampleRateHz: this.rate,
        sensorLimitMa: this.limit,
      },
    };
  }

  protected due(elapsedMs: number) {
    const out = [];
    while (this.next < this.packets.length && this.packets[this.next]!.offsetMs <= elapsedMs) {
      out.push(this.packets[this.next]!);
      this.next++;
    }
    return out;
  }

  protected finished(): boolean {
    return this.next >= this.packets.length;
  }
}
