import type { ConnectionState, DeviceInfo, SourceKind } from '@force/contracts';

/** What a source tells the rest of the app: a packet arrived, the state changed, a device is ready. */
export interface SourceHandlers {
  /**
   * Called ONCE, before any packet: the device (or simulated device) is known. The app uses it to
   * tell the worker a stream begins, so no packet can arrive before the worker is ready for it.
   */
  onReady(info: { deviceId: string; deviceInfo: DeviceInfo | null }): void;
  /** One raw 15-byte notification. Ownership of `buf` passes to the handler (it is transferred). */
  onPacket(buf: ArrayBuffer, arrivalMs: number): void;
  /** Connection state machine (Architecture section 11). `detail` is a plain-language reason. */
  onState(state: ConnectionState, detail?: string): void;
  /** Signal strength when the browser provides it (advertisement events only). */
  onRssi?(dbm: number | null): void;
}

/** Bluetooth, demo and replay all sit behind this one interface (Architecture D9). */
export interface DataSource {
  readonly kind: SourceKind;
  /**
   * Begins streaming. Resolves when the source is running (device connected and subscribed), or
   * when the user cancelled the picker. Problems are reported as state 'error', not thrown.
   */
  start(handlers: SourceHandlers): Promise<void>;
  /** Stops and releases everything. Safe to call twice. */
  stop(): Promise<void>;
}
