import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { CommitPayload, RecordsPayload } from '@force/cloud';
import { CloudWriter, MemoryDocStore, createSyncHandler } from '../src/index.js';
import type { WriterOptions } from '../src/index.js';

export const TOKEN = 'test-token-0123456789-abcdefghijklmnopqrstuvwxyz';
export const DEVICE = 'FORCE-71B6';
export const OTHER = 'FORCE-0A0A';
/** 2026-11-16T10:00:00Z */
export const T0 = Date.UTC(2026, 10, 16, 10, 0, 0);
/** The agent's clock in fixture tests: one day after T0. */
export const NOW = T0 + 86_400_000;

const servers: Server[] = [];
export async function closeAll() {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
}

/** A real HTTP agent on a free 127.0.0.1 port, backed by an in-memory Firestore. */
export async function startAgent(
  opts: {
    docs?: MemoryDocStore;
    allowedOrigins?: string[];
    writer?: Partial<WriterOptions>;
    now?: () => number;
  } = {},
) {
  const docs = opts.docs ?? new MemoryDocStore();
  const writer = new CloudWriter(docs, {
    site: { id: 'lab-1', name: 'Florix lab, ground floor' },
    minLiveGapMs: 0,
    liveIntervalMs: 0,
    ...opts.writer,
  });
  const logs: string[] = [];
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const handler = createSyncHandler({
    writer,
    port,
    allowedOrigins: opts.allowedOrigins ?? [],
    token: TOKEN,
    log: (level, m) => logs.push(`${level} ${m}`),
    health: () => ({ writes: writer.stats.writes }),
    now: opts.now ?? (() => NOW),
  });
  const base = `http://127.0.0.1:${port}/api/sync/v1`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
      body: JSON.stringify(body),
    });
  return { docs, writer, port, base, post, logs };
}

export function session(over: Partial<CommitPayload['session']> = {}): CommitPayload['session'] {
  return {
    id: `${DEVICE}-mhz3k2a1`,
    source: 'device',
    deviceId: DEVICE,
    startedAt: T0,
    endedAt: T0 + 120_000,
    status: 'closed',
    energyWh: 0.001,
    peakPowerW: 2,
    steps: 10,
    recordedMs: 119_950,
    bridgedMs: 0,
    excludedGapMs: 0,
    name: null,
    firmwareVersion: '1.0.0',
    ...over,
  };
}

/** A valid commit: 0.001 Wh = 3.6 J = 7.2e9 doubled nJ. */
export function commit(over: Partial<CommitPayload> = {}): CommitPayload {
  const s = over.session ?? session();
  return {
    session: s,
    energyNj2: '7200000000',
    counts: { steps: 10, minutes: 3, gaps: 0 },
    device: {
      info: { deviceId: s.deviceId, name: s.deviceId, firmwareVersion: '1.0.0', sampleRateHz: 20, sensorLimitMa: 3200 },
      lastSeenMs: T0 + 120_000,
      profile: {
        idleThresholdW: 0.05,
        stepThresholdW: 0.5,
        minStepGapMs: 250,
        idleHoldMs: 1000,
        emissionFactorKgPerKwh: 0.475,
        ledWatts: 9,
        phoneBatteryWh: 15,
        kcalPerStep: null,
        scoreWeights: { carbon: 1, energy: 1, wellness: 1 },
        scoreTargets: { co2Kg: 0.00005, ledHours: 0.01, steps: 1000 },
        sensorLimitOverrideMa: null,
        noDataAlertMs: 5000,
        noGenerationAlertMs: 60000,
        minPulseMs: 0,
        minInputV: 1,
        units: { power: 'W', energy: 'Wh' },
      },
    },
    daily: [
      {
        deviceId: s.deviceId,
        date: '2026-11-16',
        timeZone: 'UTC',
        dayStartMs: Date.UTC(2026, 10, 16),
        dayEndMs: Date.UTC(2026, 10, 17),
        totals: {
          fromMs: Date.UTC(2026, 10, 16),
          toMs: Date.UTC(2026, 10, 17),
          steps: 10,
          energyWh: 0.001,
          recordedMs: 119_950,
          peakPowerW: 2,
          sessions: 1,
        },
        energyNj2: '7200000000',
        co2AvoidedKg: (0.001 / 1000) * 0.475,
        emissionFactorKgPerKwh: 0.475,
        computedAtMs: T0 + 200_000,
      },
    ],
    ...over,
  };
}

export function records(over: Partial<RecordsPayload> = {}): RecordsPayload {
  return {
    deviceId: DEVICE,
    sessionId: `${DEVICE}-mhz3k2a1`,
    bounds: { startedAt: T0, endedAt: T0 + 120_000 },
    steps: [
      {
        id: `${DEVICE}_20261116T100005000Z`,
        t: T0 + 5_000,
        stepNumber: 1,
        peakW: 2,
        avgW: 1.2,
        durationMs: 150,
        energyJ: 0.18,
        voltageV: 5.1,
        currentMa: 390,
      },
    ],
    minutes: [
      {
        minute: Math.floor(T0 / 60_000),
        energyNj2: 2_400_000_000,
        recordedMs: 60_000,
        peakPowerUw: 2_000_000,
        steps: 5,
        samples: 1200,
        gapMs: 0,
      },
    ],
    gaps: [],
    ...over,
  };
}
