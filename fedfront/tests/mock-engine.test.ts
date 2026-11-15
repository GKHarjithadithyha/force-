// @vitest-environment node
// (Node's Blob/File implement text(); jsdom's do not. The engine needs no DOM.)
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppEngine } from '@/engine';
import type { AppEngine } from '@/engine';
import type { ChartBatch, LiveSnapshot } from '@/contracts';
import { getHistory, getTodayVsYesterday } from '@/lib/analytics';
import { inputStatus, readingsUsable, sensorStatus } from '@/lib/live';

/**
 * SIMULATED test: the real @force/worker pipeline (decoder, session engine, alerts, storage) fed
 * by the packet simulator through the mock engine. No hardware is involved.
 */
async function until<T>(get: () => T | undefined | null | false, timeoutMs = 8000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

let app: AppEngine | null = null;
afterEach(() => { app?.dispose(); app = null; });

describe('fedfront on the real engine (mock mode, simulated stream)', () => {
  it('streams decoded snapshots and chart batches labelled as demo data', async () => {
    app = createAppEngine('mock');
    let last: LiveSnapshot | null = null; const batches: ChartBatch[] = [];
    app.engine.subscribeSnapshot((s) => { last = s; });
    app.engine.subscribeChart((b) => batches.push(b));
    const s = await until(() => (last && (last as LiveSnapshot).connection === 'streaming' && (last as LiveSnapshot).lastPacketAt !== null ? last as LiveSnapshot : null));
    await until(() => batches.length > 0);
    expect(s.source).toBe('demo');
    expect(s.sessionId).not.toBeNull();
    expect(s.metrics.measurementValid).toBe(true);
    expect(readingsUsable(s, s.connection)).toBe(s.metrics.inputPresent);
    expect(sensorStatus(s).value).toBe('Normal');
    expect(batches[0].times.length).toBe(batches[0].powerW.length);
    expect(app.engine.getDeviceInfo()).not.toBeNull();
  });

  it('keeps simulated sessions out of the stored device totals used by the Overview charts', async () => {
    app = createAppEngine('mock');
    let last: LiveSnapshot | null = null;
    app.engine.subscribeSnapshot((s) => { last = s; });
    await until(() => last !== null && (last as LiveSnapshot).lastPacketAt !== null);
    const profile = await app.engine.getProfile();
    const days = await getTodayVsYesterday(app.engine, profile);
    expect(days.today.sessions).toBe(0);
    expect(days.today.energyWh).toBe(0);
    const history = await getHistory(app.engine, 'week');
    expect(history).toHaveLength(7);
    expect(history.every((p) => p.energyWh === 0 && p.steps === 0)).toBe(true);
  });

  it('shows a sensor fault from an injected fault and never reports the reading as usable', async () => {
    app = createAppEngine('mock');
    let last: LiveSnapshot | null = null;
    app.engine.subscribeSnapshot((s) => { last = s; });
    await until(() => last !== null && (last as LiveSnapshot).lastPacketAt !== null);
    app.injectFault!({ kind: 'sensor_fault', durationMs: 3000 }, 0);
    const faulted = await until(() => (last && !(last as LiveSnapshot).metrics.measurementValid ? last as LiveSnapshot : null));
    expect(sensorStatus(faulted).value).toBe('Fault');
    expect(inputStatus(faulted).value).toBe('—');
    expect(readingsUsable(faulted, faulted.connection)).toBe(false);
  });

  it('persists a saved profile and round-trips a session backup through restore', async () => {
    app = createAppEngine('mock');
    const e = app.engine;
    let last: LiveSnapshot | null = null;
    e.subscribeSnapshot((s) => { last = s; });
    await until(() => last !== null && (last as LiveSnapshot).lastPacketAt !== null);
    const p = await e.getProfile();
    await e.saveProfile({ ...p, minInputV: 2.5 });
    expect((await e.getProfile()).minInputV).toBe(2.5);
    await new Promise((r) => setTimeout(r, 1500));
    await e.disconnect();
    const sessions = await e.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const id = sessions[0].id;
    const blob = await e.exportSessionJson(id);
    const file = new File([await blob.text()], 'backup.json', { type: 'application/json' });
    // still stored: restoring it would double-count, so it is refused
    await expect(e.importSession(file)).rejects.toThrow(/already stored/);
    await e.deleteSession(id);
    const restored = await e.importSession(file);
    expect(restored.id).toBe(id);
    expect(restored.steps).toBe(sessions[0].steps);
    expect(restored.energyWh).toBe(sessions[0].energyWh);
    expect((await e.listSessions()).length).toBe(sessions.length);
    await expect(e.importSession(new File(['{"nope":1}'], 'bad.json'))).rejects.toThrow(/Not a F.O.R.C.E session backup/);
  });
});
