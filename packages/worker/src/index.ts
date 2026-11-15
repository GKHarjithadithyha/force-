/**
 * @force/worker: the runtime side of the dashboard engine.
 *
 * Frontend entry points:
 *   createDashboardEngine()  real device: Web Worker + IndexedDB + Web Bluetooth
 *   createMockEngine()       same surface, fed by the packet simulator, no hardware needed
 * Types come from @force/contracts (also re-exported here for convenience).
 */
export type * from '@force/contracts';
export { DEFAULT_PROFILE, validateProfile } from '@force/engine';
export * from './engine.js';
export * from './host.js';
export * from './inline.js';
export * from './messages.js';
export * from './mock.js';
