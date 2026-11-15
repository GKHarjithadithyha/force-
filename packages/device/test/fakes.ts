import { DEVICE_INFO_CHAR_UUID, SERVICE_UUID, TELEMETRY_CHAR_UUID } from '@force/protocol';
import type { ConnectionState, DeviceInfo } from '@force/contracts';
import type {
  BluetoothDeviceLike,
  BluetoothLike,
  CharacteristicLike,
  GattServerLike,
  ServiceLike,
  SourceHandlers,
} from '../src/index.js';

type Listener = (e: Event) => void;

export class FakeCharacteristic implements CharacteristicLike {
  listeners = new Set<Listener>();
  notifying = false;
  constructor(private readonly onRead?: () => DataView) {}
  async readValue(): Promise<DataView> {
    if (!this.onRead) throw new Error('not readable');
    return this.onRead();
  }
  async startNotifications(): Promise<void> {
    this.notifying = true;
  }
  async stopNotifications(): Promise<void> {
    this.notifying = false;
  }
  addEventListener(_t: 'characteristicvaluechanged', l: Listener): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'characteristicvaluechanged', l: Listener): void {
    this.listeners.delete(l);
  }
  /** The unit sends a notification. */
  emit(bytes: Uint8Array): void {
    if (!this.notifying) return;
    const copy = bytes.slice();
    const dv = new DataView(copy.buffer);
    for (const l of [...this.listeners]) l({ target: { value: dv } } as unknown as Event);
  }
}

export const INFO_JSON = '{"proto":1,"id":"FORCE-A1B2","fw":"1.0.0","rateHz":20,"limitMa":3200}';
export const EXPECTED_INFO: DeviceInfo = {
  deviceId: 'FORCE-A1B2',
  name: 'FORCE-A1B2',
  firmwareVersion: '1.0.0',
  sampleRateHz: 20,
  sensorLimitMa: 3200,
};

export class FakeDevice implements BluetoothDeviceLike {
  id = 'dev-1';
  name: string | undefined = 'FORCE-A1B2';
  telemetry = new FakeCharacteristic();
  infoText = INFO_JSON;
  info = new FakeCharacteristic(() => new DataView(new TextEncoder().encode(this.infoText).buffer));
  /** Next N connect() calls fail with this error. */
  failConnects = 0;
  failWith: { name: string; message: string } = {
    name: 'NetworkError',
    message: 'GATT Server is disconnected',
  };
  serviceMissing = false;
  connectAttempts: number[] = [];
  private listeners = new Map<string, Set<Listener>>();
  watchCalled = false;

  constructor(private readonly now: () => number = () => 0) {}

  gatt = {
    connected: false,
    connect: async (): Promise<GattServerLike> => {
      this.connectAttempts.push(this.now());
      if (this.failConnects > 0) {
        this.failConnects--;
        throw Object.assign(new Error(this.failWith.message), { name: this.failWith.name });
      }
      this.gatt.connected = true;
      const service: ServiceLike = {
        getCharacteristic: async (uuid: string) => {
          if (uuid === DEVICE_INFO_CHAR_UUID) return this.info;
          if (uuid === TELEMETRY_CHAR_UUID) return this.telemetry;
          throw Object.assign(new Error('no such characteristic'), { name: 'NotFoundError' });
        },
      };
      return {
        connected: true,
        getPrimaryService: async (uuid: string) => {
          if (this.serviceMissing || uuid !== SERVICE_UUID) {
            throw Object.assign(new Error('Service not found'), { name: 'NotFoundError' });
          }
          return service;
        },
      };
    },
    disconnect: () => {
      this.gatt.connected = false;
    },
  };

  async watchAdvertisements(): Promise<void> {
    this.watchCalled = true;
  }
  addEventListener(type: string, l: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: Listener): void {
    this.listeners.get(type)?.delete(l);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l(Object.assign(new Event(type), extra));
  }
  /** The radio link drops (out of range, unit reset). */
  dropLink(): void {
    this.gatt.connected = false;
    this.dispatch('gattserverdisconnected');
  }
}

export class FakeBluetooth implements BluetoothLike {
  requests: Array<{ filters: Array<{ namePrefix?: string; services?: string[] }> }> = [];
  /** What the picker does: choose the device, or throw this error (NotFoundError = cancelled). */
  outcome: 'pick' | { name: string; message: string } = 'pick';
  constructor(public device: FakeDevice) {}
  async requestDevice(options: {
    filters: Array<{ namePrefix?: string; services?: string[] }>;
  }): Promise<BluetoothDeviceLike> {
    this.requests.push(options);
    if (this.outcome !== 'pick') {
      throw Object.assign(new Error(this.outcome.message), { name: this.outcome.name });
    }
    return this.device;
  }
}

export interface Recorder extends SourceHandlers {
  states: Array<{ state: ConnectionState; detail?: string }>;
  packets: Array<{ buf: ArrayBuffer; arrivalMs: number }>;
  readyCalls: Array<{ deviceId: string; deviceInfo: DeviceInfo | null }>;
  rssi: Array<number | null>;
  /** Interleaved log: "ready", "state:x", "packet" in the order they happened. */
  log: string[];
  stateNames(): ConnectionState[];
}

export function recorder(): Recorder {
  const r: Recorder = {
    states: [],
    packets: [],
    readyCalls: [],
    rssi: [],
    log: [],
    onReady: (info) => {
      r.readyCalls.push(info);
      r.log.push('ready');
    },
    onPacket: (buf, arrivalMs) => {
      r.packets.push({ buf, arrivalMs });
      r.log.push('packet');
    },
    onState: (state, detail) => {
      r.states.push({ state, ...(detail !== undefined ? { detail } : {}) });
      r.log.push(`state:${state}`);
    },
    onRssi: (dbm) => r.rssi.push(dbm),
    stateNames: () => r.states.map((s) => s.state),
  };
  return r;
}
