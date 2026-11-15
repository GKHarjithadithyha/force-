// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DEVICE_INFO_CHAR_UUID, DEVICE_NAME_PREFIX, SERVICE_UUID, TELEMETRY_CHAR_UUID, packTelemetry } from '@force/protocol';
import { ForceDatabase, Store } from '@force/storage';
import { createEngine, createInlineWorker } from '@force/worker';
import type { EngineHandle } from '@force/worker';
import { CHART_FLUSH_MS, useDashboard } from '@/stores/dashboard';
import { getTodayVsYesterday } from '@/lib/analytics';
import { inputStatus, readingsUsable, sensorStatus } from '@/lib/live';

/**
 * Integration test of the path  BLE -> BluetoothSource -> worker engine -> IndexedDB -> Zustand ->
 * the UI's display rules.
 *
 * SIMULATED TRANSPORT: the Bluetooth radio is replaced by a fake that behaves like the board
 * FORCE-71B6 (same Device Info JSON the firmware sends, packets modelled on the values captured
 * from the real board: 11.576 V, 40 mA). Everything after the radio is the real code. This does
 * NOT prove the browser can reach the physical board; that is the manual or CDP browser test.
 */
const INFO_JSON = '{"proto":1,"id":"FORCE-71B6","fw":"1.0.0","rateHz":20,"limitMa":3200}';

type L = (e: Event) => void;
class Char {
  listeners = new Set<L>();
  notifying = false;
  constructor(private readonly read?: () => DataView) {}
  async readValue() { if (!this.read) throw new Error('not readable'); return this.read(); }
  async startNotifications() { this.notifying = true; }
  async stopNotifications() { this.notifying = false; }
  addEventListener(_t: string, l: L) { this.listeners.add(l); }
  removeEventListener(_t: string, l: L) { this.listeners.delete(l); }
  emit(bytes: Uint8Array) {
    if (!this.notifying) return;
    const dv = new DataView(bytes.slice().buffer);
    for (const l of [...this.listeners]) l({ target: { value: dv } } as unknown as Event);
  }
}

function board(name = 'FORCE-71B6') {
  const telemetry = new Char();
  const info = new Char(() => new DataView(new TextEncoder().encode(INFO_JSON).buffer));
  const requests: Array<{ filters: Array<{ namePrefix?: string; services?: string[] }> }> = [];
  const gattListeners = new Map<string, Set<L>>();
  const device = {
    id: 'ble-885721ad71b6',
    name: name as string | undefined,
    gatt: {
      connected: false,
      connect: async () => {
        device.gatt.connected = true;
        const service = { getCharacteristic: async (uuid: string) => (uuid === DEVICE_INFO_CHAR_UUID ? info : uuid === TELEMETRY_CHAR_UUID ? telemetry : (() => { throw Object.assign(new Error('nope'), { name: 'NotFoundError' }); })()) };
        return { connected: true, getPrimaryService: async (uuid: string) => { if (uuid !== SERVICE_UUID) throw Object.assign(new Error('no service'), { name: 'NotFoundError' }); return service; } };
      },
      disconnect: () => { device.gatt.connected = false; },
    },
    watchAdvertisements: async () => undefined,
    addEventListener: (t: string, l: L) => { if (!gattListeners.has(t)) gattListeners.set(t, new Set()); gattListeners.get(t)!.add(l); },
    removeEventListener: (t: string, l: L) => { gattListeners.get(t)?.delete(l); },
  };
  const bluetooth = { requestDevice: async (o: { filters: Array<{ namePrefix?: string; services?: string[] }> }) => { requests.push(o); return device; } };
  return { bluetooth, telemetry, requests, device };
}

async function until<T>(get: () => T | undefined | null | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = get(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let engine: EngineHandle | null = null;
afterEach(() => { engine?.dispose(); engine = null; useDashboard.getState().clearLive(); });

describe('BLE -> engine -> IndexedDB -> Zustand -> UI rules (simulated transport, board FORCE-71B6)', () => {
  it('connects to whatever FORCE- unit is chosen, reads Device Info, and shows only real packets as device data', async () => {
    const b = board();
    const store = new Store(new ForceDatabase('force'));
    engine = createEngine({ bluetooth: b.bluetooth, createWorker: () => createInlineWorker(store) });
    // the same wiring as components/dashboard.tsx
    const st = useDashboard.getState();
    engine.subscribeSnapshot(st.setSnapshot);
    engine.subscribeChart(st.pushChart);

    // 1. discovery: filtered by prefix and service, never by a fixed device id
    await engine.connect();
    expect(b.requests).toHaveLength(1);
    expect(b.requests[0].filters).toEqual([{ namePrefix: DEVICE_NAME_PREFIX, services: [SERVICE_UUID] }]);
    expect(JSON.stringify(b.requests)).not.toMatch(/E52E|71B6/);

    // 2. Device Info is read from the unit, not configured
    await until(() => engine!.getDeviceInfo());
    expect(engine.getDeviceInfo()).toMatchObject({ deviceId: 'FORCE-71B6', name: 'FORCE-71B6', firmwareVersion: '1.0.0', sampleRateHz: 20, sensorLimitMa: 3200 });
    await until(() => b.telemetry.notifying);

    // 3. 20 Hz telemetry, 11.576 V / 40 mA, input present
    let seq = 0;
    const send = (mv: number, ma: number, flags = 0) => { b.telemetry.emit(packTelemetry({ seq: seq & 0xffff, deviceTimeMs: seq * 50, voltageMv: mv, currentMa: ma, flags })); seq++; };
    const timer = setInterval(() => send(11576, 40), 50);
    const snap = await until(() => { const s = useDashboard.getState().snapshot; return s && s.lastPacketAt !== null && s.metrics.sampleRateHz > 0 && s.connection === 'streaming' ? s : null; }, 10000);
    await sleep(2200);
    clearInterval(timer);
    await sleep(100);
    const s = useDashboard.getState().snapshot!;
    expect(snap.source).toBe('device');
    expect(s.sessionId).not.toBeNull();
    expect(s.lastPacketAt).toBeGreaterThan(Date.now() - 5000);
    expect(s.metrics.voltageV).toBeCloseTo(11.576, 3);
    expect(s.metrics.currentMa).toBe(40);
    expect(s.metrics.powerW).toBeCloseTo(0.463, 3);
    expect(s.metrics.measurementValid && s.metrics.inputPresent).toBe(true);
    expect(readingsUsable(s, s.connection)).toBe(true);
    expect(inputStatus(s).value).toBe('Present');
    expect(sensorStatus(s).value).toBe('Normal');
    expect(s.quality.lostPackets).toBe(0);
    expect(s.quality.droppedPackets).toBe(0);
    // energy comes from the engine's integration of the real samples: about P x t
    const seconds = s.quality.recordedMs / 1000;
    expect(seconds).toBeGreaterThan(1.5);
    expect(s.metrics.sessionEnergyJ).toBeCloseTo(0.463 * seconds, 1);

    // 4. charts hold the received samples (after the 250 ms batch), nothing else
    await sleep(CHART_FLUSH_MS + 50);
    const { power, times } = useDashboard.getState();
    expect(power.length).toBeGreaterThan(30);
    expect(power.length).toBe(times.length);
    expect(power.every((p) => Math.abs(p - 0.463) < 0.002)).toBe(true);

    // 5. the power source disappears (0.02 V): the engine flags it and the UI hides the reading
    const t2 = setInterval(() => send(20, 0), 50);
    const noInput = await until(() => { const x = useDashboard.getState().snapshot; return x && !x.metrics.inputPresent ? x : null; });
    clearInterval(t2);
    expect(noInput.metrics.measurementValid).toBe(true);
    expect(inputStatus(noInput).value).toBe('No input');
    expect(readingsUsable(noInput, noInput.connection)).toBe(false);
    expect(sensorStatus(noInput).value).toBe('Normal');

    // 6. disconnect: the session is stored as a DEVICE session and counts in today's totals
    await engine.disconnect();
    await sleep(300);
    const sessions = await engine.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe('device');
    expect(sessions[0].deviceId).toBe('FORCE-71B6');
    const profile = await engine.getProfile();
    const days = await getTodayVsYesterday(engine, profile);
    expect(days.today.sessions).toBe(1);
    expect(days.today.energyWh).toBeCloseTo(sessions[0].energyWh, 9);
    expect(days.today.energyWh).toBeGreaterThan(0);

    // 7. a demo run afterwards is stored as demo and never reaches the device totals
    engine.startDemo();
    await until(() => { const x = useDashboard.getState().snapshot; return x && x.source === 'demo' && x.lastPacketAt !== null ? x : null; });
    await sleep(1500);
    await engine.disconnect();
    await sleep(300);
    const all = await engine.listSessions();
    expect(all.map((x) => x.source).sort()).toEqual(['demo', 'device']);
    const after = await getTodayVsYesterday(engine, profile);
    expect(after.today.sessions).toBe(1);
    expect(after.today.energyWh).toBeCloseTo(days.today.energyWh, 9);

    // 8. the mock database was never touched
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain('force');
    expect(names).not.toContain('force-mock');
  }, 40_000);
});
