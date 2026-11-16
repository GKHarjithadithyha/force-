import { describe, expect, it, vi } from 'vitest';
import {
  dailyQuery, decodeDocument, decodeValue, fetchDaily, fetchDeviceId, fetchLive, freshness, liveUrl, nextBackoff,
  parseDailyResponse, readCloudConfig, toLiveView, rowTimeMs,
} from '../lib/cloud-read';
import type { LiveView } from '../lib/cloud-read';

const T0 = Date.parse('2026-11-17T10:00:00Z');
const ts = (ms: number) => ({ timestampValue: new Date(ms).toISOString() });
const dbl = (n: number) => ({ doubleValue: n });
const int = (n: number) => ({ integerValue: String(n) });

/** A liveStatus document as the REST API returns it (field names from LiveStatusDoc). */
function liveDoc(over: Record<string, unknown> = {}) {
  return {
    name: 'projects/p/databases/(default)/documents/liveStatus/FORCE-71B6',
    fields: {
      schemaVersion: int(1), deviceId: { stringValue: 'FORCE-71B6' }, connection: { stringValue: 'streaming' }, sessionId: { stringValue: 's1' },
      sampleAt: ts(T0), lastPacketAt: ts(T0 - 5000), measurementValid: { booleanValue: true }, inputPresent: { booleanValue: true }, generating: { booleanValue: true },
      measured: { mapValue: { fields: { voltageV: dbl(3.3), currentMa: int(12), powerW: dbl(0.0396) } } },
      link: { mapValue: { fields: { rssiDbm: int(-61), sampleRateHz: int(10) } } },
      calculated: { mapValue: { fields: { sessionEnergyWh: dbl(1.25), totalEnergyWh: dbl(10.5), avgPowerW: dbl(0.03), peakPowerW: dbl(0.2), steps: int(42), cadenceSpm: dbl(88), energyPerStepJ: { nullValue: null } } } },
      estimated: { mapValue: { fields: { co2AvoidedKg: dbl(0.0005), ledHours: dbl(1), phoneCharges: dbl(0), kcal: { nullValue: null }, sustainabilityScore: { nullValue: null } } } },
      quality: { mapValue: { fields: { lostPackets: int(0) } } },
      alerts: { arrayValue: { values: [{ mapValue: { fields: { kind: { stringValue: 'sensor_fault' }, severity: { stringValue: 'error' }, since: ts(T0) } } }] } },
      ...over,
    },
  };
}

describe('Firestore REST value decoding', () => {
  it('decodes every value type of the spec', () => {
    expect(decodeValue({ integerValue: '9007199254' })).toBe(9007199254);
    expect(decodeValue({ doubleValue: 1.5 })).toBe(1.5);
    expect(decodeValue({ booleanValue: true })).toBe(true);
    expect(decodeValue({ stringValue: 'x' })).toBe('x');
    expect(decodeValue({ nullValue: null })).toBeNull();
    expect(decodeValue({ timestampValue: '2026-11-17T10:00:00.250Z' })).toBe(Date.parse('2026-11-17T10:00:00.250Z'));
    expect(decodeValue({ mapValue: { fields: { a: int(1), b: { mapValue: {} } } } })).toEqual({ a: 1, b: {} });
    expect(decodeValue({ arrayValue: { values: [int(1), { stringValue: 'y' }] } })).toEqual([1, 'y']);
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
  });

  it('turns unknown, malformed and non-finite values into null instead of a number', () => {
    expect(decodeValue({ bytesValue: 'AA==' })).toBeNull();
    expect(decodeValue('x')).toBeNull();
    expect(decodeValue({ integerValue: 'abc' })).toBeNull();
    expect(decodeValue({ doubleValue: 'NaN' })).toBeNull();
    expect(decodeValue({ timestampValue: 'nope' })).toBeNull();
    expect(decodeDocument({ name: 'x' })).toEqual({});
  });
});

describe('liveStatus mapping', () => {
  it('maps the stored fields without calculating anything', () => {
    const v = toLiveView(decodeDocument(liveDoc()))!;
    expect(v).toMatchObject({ deviceId: 'FORCE-71B6', connection: 'streaming', sessionEnergyWh: 1.25, totalEnergyWh: 10.5, steps: 42, cadenceSpm: 88, co2AvoidedKg: 0.0005, rssiDbm: -61, peakPowerW: 0.2 });
    expect(v.measured).toEqual({ voltageV: 3.3, currentMa: 12, powerW: 0.0396 });
    expect(v.sampleAtMs).toBe(T0);
    expect(v.lastPacketAtMs).toBe(T0 - 5000);
    expect(v.alerts).toEqual([{ kind: 'sensor_fault', severity: 'error' }]);
  });

  it('keeps measured null when the reading is not valid and nulls absent numbers', () => {
    const v = toLiveView(decodeDocument(liveDoc({ measured: { nullValue: null }, lastPacketAt: { nullValue: null }, calculated: { mapValue: { fields: { cadenceSpm: { nullValue: null } } } } })))!;
    expect(v.measured).toBeNull();
    expect(v.lastPacketAtMs).toBeNull();
    expect(v.cadenceSpm).toBeNull();
    expect(v.steps).toBeNull();
  });

  it('rejects a document that is not a live status', () => {
    expect(toLiveView({})).toBeNull();
  });
});

describe('dailySummaries mapping', () => {
  const day = (date: string, steps: number, energyWh: number) => ({ document: { name: `x/dailySummaries/FORCE-71B6_${date}`, fields: { deviceId: { stringValue: 'FORCE-71B6' }, date: { stringValue: date }, dayStart: ts(Date.parse(`${date}T00:00:00Z`)), steps: int(steps), energyWh: dbl(energyWh), energyNj2: { stringValue: '123' }, peakPowerW: dbl(0.2), sessions: int(2), estimated: { mapValue: { fields: { co2AvoidedKg: dbl(0.001) } } } } }, readTime: 'x' });

  it('parses a runQuery response, skipping entries without a document', () => {
    const rows = parseDailyResponse([day('2026-11-17', 120, 4.5), { readTime: 'x' }, day('2026-11-16', 80, 3)]);
    expect(rows.map((r) => r.date)).toEqual(['2026-11-17', '2026-11-16']);
    expect(rows[0]).toMatchObject({ steps: 120, energyWh: 4.5, peakPowerW: 0.2, sessions: 2, co2AvoidedKg: 0.001 });
    expect(rowTimeMs(rows[0])).toBe(Date.parse('2026-11-17T00:00:00Z'));
    expect(parseDailyResponse({ error: {} })).toEqual([]);
  });

  it('builds the spec query: device filter, newest date first, limit 30', () => {
    expect(dailyQuery('FORCE-71B6')).toEqual({ structuredQuery: { from: [{ collectionId: 'dailySummaries' }], where: { fieldFilter: { field: { fieldPath: 'deviceId' }, op: 'EQUAL', value: { stringValue: 'FORCE-71B6' } } }, orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }], limit: 30 } });
  });
});

describe('freshness', () => {
  const base = (over: Partial<LiveView>): LiveView => ({ ...toLiveView(decodeDocument(liveDoc()))!, ...over });
  it('is live only while streaming and at most 90 s old', () => {
    expect(freshness(base({}), T0)).toBe('live'); // 5 s old (lastPacketAt)
    expect(freshness(base({ lastPacketAtMs: T0 - 90_000 }), T0)).toBe('live');
    expect(freshness(base({ lastPacketAtMs: T0 - 91_000 }), T0)).toBe('stale');
    expect(freshness(base({ connection: 'idle' }), T0)).toBe('stale');
  });
  it('is stale up to 10 minutes and offline beyond, using sampleAt when there is no packet', () => {
    expect(freshness(base({ lastPacketAtMs: T0 - 600_000 }), T0)).toBe('stale');
    expect(freshness(base({ lastPacketAtMs: T0 - 600_001 }), T0)).toBe('offline');
    expect(freshness(base({ lastPacketAtMs: null, sampleAtMs: T0 - 30_000 }), T0)).toBe('live');
    expect(freshness(base({ lastPacketAtMs: null, sampleAtMs: null }), T0)).toBe('offline');
  });
});

describe('config, backoff and fetching', () => {
  it('requires a project id and validates the ids', () => {
    expect(readCloudConfig({})).toMatchObject({ ok: false });
    expect(readCloudConfig({ projectId: 'a/../b' })).toMatchObject({ ok: false });
    expect(readCloudConfig({ projectId: 'force-demo', deviceId: 'x/y' })).toMatchObject({ ok: false });
    expect(readCloudConfig({ projectId: ' force-demo ', deviceId: '' })).toEqual({ ok: true, config: { projectId: 'force-demo', deviceId: null } });
    expect(readCloudConfig({ projectId: 'force-demo', deviceId: 'FORCE-71B6' })).toEqual({ ok: true, config: { projectId: 'force-demo', deviceId: 'FORCE-71B6' } });
  });

  it('backs off 5 s doubling to 60 s', () => {
    const seq: number[] = []; let d: number | null = null;
    for (let i = 0; i < 6; i++) { d = nextBackoff(d); seq.push(d); }
    expect(seq).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });

  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const cfg = { projectId: 'force-demo' };

  it('reads live status from the spec URL and maps 404, 403 and server errors', async () => {
    const f = vi.fn((url: string, init?: RequestInit) => { void url; void init; return json(liveDoc()); });
    const ok = await fetchLive(cfg, 'FORCE-71B6', f);
    expect(ok).toMatchObject({ kind: 'ok', value: { deviceId: 'FORCE-71B6' } });
    expect(f.mock.calls[0][0]).toBe('https://firestore.googleapis.com/v1/projects/force-demo/databases/(default)/documents/liveStatus/FORCE-71B6');
    expect(liveUrl(cfg, 'a b')).toContain('/liveStatus/a%20b');
    expect(await fetchLive(cfg, 'x', () => json({ error: {} }, 404))).toEqual({ kind: 'missing' });
    expect(await fetchLive(cfg, 'x', () => json({ error: {} }, 403))).toEqual({ kind: 'forbidden' });
    expect(await fetchLive(cfg, 'x', () => json({ error: {} }, 503))).toMatchObject({ kind: 'error', message: 'HTTP 503' });
    expect(await fetchLive(cfg, 'x', () => Promise.reject(new TypeError('Failed to fetch')))).toMatchObject({ kind: 'error' });
    expect(await fetchLive(cfg, 'x', () => json({ fields: {} }))).toMatchObject({ kind: 'error' });
  });

  it('posts the daily query and picks the first device id', async () => {
    const f = vi.fn((url: string, init?: RequestInit) => { void url; void init; return json([{ document: { fields: { date: { stringValue: '2026-11-17' } } } }]); });
    const r = await fetchDaily(cfg, 'FORCE-71B6', f);
    expect(r).toMatchObject({ kind: 'ok', value: [{ date: '2026-11-17' }] });
    expect(f.mock.calls[0][0]).toBe('https://firestore.googleapis.com/v1/projects/force-demo/databases/(default)/documents:runQuery');
    expect(f.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual(dailyQuery('FORCE-71B6'));
    const dev = (id: string) => ({ name: `projects/p/databases/(default)/documents/devices/${id}`, fields: {} });
    expect(await fetchDeviceId(cfg, () => json({ documents: [dev('FORCE-B'), dev('FORCE-A')] }))).toEqual({ kind: 'ok', value: 'FORCE-A' });
    expect(await fetchDeviceId(cfg, () => json({}))).toEqual({ kind: 'missing' });
  });
});
