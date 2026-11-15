import { test, expect } from '@playwright/test';

test('overview, live, connection and settings flows work with the mock engine', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible();
  await page.getByRole('tab', { name: '5 minutes' }).click();
  await expect(page.getByRole('tab', { name: '5 minutes' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start Demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Brand expansion')).toHaveValue('Flooring Optimised for Renewable Clean Energy');
});
