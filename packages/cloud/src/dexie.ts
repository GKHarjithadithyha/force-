import Dexie from 'dexie';
import type { Table } from 'dexie';
import { co2AvoidedKg } from '@force/engine';
import { Store, openDatabase, stripRow } from '@force/storage';
import type { LocalSource, SessionSyncState, SyncStateStore } from './client.js';
import type { DevicePayload, SessionRecord } from './model.js';

/**
 * IndexedDB adapters for the browser.
 *
 * - `StoreLocalSource` reads the dashboard's own database through the existing `Store` queries.
 *   It never writes to it.
 * - The sync progress lives in a SEPARATE database ("force-sync"), so the main database schema
 *   is untouched and deleting the sync state can never touch recorded data.
 */

export const SYNC_DB_NAME = 'force-sync';
/** The only local database whose data may be synced. The mock engine uses "force-mock". */
export const DEVICE_DB_NAME = 'force';

export class StoreLocalSource implements LocalSource {
  /** `databaseName` exists for tests; the mock database ("force-mock") is always refused. */
  constructor(
    private readonly store: Store,
    { databaseName = DEVICE_DB_NAME }: { databaseName?: string } = {},
  ) {
    if (store.db.name !== databaseName || /mock/i.test(store.db.name)) {
      throw new Error(
        `Cloud sync reads only the "${databaseName}" database, not "${store.db.name}"`,
      );
    }
  }

  async completedDeviceSessions(): Promise<SessionRecord[]> {
    const rows = await this.store.db.sessions.where('source').equals('device').toArray();
    return rows
      .filter((r) => r.status !== 'open')
      .map((r) => ({ ...stripRow(r), firmwareVersion: r.firmwareVersion }));
  }

  sessionSteps(id: string) {
    return this.store.getSessionSteps(id);
  }

  async sessionMinutes(id: string) {
    const rows = await this.store.getSessionMinutes(id);
    return rows.map(({ sessionId: _s, ...b }) => b);
  }

  sessionGaps(id: string) {
    return this.store.getSessionGaps(id);
  }

  async device(deviceId: string): Promise<DevicePayload | null> {
    const row = await this.store.db.devices.get(deviceId);
    if (!row) return null;
    const { lastSeen, ...info } = row;
    return { info, lastSeenMs: lastSeen, profile: await this.store.getProfile() };
  }

  async dailyTotals(deviceId: string, fromMs: number, toMs: number) {
    const [{ totals, energyNj2 }, profile] = await Promise.all([
      this.store.getTotalsExact(fromMs, toMs, deviceId),
      this.store.getProfile(),
    ]);
    return {
      totals,
      energyNj2,
      co2AvoidedKg: co2AvoidedKg(totals.energyWh, profile),
      emissionFactorKgPerKwh: profile.emissionFactorKgPerKwh,
    };
  }
}

/**
 * The device database as a LocalSource, opened on first use (read-only use: only queries).
 * A failed open is retried on the next call.
 */
export function deviceDatabaseSource(): LocalSource {
  let ready: Promise<StoreLocalSource> | null = null;
  const get = () =>
    (ready ??= openDatabase(DEVICE_DB_NAME)
      .then(({ db }) => new StoreLocalSource(new Store(db)))
      .catch((e: unknown) => {
        ready = null;
        throw e;
      }));
  return {
    completedDeviceSessions: async () => (await get()).completedDeviceSessions(),
    sessionSteps: async (id) => (await get()).sessionSteps(id),
    sessionMinutes: async (id) => (await get()).sessionMinutes(id),
    sessionGaps: async (id) => (await get()).sessionGaps(id),
    device: async (id) => (await get()).device(id),
    dailyTotals: async (d, f, t) => (await get()).dailyTotals(d, f, t),
  };
}

class SyncDatabase extends Dexie {
  sessions!: Table<SessionSyncState, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ sessions: 'sessionId, phase' });
  }
}

export class DexieSyncStateStore implements SyncStateStore {
  private readonly db: SyncDatabase;
  constructor(name = SYNC_DB_NAME) {
    this.db = new SyncDatabase(name);
  }
  all(): Promise<SessionSyncState[]> {
    return this.db.sessions.toArray();
  }
  async put(s: SessionSyncState): Promise<void> {
    await this.db.sessions.put(s);
  }
  close(): void {
    this.db.close();
  }
}
