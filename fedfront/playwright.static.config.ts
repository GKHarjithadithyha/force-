import { defineConfig } from '@playwright/test';

/**
 * Production static-site tests: serves the built export (out/, real-engine mode) and runs the
 * specs that check it. Build first: `npm run build`. Data is simulated (Start Demo); Bluetooth
 * itself needs hardware and is not tested here.
 */
const port = Number(process.env.STATIC_PORT ?? 3200);

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.static.spec.ts'],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: { command: `node scripts/serve-static.mjs out ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
