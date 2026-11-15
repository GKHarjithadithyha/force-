import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  DeviceInfo,
  DeviceProfile,
  GapRecord,
  SessionSummary,
  StepEvent,
} from '@force/contracts';
import type { MinuteBucket } from '@force/engine';

/** A session as stored: the summary plus bookkeeping. */
export interface SessionRow extends SessionSummary {
  profileId: string;
  /** Epoch ms when raw chunks were removed by retention; totals, steps and buckets remain. */
  rawPurgedAt: number | null;
  firmwareVersion: string | null;
}

/** About one second of raw samples, packed 15 bytes each in wire format (Architecture section 9). */
export interface ChunkRow {
  sessionId: string;
  /** Epoch ms of the first sample. */
  startMs: number;
  /** Epoch ms of the last sample. */
  endMs: number;
  count: number;
  data: Uint8Array;
}

export interface GapRow extends GapRecord {
  sessionId: string;
}
export interface StepRow extends StepEvent {
  sessionId: string;
}
export interface MinuteRow extends MinuteBucket {
  sessionId: string;
}

export interface ConnectionEventRow {
  id?: number;
  time: number;
  deviceId: string;
  type: 'state' | 'connected' | 'dropped' | 'reconnected' | 'error';
  detail: string;
}

export interface DeviceRow extends DeviceInfo {
  lastSeen: number;
}
export interface ProfileRow {
  id: string;
  profile: DeviceProfile;
  savedAt: number;
}
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Stores (Architecture section 9). Every row that belongs to a session carries its id, and
 * sessions carry the device id, so a second tile needs no schema change.
 *
 * Migrations are ADDITIVE only (new stores, new indexes). Rolling back the app must never
 * strand stored data, so a column is never renamed or removed; see `openDatabase` for how a
 * database that is one version NEWER than this code is tolerated.
 */
export const SCHEMA: ReadonlyArray<{ version: number; stores: Record<string, string> }> = [
  {
    version: 1,
    stores: {
      devices: 'deviceId',
      profiles: 'id',
      sessions: 'id, startedAt, status, source, deviceId',
      chunks: '[sessionId+startMs], sessionId, endMs',
      gaps: '[sessionId+startMs], sessionId',
      steps: '[sessionId+t], sessionId, t',
      minutes: '[sessionId+minute], sessionId, minute',
      events: '++id, time',
    },
  },
  // v2 (additive): a small key/value store, e.g. for "persistent storage requested".
  { version: 2, stores: { meta: 'key' } },
];

export class ForceDatabase extends Dexie {
  devices!: Table<DeviceRow, string>;
  profiles!: Table<ProfileRow, string>;
  sessions!: Table<SessionRow, string>;
  chunks!: Table<ChunkRow, [string, number]>;
  gaps!: Table<GapRow, [string, number]>;
  steps!: Table<StepRow, [string, number]>;
  minutes!: Table<MinuteRow, [string, number]>;
  events!: Table<ConnectionEventRow, number>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'force', upToVersion = Number.POSITIVE_INFINITY) {
    super(name);
    for (const s of SCHEMA) {
      if (s.version <= upToVersion) this.version(s.version).stores(s.stores);
    }
  }
}

/** The newest schema version this code knows. */
export const LATEST_SCHEMA_VERSION = SCHEMA[SCHEMA.length - 1]!.version;

export interface OpenResult {
  db: ForceDatabase;
  /** True if the stored database is NEWER than this code (a newer app upgraded it, then we rolled back). */
  newerThanApp: boolean;
}

/**
 * Opens the database. Dexie 4 opens a database whose stored version is higher than the one this
 * code declares, because migrations here are additive: every store and column this version
 * knows is still there. `newerThanApp` lets the caller show a note.
 */
export async function openDatabase(name = 'force'): Promise<OpenResult> {
  const db = new ForceDatabase(name);
  await db.open();
  const storedVersion = Math.round(db.backendDB().version / 10); // Dexie stores version x 10
  return { db, newerThanApp: storedVersion > LATEST_SCHEMA_VERSION };
}
