import { test, expect } from '@playwright/test';

// Mock mode (simulated hardware through the real engine pipeline). Not hardware testing.
test('overview shows live data, health states and the fault state without faking readings', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Streaming/, { timeout: 15_000 });

  const health = page.getByRole('region', { name: 'Device health' });
  await expect(health.getByText('Connected')).toBeVisible();
  await expect(health.getByText('Sensor').locator('..').getByText('Normal')).toBeVisible();
  // the big chart replaced its waiting state with a real plot, and the real-time card shows a value
  await expect(page.locator('.ov-power canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Waiting for live data')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Real-time power output' }).locator('.rt-value')).not.toHaveText(/No live data|—/);
  // simulated data is labelled as such on every classified card
  await expect(page.getByText('(Demo session)')).toBeVisible();
  await expect(page.locator('.kpi .badge', { hasText: 'Simulated' }).first()).toBeVisible();

  // an injected sensor fault: health says Error and the card hides the reading
  await page.locator('#inject-fault').selectOption('sensor_fault');
  await expect(health.getByText('Sensor').locator('..').getByText('Error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Real-time power output' }).locator('.rt-value')).toHaveText('—');
});

test('mobile navigation drawer opens, navigates and closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const sidebar = page.locator('#app-sidebar');
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(sidebar).toBeVisible();
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection', exact: true, level: 1 })).toBeVisible();
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
