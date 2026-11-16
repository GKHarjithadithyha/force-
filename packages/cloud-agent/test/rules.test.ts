import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS } from '@force/cloud';

/**
 * Security-rule tests for firestore.rules, against the Firestore emulator (needs Java and
 * firebase-tools). Skipped unless FIRESTORE_EMULATOR_HOST is set; run with
 *   npm run cloud:test:rules
 */
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PUBLIC = [COLLECTIONS.devices, COLLECTIONS.liveStatus, COLLECTIONS.dailySummaries];
const PRIVATE = [
  COLLECTIONS.sessions,
  COLLECTIONS.footsteps,
  COLLECTIONS.energyMinutes,
  COLLECTIONS.dataGaps,
  COLLECTIONS.deviceConfigs,
];
const ALL = [...PUBLIC, ...PRIVATE, 'somethingElse'];

describe.skipIf(!HOST)('firestore.rules', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, port] = HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-force',
      firestore: {
        rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
        host: host!,
        port: Number(port),
      },
    });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const c of ALL) await setDoc(doc(db, c, 'FORCE-71B6'), { deviceId: 'FORCE-71B6' });
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  const anon = () => env.unauthenticatedContext().firestore();
  const user = () => env.authenticatedContext('plain-user').firestore();
  const reader = () => env.authenticatedContext('reader', { forceReader: true }).firestore();

  it('anyone can get the public documents and list them in pages of at most 100', async () => {
    for (const c of PUBLIC) {
      await assertSucceeds(getDoc(doc(anon(), c, 'FORCE-71B6')));
      await assertSucceeds(getDocs(query(collection(anon(), c), limit(100))));
      await assertFails(getDocs(query(collection(anon(), c), limit(101))));
      await assertFails(getDocs(collection(anon(), c))); // no limit: refused
    }
  });

  it('unauthenticated and ordinary signed-in users cannot read private collections', async () => {
    for (const c of PRIVATE) {
      for (const db of [anon(), user()]) {
        await assertFails(getDoc(doc(db, c, 'FORCE-71B6')));
        await assertFails(getDocs(query(collection(db, c), limit(10))));
      }
    }
  });

  it('readers with the forceReader claim can read private collections, in bounded pages', async () => {
    for (const c of PRIVATE) {
      await assertSucceeds(getDoc(doc(reader(), c, 'FORCE-71B6')));
      await assertSucceeds(getDocs(query(collection(reader(), c), limit(100))));
    }
    await assertFails(getDocs(collection(reader(), COLLECTIONS.footsteps))); // no limit
    await assertFails(getDocs(query(collection(reader(), COLLECTIONS.footsteps), limit(501))));
  });

  it('nobody can write, update or delete anything, in any collection', async () => {
    for (const c of ALL) {
      for (const db of [anon(), user(), reader()]) {
        await assertFails(setDoc(doc(db, c, 'new-doc'), { x: 1 }));
        await assertFails(updateDoc(doc(db, c, 'FORCE-71B6'), { x: 1 }));
        await assertFails(deleteDoc(doc(db, c, 'FORCE-71B6')));
      }
    }
  });

  it('unknown collections are closed to reads', async () => {
    await assertFails(getDoc(doc(anon(), 'somethingElse', 'FORCE-71B6')));
    await assertFails(getDoc(doc(reader(), 'somethingElse', 'FORCE-71B6')));
  });
});
