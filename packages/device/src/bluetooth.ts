import type { ConnectionState, DeviceInfo } from '@force/contracts';
import {
  DEVICE_INFO_CHAR_UUID,
  DEVICE_NAME_PREFIX,
  SERVICE_UUID,
  TELEMETRY_CHAR_UUID,
  parseDeviceInfo,
} from '@force/protocol';
import { realClock } from './clock.js';
import type { Clock } from './clock.js';
import type { DataSource, SourceHandlers } from './types.js';

// -------------------------------------------------------------------------------------------
// The slice of Web Bluetooth we use. `navigator.bluetooth` satisfies it structurally; tests
// supply a scripted fake. (Web Bluetooth is main-thread only, which is why this source is too.)
// -------------------------------------------------------------------------------------------
export interface CharacteristicLike {
  readValue(): Promise<DataView>;
  startNotifications(): Promise<unknown>;
  stopNotifications?(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', l: (e: Event) => void): void;
  removeEventListener(type: 'characteristicvaluechanged', l: (e: Event) => void): void;
}
export interface ServiceLike {
  getCharacteristic(uuid: string): Promise<CharacteristicLike>;
}
export interface GattServerLike {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<ServiceLike>;
}
export interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<GattServerLike>; disconnect(): void };
  addEventListener(type: string, l: (e: Event) => void): void;
  removeEventListener(type: string, l: (e: Event) => void): void;
  watchAdvertisements?(): Promise<void>;
}
export interface BluetoothLike {
  requestDevice(options: {
    filters: Array<{ namePrefix?: string; services?: string[] }>;
  }): Promise<BluetoothDeviceLike>;
}

// Timing from Architecture sections 6 and 11
export const STALE_AFTER_MS = 1000;
export const RECONNECT_WINDOW_MS = 60_000;
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 5000]; // then 5 s
const STALE_CHECK_MS = 250;

export function bluetoothSupported(bt: unknown): bt is BluetoothLike {
  return typeof bt === 'object' && bt !== null && 'requestDevice' in bt;
}

/** Plain-language message for a Web Bluetooth failure (Architecture section 11, transition 5). */
export function describeBluetoothError(
  e: unknown,
  stage: 'connect' | 'service' | 'info' | 'notify',
): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = (e as { message?: string } | null)?.message ?? '';
  if (name === 'ConnectionDropped') return msg;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Bluetooth permission was denied. Allow Bluetooth for this site and try again.';
  }
  if (name === 'NotFoundError') {
    return stage === 'service'
      ? 'This device does not offer the F.O.R.C.E service. Is it running the F.O.R.C.E firmware?'
      : 'The unit was not found. Check it is powered and in range.';
  }
  if (name === 'NetworkError' || /GATT|connect/i.test(msg)) {
    return 'Could not connect to the unit. Move closer, make sure no other device is connected to it, and try again.';
  }
  if (stage === 'info')
    return `The unit's Device Info could not be read: ${msg || name || 'unknown error'}`;
  return `Bluetooth error: ${msg || name || 'unknown error'}`;
}

/**
 * Web Bluetooth source with the connection state machine of Architecture section 11:
 *
 *  1 idle -> choosing        connect() from a user click opens the picker (filtered to FORCE-)
 *  2 choosing -> connecting  the user picks the unit: GATT connect, Device Info, notifications
 *  3 connecting -> streaming first valid packet
 *  4 choosing -> idle        picker cancelled: no error
 *  5 connecting -> error     unit not found, service missing, permission denied
 *  6 error -> idle           dismissed or retried (a new start() clears it)
 *  7 streaming -> stale      no packet for over 1 s
 *  8 stale -> streaming      a packet arrives
 *  9 link open -> reconnecting   the browser reports the connection lost; retries 1,2,4,5,5.. s
 * 10 reconnecting -> streaming   connection restored and a packet arrives
 * 11 reconnecting -> idle    60 s without success, or the user disconnects
 */
export class BluetoothSource implements DataSource {
  readonly kind = 'device' as const;
  private h: SourceHandlers | null = null;
  private device: BluetoothDeviceLike | null = null;
  private characteristic: CharacteristicLike | null = null;
  private state: ConnectionState = 'idle';
  private stopped = false;
  private lastPacketAt = 0;
  private staleTimer: unknown = null;
  private retryTimer: unknown = null;
  private deadlineTimer: unknown = null;
  private reconnecting = false;
  private ready = false;

  constructor(
    private readonly bt: BluetoothLike | undefined,
    private readonly clock: Clock = realClock,
  ) {}

  get supported(): boolean {
    return bluetoothSupported(this.bt);
  }
  get currentState(): ConnectionState {
    return this.state;
  }

  async start(h: SourceHandlers): Promise<void> {
    this.h = h;
    this.stopped = false;
    if (!bluetoothSupported(this.bt)) {
      this.setState(
        'unsupported',
        'Web Bluetooth is not available in this browser. Use Chrome or Edge.',
      );
      return;
    }
    this.setState('choosing'); // 1
    let device: BluetoothDeviceLike;
    try {
      device = await this.bt.requestDevice({
        filters: [{ namePrefix: DEVICE_NAME_PREFIX, services: [SERVICE_UUID] }],
      });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'NotFoundError') {
        this.setState('idle'); // 4: cancelled, no error shown
      } else {
        this.setState('error', describeBluetoothError(e, 'connect'));
      }
      return;
    }
    if (this.stopped) return;
    this.device = device;
    this.setState('connecting'); // 2
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    device.addEventListener('advertisementreceived', this.onAdvert);
    void device.watchAdvertisements?.().catch(() => undefined); // RSSI is optional

    try {
      await this.attach(true);
    } catch (e) {
      if (this.stopped) return;
      this.fail(e);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    const d = this.device;
    if (d) {
      d.removeEventListener('gattserverdisconnected', this.onDisconnected);
      d.removeEventListener('advertisementreceived', this.onAdvert);
    }
    if (this.characteristic) {
      this.characteristic.removeEventListener('characteristicvaluechanged', this.onValue);
      try {
        await this.characteristic.stopNotifications?.();
      } catch {
        /* link may already be gone */
      }
    }
    try {
      if (d?.gatt?.connected) d.gatt.disconnect();
    } catch {
      /* ignore */
    }
    this.characteristic = null;
    this.device = null;
    this.reconnecting = false;
    if (this.h && this.state !== 'idle') this.setState('idle'); // 11 (user disconnect)
    this.h = null;
  }

  // -----------------------------------------------------------------------------------------

  /** Connects GATT, reads Device Info (first time only), subscribes. Throws on any failure. */
  private async attach(first: boolean): Promise<void> {
    const device = this.device;
    if (!device?.gatt) throw Object.assign(new Error('no GATT'), { name: 'NetworkError' });
    const server = await device.gatt.connect();
    if (this.stopped) return;

    let service: ServiceLike;
    try {
      service = await server.getPrimaryService(SERVICE_UUID);
    } catch (e) {
      throw this.tag(e, 'service');
    }

    if (first) {
      let info: DeviceInfo;
      try {
        const ch = await service.getCharacteristic(DEVICE_INFO_CHAR_UUID);
        const text = new TextDecoder().decode(await ch.readValue());
        const parsed = parseDeviceInfo(text);
        if (!parsed.ok) throw Object.assign(new Error(parsed.error), { name: 'DeviceInfoError' });
        info = {
          deviceId: parsed.info.id,
          name: device.name ?? parsed.info.id,
          firmwareVersion: parsed.info.fw,
          sampleRateHz: parsed.info.rateHz,
          sensorLimitMa: parsed.info.limitMa,
        };
      } catch (e) {
        throw this.tag(e, 'info');
      }
      // Tell the app BEFORE the first packet can arrive.
      this.h?.onReady({ deviceId: info.deviceId, deviceInfo: info });
      this.ready = true;
    }

    try {
      const tel = await service.getCharacteristic(TELEMETRY_CHAR_UUID);
      this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue);
      this.characteristic = tel;
      tel.addEventListener('characteristicvaluechanged', this.onValue);
      this.lastPacketAt = this.clock.now();
      await tel.startNotifications();
    } catch (e) {
      throw this.tag(e, 'notify');
    }
    if (this.staleTimer === null) {
      this.staleTimer = this.clock.setInterval(() => this.checkStale(), STALE_CHECK_MS);
    }
  }

  private stageOf = new WeakMap<object, 'connect' | 'service' | 'info' | 'notify'>();
  private tag(e: unknown, stage: 'connect' | 'service' | 'info' | 'notify'): unknown {
    const err = e instanceof Error ? e : Object.assign(new Error(String(e)), { name: 'Error' });
    this.stageOf.set(err, stage);
    return err;
  }

  private fail(e: unknown): void {
    this.clearTimers();
    const stage = e instanceof Error ? (this.stageOf.get(e) ?? 'connect') : 'connect';
    const detail =
      stage === 'info' && (e as Error).name === 'DeviceInfoError'
        ? `The unit's Device Info is not valid: ${(e as Error).message}`
        : describeBluetoothError(e, stage);
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    this.setState('error', detail); // 5
  }

  private readonly onValue = (e: Event): void => {
    const dv = (e.target as { value?: DataView | null } | null)?.value;
    if (!dv || !this.h) return;
    // copy out of the browser's buffer; the copy is transferred on to the worker
    const buf = dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength) as ArrayBuffer;
    const now = this.clock.now();
    this.lastPacketAt = now;
    if (this.state === 'connecting' || this.state === 'stale' || this.state === 'reconnecting') {
      if (this.state === 'reconnecting') this.endReconnect();
      this.setState('streaming'); // 3, 8, 10
    }
    this.h.onPacket(buf, now);
  };

  private readonly onAdvert = (e: Event): void => {
    const rssi = (e as unknown as { rssi?: number }).rssi;
    if (typeof rssi === 'number') this.h?.onRssi?.(rssi);
  };

  private checkStale(): void {
    if (this.state === 'streaming' && this.clock.now() - this.lastPacketAt > STALE_AFTER_MS) {
      this.setState('stale'); // 7
    }
  }

  // ---- link loss and reconnect --------------------------------------------------------------

  private readonly onDisconnected = (): void => {
    if (this.stopped || !this.h) return;
    if (this.state === 'streaming' || this.state === 'stale') {
      this.startReconnect(); // 9
    } else if (this.state === 'connecting' && !this.reconnecting) {
      this.fail(
        Object.assign(new Error('The connection dropped before any data arrived.'), {
          name: 'ConnectionDropped',
        }),
      );
    }
  };

  private startReconnect(): void {
    this.reconnecting = true;
    this.setState('reconnecting', 'The connection to the unit was lost. Reconnecting...');
    this.deadlineTimer = this.clock.setTimeout(() => this.giveUp(), RECONNECT_WINDOW_MS);
    this.scheduleRetry(0);
  }

  private scheduleRetry(attempt: number): void {
    if (this.stopped || !this.reconnecting) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
    this.retryTimer = this.clock.setTimeout(() => {
      void this.tryReconnect(attempt);
    }, delay);
  }

  private async tryReconnect(attempt: number): Promise<void> {
    if (this.stopped || !this.reconnecting) return;
    try {
      await this.attach(false);
      // restored: stay in 'reconnecting' until a packet arrives (transition 10)
    } catch {
      this.scheduleRetry(attempt + 1);
    }
  }

  private endReconnect(): void {
    this.reconnecting = false;
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    if (this.deadlineTimer !== null) this.clock.clearTimeout(this.deadlineTimer);
    this.retryTimer = null;
    this.deadlineTimer = null;
  }

  private giveUp(): void {
    if (!this.reconnecting) return;
    this.endReconnect();
    this.clearTimers();
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      /* ignore */
    }
    this.setState('idle', 'The unit did not come back within 60 seconds.'); // 11
  }

  private clearTimers(): void {
    for (const k of ['staleTimer'] as const) {
      if (this[k] !== null) this.clock.clearInterval(this[k]);
      this[k] = null;
    }
    this.endReconnect();
  }

  private setState(s: ConnectionState, detail?: string): void {
    if (s === this.state && detail === undefined) return;
    if (s === this.state) return;
    this.state = s;
    this.h?.onState(s, detail);
  }

  /** True once Device Info was read at least once on this source. */
  get hasDeviceInfo(): boolean {
    return this.ready;
  }
}
