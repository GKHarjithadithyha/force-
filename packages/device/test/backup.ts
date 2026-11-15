import type { SessionSummary } from '@force/contracts';
import { BACKUP_FORMAT, BACKUP_VERSION, DEFAULT_PROFILE, bytesToBase64 } from '@force/engine';
import type { SessionBackup } from '@force/engine';
import { simulate } from '@force/simulator';

/** Builds a backup file from simulated packets, one chunk per second, like the store does. */
export function makeBackup(durationMs: number, startedAt = 1_650_000_000_000): string {
  const packets = simulate({ cadenceSpm: 90 }, durationMs);
  const chunks: SessionBackup['chunks'] = [];
  let i = 0;
  while (i < packets.length) {
    const first = packets[i]!;
    const group = [];
    while (i < packets.length && packets[i]!.arrivalOffsetMs < first.arrivalOffsetMs + 1000) {
      group.push(packets[i]!);
      i++;
    }
    const data = new Uint8Array(group.length * 15);
    group.forEach((p, k) => data.set(p.bytes, k * 15));
    chunks.push({
      startMs: startedAt + first.arrivalOffsetMs,
      endMs: startedAt + group[group.length - 1]!.arrivalOffsetMs,
      count: group.length,
      data: bytesToBase64(data),
    });
  }
  const session: SessionSummary = {
    id: 'rec-1',
    source: 'device',
    deviceId: 'FORCE-A1B2',
    startedAt,
    endedAt: startedAt + durationMs,
    status: 'closed',
    energyWh: 0,
    peakPowerW: 0,
    steps: 0,
    recordedMs: 0,
    bridgedMs: 0,
    excludedGapMs: 0,
    name: null,
  };
  const backup: SessionBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    meta: {
      appVersion: 't',
      exportedAt: 0,
      measurementBoundary: 'x',
      shuntAssumption: 'y',
      firmwareVersion: '1.0.0',
    },
    session,
    profile: DEFAULT_PROFILE,
    steps: [],
    gaps: [],
    chunks,
  };
  return JSON.stringify(backup);
}
