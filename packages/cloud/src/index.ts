/**
 * @force/cloud: the Firestore document model and the browser-side sync client.
 *
 * No Firebase SDK and no secrets live here. The dashboard sends finished real-device records to
 * the local sync agent (@force/cloud-agent), which alone holds the Firebase Admin credentials.
 */
export * from './client.js';
export * from './days.js';
export * from './dexie.js';
export * from './model.js';
