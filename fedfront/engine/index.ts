import { createEngine, createMockEngine } from '@force/worker';
import type { MockEngine } from '@force/worker';
import { DexieSyncStateStore, SyncClient, deviceDatabaseSource, fetchTransport } from '@force/cloud';
import type { DashboardEngine } from '@/contracts';
import { readSyncToken } from '@/lib/sync-token';

/**
 * The single place the UI obtains its engine. All BLE, decoding, calculations, alerts and storage
 * live in @force/worker; the UI only subscribes and renders.
 *
 * - 'device' (default): the real engine. Web Worker + IndexedDB ("force") + Web Bluetooth.
 *   Connect opens the ESP32 over BLE; Start Demo runs the packet simulator, labelled "demo".
 * - 'mock' (NEXT_PUBLIC_ENGINE=mock): the same pipeline fed by the simulator, on a separate
 *   IndexedDB ("force-mock") so simulated data never mixes with recorded hardware sessions.
 *   Starts streaming at once. Used by e2e and visual tests.
 *
 * Cloud sync (optional, device mode only): when NEXT_PUBLIC_CLOUD_SYNC_URL is set, finished
 * real-device sessions and a throttled live status are sent to the local sync agent, which
 * writes Firestore. It only reads the local database and never affects streaming or storage.
 */
export type EngineMode = 'device' | 'mock';

export interface AppEngine {
  engine: DashboardEngine;
  mode: EngineMode;
  /** Mock mode only: schedules a simulated fault so every error state can be shown. */
  injectFault: MockEngine['injectFault'] | null;
  /** Cloud sync client, or null when cloud sync is off (always null in mock mode). */
  sync: SyncClient | null;
  dispose(): void;
}

/** Validated at build/dev start by config/engine-mode.mjs; anything but 'mock' is the real engine. */
export function engineMode(): EngineMode {
  return process.env.NEXT_PUBLIC_ENGINE?.trim() === 'mock' ? 'mock' : 'device';
}

/** Sync agent API base ("/api/sync/v1" or a full URL); null turns cloud sync off. */
export function cloudSyncUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_CLOUD_SYNC_URL?.trim();
  return v ? v : null;
}

function startCloudSync(engine: DashboardEngine): { client: SyncClient; stop(): void } | null {
  const url = cloudSyncUrl();
  if (!url || typeof indexedDB === 'undefined') return null;
  try {
    const state = new DexieSyncStateStore();
    const client = new SyncClient({
      source: deviceDatabaseSource(),
      state,
      transport: fetchTransport(url, { getToken: readSyncToken }),
    });
    const unsubscribe = engine.subscribeSnapshot((s) => client.reportLive(s, engine.getDeviceInfo()));
    const online = () => void client.syncNow();
    window.addEventListener('online', online);
    client.start();
    return {
      client,
      stop: () => {
        unsubscribe();
        window.removeEventListener('online', online);
        void client.stop().finally(() => state.close());
      },
    };
  } catch {
    // cloud sync must never stop the dashboard from working
    return null;
  }
}

export function createAppEngine(mode: EngineMode = engineMode()): AppEngine {
  if (mode === 'mock') {
    const mock = createMockEngine({ autoStart: true });
    return {
      engine: mock,
      mode,
      injectFault: (fault, inMs) => mock.injectFault(fault, inMs),
      sync: null,
      dispose: () => mock.dispose(),
    };
  }
  const engine = createEngine();
  const cloud = startCloudSync(engine);
  return {
    engine,
    mode,
    injectFault: null,
    sync: cloud?.client ?? null,
    dispose: () => {
      cloud?.stop();
      engine.dispose();
    },
  };
}
