import type { DeviceProfile, GapRecord, SessionSummary, StepEvent } from '@force/contracts';
import { packTelemetry } from '@force/protocol';
import { DEFAULT_PROFILE, Pipeline } from '../src/index.js';
import type { MinuteBucket, PipelineConfig, RawSample } from '../src/index.js';

export const T0 = 1_700_000_000_000; // arrival-time anchor used by most tests

export function packet(seq: number, t: number, mv: number, ma: number, flags = 0): Uint8Array {
  return packTelemetry({ seq, deviceTimeMs: t, voltageMv: mv, currentMa: ma, flags });
}

export function profile(over: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...DEFAULT_PROFILE, ...over };
}

export interface Collected {
  steps: StepEvent[];
  gaps: GapRecord[];
  minutes: MinuteBucket[];
  raws: Array<{ sessionId: string; sample: RawSample }>;
  opened: SessionSummary[];
  closed: SessionSummary[];
  chart: number;
}

export function makePipeline(over: Partial<PipelineConfig> = {}): {
  pipe: Pipeline;
  got: Collected;
} {
  const got: Collected = {
    steps: [],
    gaps: [],
    minutes: [],
    raws: [],
    opened: [],
    closed: [],
    chart: 0,
  };
  const pipe = new Pipeline(
    {
      source: 'device',
      deviceId: 'FORCE-TEST',
      profile: profile(),
      deviceSensorLimitMa: 3200,
      priorEnergyWh: 0,
      priorSteps: 0,
      checkClockDrift: false,
      ...over,
    },
    {
      onStep: (e) => got.steps.push(e),
      onGap: (g) => got.gaps.push(g),
      onMinuteClosed: (b) => got.minutes.push(b),
      onRawSample: (sessionId, sample) => got.raws.push({ sessionId, sample }),
      onSessionOpened: (s) => got.opened.push(s),
      onSessionClosed: (s) => got.closed.push(s),
      onChartPoint: () => {
        got.chart++;
      },
    },
  );
  return { pipe, got };
}

/** Feeds (t, mV, mA) rows with consecutive seq numbers; arrival = T0 + (t - first t). */
export function feedRows(
  pipe: Pipeline,
  rows: Array<[t: number, mv: number, ma: number]>,
  opts: { startSeq?: number; arrivalBase?: number } = {},
): void {
  let seq = opts.startSeq ?? 0;
  const base = opts.arrivalBase ?? T0;
  const t0 = rows[0]?.[0] ?? 0;
  for (const [t, mv, ma] of rows) {
    pipe.pushPacket(packet(seq & 0xffff, t, mv, ma), base + (t - t0));
    seq++;
  }
}

/** Constant-power stream: n samples at `periodMs`, starting at t = start. */
export function constant(
  n: number,
  periodMs: number,
  mv: number,
  ma: number,
  start = 0,
): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i): [number, number, number] => [
    start + i * periodMs,
    mv,
    ma,
  ]);
}
