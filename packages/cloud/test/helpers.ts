import { DEFAULT_PROFILE, Pipeline } from '@force/engine';
import { simulate } from '@force/simulator';
import type { SimConfig } from '@force/simulator';
import type { LiveSnapshot, SourceKind } from '@force/contracts';
import { ForceDatabase, Store } from '@force/storage';

export const ANCHOR = 1_700_000_000_000;
let counter = 0;

export function mkStore(): Store {
  return new Store(new ForceDatabase(`cloud-test-${counter++}`), {
    now: () => ANCHOR + 10_000_000,
  });
}

/** Records a simulated stream into the store through the real pipeline (as the worker does). */
export async function record(
  store: Store,
  opts: {
    deviceId?: string;
    source?: SourceKind;
    anchor?: number;
    durationMs?: number;
    sim?: Partial<SimConfig>;
    close?: boolean;
  } = {},
) {
  const anchor = opts.anchor ?? ANCHOR;
  const pipe = new Pipeline(
    {
      source: opts.source ?? 'device',
      deviceId: opts.deviceId ?? 'FORCE-71B6',
      profile: DEFAULT_PROFILE,
      deviceSensorLimitMa: 3200,
      priorEnergyWh: 0,
      priorSteps: 0,
      checkClockDrift: false,
    },
    store.sink(),
  );
  let next = 1000;
  for (const p of simulate({ cadenceSpm: 100, ...opts.sim }, opts.durationMs ?? 150_000)) {
    pipe.pushPacket(p.bytes, anchor + p.arrivalOffsetMs);
    if (p.arrivalOffsetMs >= next) {
      await store.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
      next += 1000;
    }
  }
  if (opts.close !== false) pipe.close();
  await store.flush({ summary: pipe.openSummary(), minute: pipe.peekMinute() });
  return pipe;
}

export function liveSnapshot(): LiveSnapshot {
  return {
    t: 1_700_000_000_000,
    lastPacketAt: 1_700_000_000_000,
    source: 'device',
    connection: 'streaming',
    sessionId: 'FORCE-71B6-lp0abc',
    metrics: {
      measurementValid: true,
      inputPresent: true,
      voltageV: 5,
      currentMa: 300,
      powerW: 1.5,
      generating: true,
      sessionEnergyJ: 10,
      sessionEnergyWh: 10 / 3600,
      totalEnergyWh: 1,
      avgPowerW: 1,
      peakPowerW: 2,
      steps: 12,
      cadenceSpm: 90,
      energyPerStepJ: 0.8,
      stepsPerHour: {},
      co2AvoidedKg: 0.00001,
      ledHours: 0.1,
      phoneCharges: 0.01,
      kcal: null,
      sustainabilityScore: 12.5,
      rssiDbm: -60,
      sampleRateHz: 20,
      sensorLimitReached: false,
    },
    quality: {
      recordedMs: 1000,
      bridgedMs: 0,
      excludedGapMs: 0,
      lostPackets: 0,
      droppedPackets: 0,
      detail: {
        malformedPackets: 0,
        duplicatePackets: 0,
        latePackets: 0,
        clippedSamples: 0,
        negativePowerSamples: 0,
        powerMismatchSamples: 0,
        stepsUnreliable: false,
      },
    },
    alerts: [],
  };
}
