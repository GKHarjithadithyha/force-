import type { StepEvent } from '@force/contracts';
import { compactUtc } from './session.js';

/**
 * Cloud-ready record shapes from the Data Collection Requirements doc ("Example Payloads").
 * v1 sends nothing anywhere (PRD D10); these pure builders exist so a gateway or the later cloud
 * sync reuses ONE shape, with field names exactly as the document specifies.
 */

export interface FootstepEventMessage {
  device_id: string;
  timestamp_utc: string;
  event_id: string;
  /** Steps counted so far in the caller's local day (from getTotals), after this step. */
  step_count: number;
  voltage_V: number;
  current_A: number;
  /** Instantaneous power at the trigger sample. */
  power_W: number;
  energy_interval_J: number;
  power_peak_W: number;
}

export type DeviceStatus = 'OK' | 'ERROR' | 'OFFLINE';

export interface HeartbeatMessage {
  device_id: string;
  timestamp_utc: string;
  last_step_timestamp: string | null;
  step_count_today: number;
  energy_total_J: number;
  last_comm_utc: string | null;
  status: DeviceStatus;
}

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

export function toFootstepEventMessage(
  step: StepEvent,
  deviceId: string,
  stepCountToday: number,
): FootstepEventMessage {
  const currentA = step.currentMa / 1000;
  return {
    device_id: deviceId,
    timestamp_utc: new Date(step.t).toISOString(),
    event_id: `${deviceId}_${compactUtc(step.t)}`,
    step_count: stepCountToday,
    voltage_V: round(step.voltageV, 3),
    current_A: round(currentA, 4),
    power_W: round(step.voltageV * currentA, 4),
    energy_interval_J: round(step.energyJ, 6),
    power_peak_W: round(step.peakW, 4),
  };
}

export function toHeartbeatMessage(args: {
  deviceId: string;
  nowMs: number;
  lastStepMs: number | null;
  stepCountToday: number;
  energyTotalJ: number;
  lastCommMs: number | null;
  status: DeviceStatus;
}): HeartbeatMessage {
  return {
    device_id: args.deviceId,
    timestamp_utc: new Date(args.nowMs).toISOString(),
    last_step_timestamp: args.lastStepMs === null ? null : new Date(args.lastStepMs).toISOString(),
    step_count_today: args.stepCountToday,
    energy_total_J: round(args.energyTotalJ, 6),
    last_comm_utc: args.lastCommMs === null ? null : new Date(args.lastCommMs).toISOString(),
    status: args.status,
  };
}
