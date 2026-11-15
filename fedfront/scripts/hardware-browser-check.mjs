// HARDWARE test: real Chromium + Web Bluetooth -> the physical board -> the production build.
// Not part of CI (needs the board, a Bluetooth radio and a free BLE link: a unit accepts ONE client).
//
//   npm run web:build
//   node fedfront/scripts/serve-static.mjs fedfront/out 8080        (separate terminal)
//   DEVICE_NAME=FORCE-71B6 node fedfront/scripts/hardware-browser-check.mjs
//
// Env: DEVICE_NAME (required, e.g. FORCE-71B6), BASE_URL (default http://127.0.0.1:8080),
//      SHOT_DIR (default ./hardware-check), CONNECT_TIMEOUT_MS (default 45000).
// The Chromium device chooser is answered through the DevTools DeviceAccess domain. The script
// reports what the UI SHOWED; it never fabricates a reading, and exits 2 if the board never
// streamed, so a pass cannot be claimed without a real connection.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const name = process.env.DEVICE_NAME;
if (!name) { console.error('Set DEVICE_NAME, for example FORCE-71B6'); process.exit(1); }
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const shots = process.env.SHOT_DIR ?? './hardware-check';
const timeout = Number(process.env.CONNECT_TIMEOUT_MS ?? 45000);
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('DeviceAccess.enable');
const seen = new Set();
cdp.on('DeviceAccess.deviceRequestPrompted', async (ev) => {
  for (const d of ev.devices) seen.add(d.name);
  const want = ev.devices.find((d) => d.name === name);
  // no match yet: the chooser fills in as the scan finds units, wait for the next update
  if (want) await cdp.send('DeviceAccess.selectPrompt', { id: ev.id, deviceId: want.id }).catch(() => undefined);
});

const out = { target: name, chooserSaw: [], errors };
await page.goto(base);
out.bluetoothApi = await page.evaluate(() => 'bluetooth' in navigator);
await page.getByRole('button', { name: 'Connection', exact: true }).click();
await page.getByRole('button', { name: 'Connect', exact: true }).click();
try {
  await page.getByRole('status').filter({ hasText: 'Streaming' }).waitFor({ timeout });
} catch {
  out.result = 'NOT CONNECTED';
  out.pill = await page.getByRole('status').innerText();
  out.chooserSaw = [...seen];
  out.hint = 'A unit accepts one BLE client. Close other Chrome tabs or tools connected to it.';
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(12000);
const pairs = (sel) => page.locator(sel).evaluateAll((els) => Object.fromEntries(els.map((e) => [e.children[0].textContent, e.children[1].textContent])));
out.connection = await pairs('.info-line');
out.banners = await page.locator('.mode-banner').allInnerTexts();
await page.screenshot({ path: join(shots, 'connection.png') });
await page.getByRole('button', { name: 'Overview', exact: true }).click();
await page.waitForTimeout(1500);
out.overview = { tile: await page.locator('.tile-value').innerText(), metrics: await page.locator('.metric-grid').innerText(), status: await page.locator('.status-panel').innerText() };
await page.screenshot({ path: join(shots, 'overview.png') });
await page.getByRole('button', { name: 'Live', exact: true }).click();
await page.waitForTimeout(1500);
out.live = await pairs('.info-cell');
await page.screenshot({ path: join(shots, 'live.png') });
await page.getByRole('button', { name: 'Connection', exact: true }).click();
await page.getByRole('button', { name: 'Disconnect' }).click();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Sessions', exact: true }).click();
await page.waitForTimeout(1500);
out.sessions = await page.locator('table.session-table tbody tr').allInnerTexts();
out.databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
out.result = 'CONNECTED';
console.log(JSON.stringify(out, null, 1));
await browser.close();
