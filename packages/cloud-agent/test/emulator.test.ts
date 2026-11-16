import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@force/cloud';
import { AdminDocStore, CloudWriter, loadConfig } from '../src/index.js';

/**
 * Real Firestore SDK against the Firebase emulator. Skipped unless FIRESTORE_EMULATOR_HOST is set:
 *   firebase emulators:exec --only firestore "npx vitest run packages/cloud-agent/test/emulator.test.ts"
 * (needs firebase-tools and Java; ordinary test runs never need credentials or the emulator).
 */
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore emulator', () => {
  it('stores exact integers, timestamps and idempotent documents', async () => {
    const cfg = loadConfig(
      {
        FIREBASE_PROJECT_ID: 'demo-force',
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FORCE_SYNC_STATIC_DIR: 'off',
        FORCE_SYNC_TOKEN: 'e'.repeat(43),
      },
      process.cwd(),
    );
    const store = AdminDocStore.create(cfg);
    const w = new CloudWriter(store, { site: null });
    const minute = {
      minute: 28_333_333,
      energyNj2: Number.MAX_SAFE_INTEGER,
      recordedMs: 60_000,
      peakPowerUw: 2_500_000,
      steps: 3,
      samples: 1200,
      gapMs: 0,
    };
    for (let i = 0; i < 2; i++) {
      await w.records({
        deviceId: 'FORCE-E0E1',
        sessionId: 'FORCE-E0E1-x',
        bounds: { startedAt: 28_333_333 * 60_000, endedAt: 28_333_333 * 60_000 + 60_000 },
        steps: [],
        minutes: [minute],
        gaps: [],
      });
    }
    const snap = await store.db
      .collection(COLLECTIONS.energyMinutes)
      .where('sessionId', '==', 'FORCE-E0E1-x')
      .get();
    expect(snap.size).toBe(1);
    const d = snap.docs[0]!.data();
    expect(d.energyNj2).toBe(Number.MAX_SAFE_INTEGER);
    expect(d.minuteStart.toMillis()).toBe(28_333_333 * 60_000);
    await w.reset({ deviceId: 'FORCE-E0E1', sessionId: 'FORCE-E0E1-x' });
    await store.close();
  });
});
