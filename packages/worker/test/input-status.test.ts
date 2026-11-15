import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { DeviceInfo, LiveSnapshot } from '@force/contracts';
import { FLAG, packTelemetry } from '@force/protocol';
import { DEFAULT_PROFILE } from '@force/engine';
import { ForceDatabase, Store } from '@force/storage';
import { WorkerHost } from '../src/host.js';
import type { FromWorker } from '../src/messages.js';

const ANCHOR = 1_700_000_000_000;
let n = 0;
const INFO: DeviceInfo = {
  deviceId: 'FORCE-IN',
  name: 'FORCE-IN',
  firmwareVersion: '1.0.0',
  sampleRateHz: 20,
  sensorLimitMa: 3200,
};

/** Polls (real time) until an RPC answer arrives: database work needs real macrotasks. */
async function rpcResult(out: FromWorker[], id: number) {
  for (let i = 0; i < 400; i++) {
    const r = out.find((m) => m.type === 'rpcResult' && m.id === id);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('rpc timed out');
}

async function started() {
  const store = new Store(new ForceDatabase(`input-${n++}`));
  const out: FromWorker[] = [];
  const host = new WorkerHost(store, (m) => out.push(m), {
    now: () => ANCHOR + 5000,
    autoTimers: false,
  });
  await host.init();
  host.handle({ type: 'start', source: 'device', deviceId: INFO.deviceId, deviceInfo: INFO });
  await host.whenIdle();
  host.handle({ type: 'link', state: 'streaming', atMs: ANCHOR });
  let seq = 0;
  const send = (t: number, mv: number, ma: number, flags = 0) =>
    host.handle({
      type: 'packet',
      buf: packTelemetry({ seq: seq++, deviceTimeMs: t, voltageMv: mv, currentMa: ma, flags })
        .buffer as ArrayBuffer,
      arrivalMs: ANCHOR + t,
    });
  const snap = (): LiveSnapshot => host.snapshot();
  return { host, send, snap, store, out };
}

describe('what the dashboard sees for each electrical situation', () => {
  it('zero volts and zero current: valid reading, no input alert, no energy, no generation', async () => {
    const { send, snap } = await started();
    for (let i = 0; i < 40; i++) send(i * 50, 0, 0);
    const s = snap();
    expect(s.metrics.measurementValid).toBe(true);
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.alerts.map((a) => a.kind)).toContain('no_input');
    expect(s.metrics.sessionEnergyJ).toBe(0);
    expect(s.metrics.generating).toBe(false);
  });

  it('0.024 V is not a normal active source', async () => {
    const { send, snap } = await started();
    for (let i = 0; i < 40; i++) send(i * 50, 24, -1);
    const s = snap();
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.alerts.find((a) => a.kind === 'no_input')?.message).toContain('No power input');
  });

  it('zero current at a healthy 12.3 V: input present, nothing generated', async () => {
    const { send, snap } = await started();
    for (let i = 0; i < 40; i++) send(i * 50, 12_300, 0);
    const s = snap();
    expect(s.metrics.inputPresent).toBe(true);
    expect(s.alerts.map((a) => a.kind)).not.toContain('no_input');
    expect(s.metrics.powerW).toBe(0);
  });

  it('invalid samples and a disconnected sensor: flagged, never shown as data, no energy', async () => {
    const { send, snap } = await started();
    for (let i = 0; i < 10; i++) send(i * 50, 12_300, 420);
    const energyBefore = snap().metrics.sessionEnergyJ;
    for (let i = 10; i < 50; i++) send(i * 50, 0, 0, FLAG.SENSOR_FAULT);
    const s = snap();
    expect(s.metrics.measurementValid).toBe(false);
    expect(s.metrics.inputPresent).toBe(false);
    expect(s.alerts.map((a) => a.kind)).toContain('sensor_fault');
    expect(s.metrics.voltageV).toBe(12.3); // last real value, flagged as not current
    expect(s.metrics.sessionEnergyJ).toBe(energyBefore); // the faulted span added nothing
  });

  it('truncated and out-of-range packets are counted and dropped', async () => {
    const { host, send, snap } = await started();
    for (let i = 0; i < 10; i++) send(i * 50, 12_300, 420);
    host.handle({ type: 'packet', buf: new ArrayBuffer(5), arrivalMs: ANCHOR + 600 });
    const bad = packTelemetry({ seq: 99, deviceTimeMs: 700, voltageMv: 0, currentMa: 0, flags: 0 });
    new DataView(bad.buffer).setUint16(6, 60_000, true);
    host.handle({ type: 'packet', buf: bad.buffer as ArrayBuffer, arrivalMs: ANCHOR + 700 });
    const s = snap();
    expect(s.quality.detail.malformedPackets).toBe(2);
    expect(s.metrics.voltageV).toBe(12.3);
  });

  it('the minimum input voltage can be changed through the profile', async () => {
    const { host, send, snap, out } = await started();
    for (let i = 0; i < 20; i++) send(i * 50, 5000, 100);
    expect(snap().metrics.inputPresent).toBe(true);
    host.handle({
      type: 'rpc',
      id: 1,
      method: 'saveProfile',
      args: [{ ...DEFAULT_PROFILE, minInputV: 8 }],
    });
    expect((await rpcResult(out, 1)).type).toBe('rpcResult');
    for (let i = 20; i < 40; i++) send(i * 50, 5000, 100);
    expect(snap().metrics.inputPresent).toBe(false);
  });

  it('a profile saved without the new field is accepted (defaults fill it in)', async () => {
    const { host } = await started();
    const { minInputV: _omit, ...old } = DEFAULT_PROFILE;
    const out: FromWorker[] = [];
    const h2 = new WorkerHost(new Store(new ForceDatabase(`input-${n++}`)), (m) => out.push(m), {
      autoTimers: false,
    });
    await h2.init();
    h2.handle({ type: 'rpc', id: 7, method: 'saveProfile', args: [old] });
    const res = await rpcResult(out, 7);
    expect(res && res.type === 'rpcResult' && res.ok).toBe(true);
    void host;
  });
});
