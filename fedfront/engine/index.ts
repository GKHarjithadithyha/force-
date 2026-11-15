import { createEngine, createMockEngine } from '@force/worker';
import type { MockEngine } from '@force/worker';
import type { DashboardEngine } from '@/contracts';

/**
 * The single place the UI obtains its engine. All BLE, decoding, calculations, alerts and storage
 * live in @force/worker; the UI only subscribes and renders.
 *
 * - 'device' (default): the real engine. Web Worker + IndexedDB ("force") + Web Bluetooth.
 *   Connect opens the ESP32 over BLE; Start Demo runs the packet simulator, labelled "demo".
 * - 'mock' (NEXT_PUBLIC_ENGINE=mock): the same pipeline fed by the simulator, on a separate
 *   IndexedDB ("force-mock") so simulated data never mixes with recorded hardware sessions.
 *   Starts streaming at once. Used by e2e and visual tests.
 */
export type EngineMode = 'device' | 'mock';

export interface AppEngine {
  engine: DashboardEngine;
  mode: EngineMode;
  /** Mock mode only: schedules a simulated fault so every error state can be shown. */
  injectFault: MockEngine['injectFault'] | null;
  dispose(): void;
}

/** Validated at build/dev start by config/engine-mode.mjs; anything but 'mock' is the real engine. */
export function engineMode(): EngineMode {
  return process.env.NEXT_PUBLIC_ENGINE?.trim() === 'mock' ? 'mock' : 'device';
}

export function createAppEngine(mode: EngineMode = engineMode()): AppEngine {
  if (mode === 'mock') {
    const mock = createMockEngine({ autoStart: true });
    return {
      engine: mock,
      mode,
      injectFault: (fault, inMs) => mock.injectFault(fault, inMs),
      dispose: () => mock.dispose(),
    };
  }
  const engine = createEngine();
  return { engine, mode, injectFault: null, dispose: () => engine.dispose() };
}
