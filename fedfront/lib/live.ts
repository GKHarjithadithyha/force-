import type { ConnectionState, LiveSnapshot } from '@/contracts';

/**
 * Display rules for live readings. They only choose what to SHOW from the engine's snapshot;
 * every value and flag (measurementValid, inputPresent, alerts) is decided by the engine.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'muted';
export interface StatusView { value: string; tone: Tone }

const LIVE: ReadonlySet<ConnectionState> = new Set(['streaming']);

/** True once the current source has delivered at least one packet. */
export function hasData(s: LiveSnapshot | null): s is LiveSnapshot {
  return s !== null && s.sessionId !== null && s.lastPacketAt !== null;
}

/**
 * Primary readings (power, voltage, current) are shown only while streaming a real measurement
 * with a power source present. Otherwise the UI shows a dash instead of presenting the last value
 * or zero current as a normal reading. Raw values stay visible on the Connection diagnostics.
 */
export function readingsUsable(s: LiveSnapshot | null, connection: ConnectionState): boolean {
  return hasData(s) && LIVE.has(connection) && s.metrics.measurementValid && s.metrics.inputPresent;
}

export function sensorStatus(s: LiveSnapshot | null): StatusView {
  if (!hasData(s)) return { value: '—', tone: 'muted' };
  if (s.alerts.some((a) => a.kind === 'sensor_fault') || !s.metrics.measurementValid) return { value: 'Fault', tone: 'bad' };
  if (s.metrics.sensorLimitReached) return { value: 'At limit', tone: 'warn' };
  return { value: 'Normal', tone: 'good' };
}

export function inputStatus(s: LiveSnapshot | null): StatusView {
  if (!hasData(s) || !s.metrics.measurementValid) return { value: '—', tone: 'muted' };
  if (s.alerts.some((a) => a.kind === 'over_voltage')) return { value: 'Over voltage', tone: 'bad' };
  return s.metrics.inputPresent ? { value: 'Present', tone: 'good' } : { value: 'No input', tone: 'warn' };
}

export function connectionTone(c: ConnectionState): Tone {
  if (c === 'streaming') return 'good';
  if (c === 'error') return 'bad';
  if (c === 'idle') return 'muted';
  return 'warn';
}

/** Generation state for the tile: never "Active" without a real, present input. */
export function tileState(s: LiveSnapshot | null, connection: ConnectionState): string {
  if (!hasData(s)) return 'Not connected';
  if (connection === 'stale') return 'No data';
  if (!s.metrics.measurementValid) return 'Sensor fault';
  if (!s.metrics.inputPresent) return 'No input';
  return s.metrics.generating ? 'Active' : 'Idle';
}

export function sourceBanner(s: LiveSnapshot | null): string | null {
  if (!s || s.sessionId === null) return null;
  if (s.source === 'demo') return 'Demo data · Simulated sensor stream, not real generation. Demo sessions are excluded from totals.';
  if (s.source === 'replay') return 'Replay data · Playback of a recorded file. Replay sessions are excluded from totals.';
  return null;
}
