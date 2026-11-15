import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Production static export (default real-engine mode, real Web Worker + IndexedDB "force").
 * SIMULATED data only: Start Demo feeds the packet simulator. Bluetooth needs hardware.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('defaults to the real engine with no mock data', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  await expect(page.getByText(/^Not connected ·/)).toBeVisible();
  await expect(page.getByText(/Mock engine/)).toHaveCount(0);
  await expect(page.locator('.dev-panel')).toHaveCount(0);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain('force-mock');
  expect(errors).toEqual([]);
});

test('demo streams through the worker, stays labelled and out of device analytics; backup restores once', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page.getByRole('button', { name: 'Start Demo' }).click();
  await expect(page.getByRole('status')).toHaveText(/Streaming/, { timeout: 15_000 });
  await expect(page.getByText(/Demo data · Simulated sensor stream/)).toBeVisible();

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('(Demo session)')).toBeVisible();
  // demo sessions never reach the stored device totals behind the history charts
  await expect(page.getByText('Recorded 0h 0m (stored)')).toHaveCount(0);

  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('status')).toHaveText(/Idle|Unsupported/);

  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  const rows = page.locator('table.session-table tbody tr');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export backup/ }).click();
  const file = await (await download).path();

  const restore = page.locator('label', { hasText: 'Restore backup' }).locator('input[type=file]');
  // the session is still stored: restoring its backup would double-count it
  await restore.setInputFiles(file);
  await expect(page.getByText(/already stored/)).toBeVisible();
  await expect(rows).toHaveCount(1);
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete session' }).click();
  await expect(page.getByText('No recorded sessions yet')).toBeVisible();
  await restore.setInputFiles(file);
  await expect(page.getByText(/Backup restored as session/)).toBeVisible();
  await expect(rows).toHaveCount(1);
  expect(errors).toEqual([]);
});
