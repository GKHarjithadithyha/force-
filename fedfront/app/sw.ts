/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker';
import { NetworkOnly, Serwist } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // public cloud reads (cloud viewer build) are never cached: an offline phone must show "Connection problem", not hour-old values
  runtimeCaching: [{ matcher: ({ url }) => url.hostname === 'firestore.googleapis.com', handler: new NetworkOnly() }, ...defaultCache],
  fallbacks: { entries: [{ url: '/offline.html', matcher: ({ request }) => request.destination === 'document' }] },
});

serwist.addEventListeners();

