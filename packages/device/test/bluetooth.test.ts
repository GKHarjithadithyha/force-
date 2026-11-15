import { describe, expect, it } from 'vitest';
import { DEVICE_NAME_PREFIX, SERVICE_UUID, TELEMETRY_VECTORS } from '@force/protocol';
import {
  BluetoothSource,
  FakeClock,
  RECONNECT_BACKOFF_MS,
  RECONNECT_WINDOW_MS,
} from '../src/index.js';
import { EXPECTED_INFO, FakeBluetooth, FakeDevice, recorder } from './fakes.js';

const PACKET = Uint8Array.from(TELEMETRY_VECTORS[0]!.hex.split(' ').map((b) => parseInt(b, 16)));

function setup() {
  const clock = new FakeClock();
  const device = new FakeDevice(() => clock.now());
  const bt = new FakeBluetooth(device);
  const source = new BluetoothSource(bt, clock);
  const rec = recorder();
  return { clock, device, bt, source, rec };
}

/** Connect and deliver the first packet so the source is streaming. */
async function streaming() {
  const s = setup();
  await s.source.start(s.rec);
  s.device.telemetry.emit(PACKET);
  return s;
}

describe('connection state machine (Architecture section 11)', () => {
  it('1,2,3: idle -> choosing -> connecting -> streaming on the first valid packet', async () => {
    const { source, rec, device, bt } = setup();
    await source.start(rec);
    expect(rec.stateNames()).toEqual(['choosing', 'connecting']);
    expect(device.telemetry.notifying).toBe(true);
    device.telemetry.emit(PACKET);
    expect(rec.stateNames()).toEqual(['choosing', 'connecting', 'streaming']);
    expect(source.currentState).toBe('streaming');
    // the picker is filtered by the FORCE- prefix AND the service
    expect(bt.requests).toEqual([
      { filters: [{ namePrefix: DEVICE_NAME_PREFIX, services: [SERVICE_UUID] }] },
    ]);
  });

  it('reads Device Info and announces the device BEFORE any packet', async () => {
    const { source, rec, device } = setup();
    await source.start(rec);
    device.telemetry.emit(PACKET);
    expect(rec.readyCalls).toEqual([{ deviceId: 'FORCE-A1B2', deviceInfo: EXPECTED_INFO }]);
    expect(rec.log.indexOf('ready')).toBeLessThan(rec.log.indexOf('packet'));
  });

  it('delivers each notification as a COPY with the arrival time', async () => {
    const { source, rec, device, clock } = setup();
    await source.start(rec);
    clock.advance(1234);
    device.telemetry.emit(PACKET);
    expect(rec.packets).toHaveLength(1);
    expect([...new Uint8Array(rec.packets[0]!.buf)]).toEqual([...PACKET]);
    expect(rec.packets[0]!.arrivalMs).toBe(clock.now());
    expect(rec.packets[0]!.buf.byteLength).toBe(15);
  });

  it('4: cancelling the picker goes back to idle with no error', async () => {
    const { source, rec, bt } = setup();
    bt.outcome = { name: 'NotFoundError', message: 'User cancelled the requestDevice() chooser.' };
    await source.start(rec);
    expect(rec.stateNames()).toEqual(['choosing', 'idle']);
    expect(rec.states.every((s) => s.state !== 'error')).toBe(true);
  });

  it('5: connect failure -> error with a plain-language message', async () => {
    const { source, rec, device } = setup();
    device.failConnects = 1;
    await source.start(rec);
    expect(rec.stateNames()).toEqual(['choosing', 'connecting', 'error']);
    expect(rec.states.at(-1)!.detail).toMatch(/Could not connect/);
  });

  it('5: service missing -> error names the cause', async () => {
    const { source, rec, device } = setup();
    device.serviceMissing = true;
    await source.start(rec);
    expect(rec.stateNames().at(-1)).toBe('error');
    expect(rec.states.at(-1)!.detail).toMatch(/does not offer the F\.O\.R\.C\.E service/);
  });

  it('5: permission denied -> error names the cause', async () => {
    const { source, rec, bt } = setup();
    bt.outcome = { name: 'SecurityError', message: 'Permission denied' };
    await source.start(rec);
    expect(rec.stateNames()).toEqual(['choosing', 'error']);
    expect(rec.states.at(-1)!.detail).toMatch(/permission was denied/i);
  });

  it('5: invalid Device Info -> error, and nothing is announced', async () => {
    const { source, rec, device } = setup();
    device.infoText = '{"proto":7}';
    await source.start(rec);
    expect(rec.stateNames().at(-1)).toBe('error');
    expect(rec.states.at(-1)!.detail).toMatch(/Device Info is not valid/);
    expect(rec.readyCalls).toHaveLength(0);
    expect(device.telemetry.notifying).toBe(false);
  });

  it('6: after an error a new start() works again', async () => {
    const { source, rec, device } = setup();
    device.failConnects = 1;
    await source.start(rec);
    expect(source.currentState).toBe('error');
    const rec2 = recorder();
    await source.start(rec2);
    device.telemetry.emit(PACKET);
    expect(rec2.stateNames()).toEqual(['choosing', 'connecting', 'streaming']);
  });

  it('7, 8: no packet for over 1 s -> stale; the next packet -> streaming', async () => {
    const { rec, device, clock } = await streaming();
    clock.advance(900);
    expect(rec.stateNames().at(-1)).toBe('streaming');
    clock.advance(400); // 1300 ms of silence
    expect(rec.stateNames().at(-1)).toBe('stale');
    device.telemetry.emit(PACKET);
    expect(rec.stateNames().slice(-2)).toEqual(['stale', 'streaming']);
  });

  it('9, 10: link lost -> reconnecting; retries 1,2,4,5,5 s; restored -> streaming on first packet', async () => {
    const { rec, device, clock, source } = await streaming();
    const t0 = clock.now();
    device.failConnects = 4;
    device.connectAttempts = [];
    device.dropLink(); // 9
    expect(rec.stateNames().at(-1)).toBe('reconnecting');
    expect(source.currentState).toBe('reconnecting');
    await clock.advanceAsync(30_000);
    // attempts at +1 s, +3 s (1+2), +7 s (+4), +12 s (+5) all fail, +17 s succeeds
    expect(device.connectAttempts.map((t) => (t - t0) / 1000)).toEqual([1, 3, 7, 12, 17]);
    expect(RECONNECT_BACKOFF_MS).toEqual([1000, 2000, 4000, 5000]);
    // restored but no packet yet: still reconnecting
    expect(source.currentState).toBe('reconnecting');
    expect(device.telemetry.notifying).toBe(true);
    device.telemetry.emit(PACKET); // 10
    expect(rec.stateNames().at(-1)).toBe('streaming');
    // retries stop for good once streaming
    await clock.advanceAsync(60_000);
    expect(device.connectAttempts).toHaveLength(5);
  });

  it('reconnect reuses the chosen device and does not re-announce or re-open the picker', async () => {
    const { rec, device, bt, clock } = await streaming();
    device.dropLink();
    await clock.advanceAsync(1000);
    device.telemetry.emit(PACKET);
    expect(bt.requests).toHaveLength(1);
    expect(rec.readyCalls).toHaveLength(1);
    expect(rec.stateNames().filter((s) => s === 'streaming')).toHaveLength(2);
  });

  it('11: 60 s without success -> idle, retries stop', async () => {
    const { rec, device, clock, source } = await streaming();
    device.failConnects = 1000;
    device.connectAttempts = [];
    device.dropLink();
    await clock.advanceAsync(RECONNECT_WINDOW_MS - 1);
    expect(source.currentState).toBe('reconnecting');
    await clock.advanceAsync(1);
    expect(source.currentState).toBe('idle');
    expect(rec.states.at(-1)!.detail).toMatch(/60 seconds/);
    const attempts = device.connectAttempts.length;
    expect(attempts).toBeGreaterThanOrEqual(10);
    await clock.advanceAsync(120_000);
    expect(device.connectAttempts).toHaveLength(attempts);
  });

  it('11: restored link that never delivers a packet also gives up after 60 s', async () => {
    const { rec, device, clock, source } = await streaming();
    device.dropLink();
    await clock.advanceAsync(2000); // reconnected at +1 s, silent
    expect(source.currentState).toBe('reconnecting');
    await clock.advanceAsync(RECONNECT_WINDOW_MS);
    expect(rec.stateNames().at(-1)).toBe('idle');
  });

  it('link lost while stale also reconnects', async () => {
    const { rec, device, clock } = await streaming();
    clock.advance(1500);
    expect(rec.stateNames().at(-1)).toBe('stale');
    device.dropLink();
    expect(rec.stateNames().at(-1)).toBe('reconnecting');
  });

  it('link lost before any data arrived is a connect error, not a reconnect', async () => {
    const { source, rec, device } = setup();
    await source.start(rec);
    device.dropLink();
    expect(rec.stateNames().at(-1)).toBe('error');
    expect(rec.states.at(-1)!.detail).toMatch(/dropped before any data/);
  });

  it('user disconnect: idle, notifications stopped, GATT released, no leaked listeners or timers', async () => {
    const { rec, device, clock, source } = await streaming();
    await source.stop();
    expect(rec.stateNames().at(-1)).toBe('idle');
    expect(device.telemetry.notifying).toBe(false);
    expect(device.gatt.connected).toBe(false);
    expect(device.listenerCount('gattserverdisconnected')).toBe(0);
    expect(device.telemetry.listeners.size).toBe(0);
    expect(clock.pendingTimers).toBe(0);
    const n = rec.states.length;
    device.dropLink(); // late event after stop: ignored
    clock.advance(10_000);
    expect(rec.states).toHaveLength(n);
    await source.stop(); // twice is safe
  });

  it('user disconnect while reconnecting cancels the retries', async () => {
    const { rec, device, clock, source } = await streaming();
    device.failConnects = 1000;
    device.connectAttempts = [];
    device.dropLink();
    await clock.advanceAsync(1500);
    await source.stop();
    const n = device.connectAttempts.length;
    await clock.advanceAsync(120_000);
    expect(device.connectAttempts).toHaveLength(n);
    expect(rec.stateNames().at(-1)).toBe('idle');
    expect(clock.pendingTimers).toBe(0);
  });

  it('passes signal strength through when the browser reports it', async () => {
    const { device, rec, source } = setup();
    await source.start(rec);
    expect(device.watchCalled).toBe(true);
    device.dispatch('advertisementreceived', { rssi: -61 });
    expect(rec.rssi).toEqual([-61]);
  });

  it('unsupported browser: state "unsupported", no picker, nothing else happens', async () => {
    const clock = new FakeClock();
    const source = new BluetoothSource(undefined, clock);
    const rec = recorder();
    expect(source.supported).toBe(false);
    await source.start(rec);
    expect(rec.stateNames()).toEqual(['unsupported']);
    expect(rec.states[0]!.detail).toMatch(/Chrome or Edge/);
  });
});
