import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { AgentConfig } from './config.js';
import type { DocStore, DocWrite } from './docstore.js';

/**
 * Firebase Admin SDK, used only by this local process. The Admin SDK bypasses Firestore security
 * rules, which is why the rules deny every client write: this agent is the only writer.
 */
export class AdminDocStore implements DocStore {
  private constructor(
    private readonly app: App,
    readonly db: Firestore,
  ) {}

  static create(cfg: AgentConfig): AdminDocStore {
    const name = `force-cloud-agent-${Date.now()}`;
    const app = cfg.emulatorHost
      ? initializeApp({ projectId: cfg.projectId }, name)
      : initializeApp({ projectId: cfg.projectId, credential: cert(cfg.credentialsPath!) }, name);
    const db =
      cfg.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, cfg.databaseId);
    return new AdminDocStore(app, db);
  }

  async commit(writes: DocWrite[]): Promise<void> {
    const batch = this.db.batch();
    for (const w of writes) {
      const ref = this.db.collection(w.collection).doc(w.id);
      if (w.op === 'delete') batch.delete(ref);
      else batch.set(ref, w.data, { merge: w.merge === true });
    }
    await batch.commit();
  }

  async docsWhere(
    collection: string,
    field: string,
    value: string,
    limit: number,
    fields: string[],
  ) {
    const snap = await this.db
      .collection(collection)
      .where(field, '==', value)
      .limit(limit)
      .select(...fields)
      .get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  }

  async get(collection: string, id: string) {
    const d = await this.db.collection(collection).doc(id).get();
    return d.exists ? (d.data() as Record<string, unknown>) : null;
  }

  async exists(collection: string, id: string) {
    return (await this.db.collection(collection).doc(id).get()).exists;
  }

  timestamp(epochMs: number): unknown {
    return Timestamp.fromMillis(epochMs);
  }

  serverTime(): unknown {
    return FieldValue.serverTimestamp();
  }

  async ping(): Promise<void> {
    await this.db.collection('devices').limit(1).get();
  }

  async close(): Promise<void> {
    await this.db.terminate();
    await deleteApp(this.app);
  }
}

/** gRPC status codes the Firestore SDK reports in `error.code`. */
const INVALID_ARGUMENT = 3;
const PERMISSION_DENIED = 7;
const UNAUTHENTICATED = 16;

/** A short, safe description of a Firestore failure, and whether retrying can help. */
export function classifyFirestoreError(e: unknown): { message: string; retryable: boolean } {
  const code = (e as { code?: unknown })?.code;
  const text = e instanceof Error ? e.message : String(e);
  if (code === INVALID_ARGUMENT || code === 'invalid-argument') {
    return { message: `Firestore rejected the data: ${text}`, retryable: false };
  }
  if (code === PERMISSION_DENIED || code === 'permission-denied') {
    return {
      message:
        'Firestore permission denied: check that the service account has the "Cloud Datastore User" role and that Firestore is created in this project',
      retryable: true,
    };
  }
  if (code === UNAUTHENTICATED || code === 'unauthenticated') {
    return {
      message: 'Firestore authentication failed: the service-account key may be revoked',
      retryable: true,
    };
  }
  return { message: `Firestore unavailable: ${text}`, retryable: true };
}
