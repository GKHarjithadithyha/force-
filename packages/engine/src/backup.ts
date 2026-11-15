import type { DeviceProfile, GapRecord, SessionSummary, StepEvent } from '@force/contracts';
import { PACKET_SIZE } from '@force/protocol';
import { validateProfile, withProfileDefaults } from './profile.js';

/**
 * Session backup file ("JSON backup", Architecture section 9). It holds the raw samples packed
 * 15 bytes each, base64 per one-second chunk, plus the derived records and the profile. The
 * replay source reads it back in, which is how a field recording becomes a regression test.
 *
 * Files are untrusted input: parsed with size and shape limits, and a replay file can only
 * supply samples (nothing in it is evaluated).
 */

export const BACKUP_FORMAT = 'force-session-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const MAX_CHUNK_SAMPLES = 1024;

export interface BackupChunk {
  /** Epoch ms of the first sample in the chunk. */
  startMs: number;
  /** Epoch ms of the last sample in the chunk. */
  endMs: number;
  count: number;
  /** base64 of count x 15 bytes, in wire format. */
  data: string;
}

export interface BackupMeta {
  appVersion: string;
  exportedAt: number;
  /** DCR: where V/I are measured. An assumption until the hardware team confirms. */
  measurementBoundary: string;
  shuntAssumption: string;
  firmwareVersion: string | null;
}

export interface SessionBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  meta: BackupMeta;
  session: SessionSummary;
  profile: DeviceProfile;
  steps: StepEvent[];
  gaps: GapRecord[];
  chunks: BackupChunk[];
}

export const MEASUREMENT_BOUNDARY =
  'DC output after the bridge rectifier (assumed; TBD - confirm with hardware team)';
export const SHUNT_ASSUMPTION = 'INA219 shunt 0.1 ohm (assumed; confirm against the board)';

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Throws an Error with a plain message on anything that is not a valid backup. */
export function parseSessionBackup(text: string): SessionBackup {
  if (text.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT)
    throw new Error('Not a F.O.R.C.E session backup');
  if (raw.version !== BACKUP_VERSION)
    throw new Error(`Unsupported backup version ${String(raw.version)}`);
  if (!isObj(raw.session) || typeof raw.session.id !== 'string')
    throw new Error('Backup has no session');
  const s = raw.session;
  if (
    !isNum(s.startedAt) ||
    typeof s.deviceId !== 'string' ||
    !['device', 'demo', 'replay'].includes(String(s.source))
  ) {
    throw new Error('Backup session is malformed');
  }
  if (!isObj(raw.profile)) throw new Error('Backup has no profile');
  // a backup written by an earlier version lacks newer additive profile fields
  const profile = withProfileDefaults(raw.profile as unknown as Partial<DeviceProfile>);
  const problems = validateProfile(profile);
  if (problems.length > 0) throw new Error('Backup profile is invalid: ' + problems.join('; '));
  if (!Array.isArray(raw.chunks) || !Array.isArray(raw.steps) || !Array.isArray(raw.gaps)) {
    throw new Error('Backup is missing chunks, steps or gaps');
  }
  for (const c of raw.chunks as unknown[]) {
    if (
      !isObj(c) ||
      !isNum(c.startMs) ||
      !isNum(c.endMs) ||
      !isNum(c.count) ||
      typeof c.data !== 'string'
    ) {
      throw new Error('Backup has a malformed chunk');
    }
    if (!Number.isInteger(c.count) || c.count < 1 || c.count > MAX_CHUNK_SAMPLES) {
      throw new Error('Backup chunk has a bad sample count');
    }
    if (c.data.length > Math.ceil((c.count * PACKET_SIZE * 4) / 3) + 8) {
      throw new Error('Backup chunk is longer than its sample count');
    }
  }
  for (const g of raw.gaps as unknown[]) {
    if (!isObj(g) || !isNum(g.startMs) || !isNum(g.endMs) || typeof g.cause !== 'string') {
      throw new Error('Backup has a malformed gap');
    }
  }
  for (const e of raw.steps as unknown[]) {
    if (!isObj(e) || !isNum(e.t) || !isNum(e.peakW) || !isNum(e.energyJ)) {
      throw new Error('Backup has a malformed step');
    }
  }
  const backup = { ...(raw as unknown as SessionBackup), profile };
  for (const c of backup.chunks) {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(c.data);
    } catch {
      throw new Error('Backup chunk is not valid base64');
    }
    if (bytes.length !== c.count * PACKET_SIZE)
      throw new Error('Backup chunk has the wrong length');
  }
  return backup;
}

/** The wire packets of a backup in time order, each with its epoch time (for replay). */
export function* backupPackets(
  backup: SessionBackup,
): Generator<{ bytes: Uint8Array; epochMs: number }> {
  const chunks = [...backup.chunks].sort((a, b) => a.startMs - b.startMs);
  for (const c of chunks) {
    const data = base64ToBytes(c.data);
    const view = new DataView(data.buffer);
    const t0 = view.getUint32(2, true);
    for (let i = 0; i < c.count; i++) {
      const off = i * PACKET_SIZE;
      const t = view.getUint32(off + 2, true);
      yield { bytes: data.subarray(off, off + PACKET_SIZE), epochMs: c.startMs + ((t - t0) >>> 0) };
    }
  }
}
