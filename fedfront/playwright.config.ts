import { defineConfig } from '@playwright/test';

/** E2E_PORT lets the suite run beside another dev server already on 3100. */
const port = Number(process.env.E2E_PORT ?? 3100);
/** Cloud viewer build (NEXT_PUBLIC_DATA_SOURCE=cloud): its own dev server and the *.cloud.spec.ts files only. */
const cloud = process.env.E2E_MODE === 'cloud' || process.argv.some((a) => a.includes('.cloud.spec'));
if (cloud) process.env.E2E_MODE = 'cloud'; // worker processes re-read this config without the CLI arguments
const cloudPort = Number(process.env.E2E_CLOUD_PORT ?? 3300);

export default cloud
  ? defineConfig({
      testDir: './tests',
      testMatch: ['**/*.cloud.spec.ts'],
      use: { baseURL: `http://127.0.0.1:${cloudPort}`, viewport: { width: 1600, height: 950 } },
      // the hosted viewer: no engine, no Bluetooth. Firestore is mocked in the spec (no network).
      webServer: { command: `npm run dev -- -p ${cloudPort}`, url: `http://127.0.0.1:${cloudPort}`, reuseExistingServer: false, env: { NEXT_PUBLIC_DATA_SOURCE: 'cloud', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'force-e2e', NEXT_PUBLIC_PUBLIC_DEVICE_ID: 'FORCE-71B6' } },
    })
  : defineConfig({
      testDir: './tests',
      testMatch: ['**/*.spec.ts'],
      testIgnore: ['**/*.static.spec.ts', '**/*.cloud.spec.ts'], // production export: playwright.static.config.ts; cloud viewer: E2E_MODE=cloud
      use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 2085, height: 1165 } },
      // mock mode: the real engine pipeline fed by the simulator, on its own IndexedDB
      webServer: { command: `npm run dev -- -p ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, env: { NEXT_PUBLIC_ENGINE: 'mock' } },
    });
