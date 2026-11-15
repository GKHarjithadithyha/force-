import { defineConfig } from '@playwright/test';

/** E2E_PORT lets the suite run beside another dev server already on 3100. */
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  testIgnore: ['**/*.static.spec.ts'], // production export: playwright.static.config.ts
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 2085, height: 1165 } },
  // mock mode: the real engine pipeline fed by the simulator, on its own IndexedDB
  webServer: { command: `npm run dev -- -p ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, env: { NEXT_PUBLIC_ENGINE: 'mock' } },
});
