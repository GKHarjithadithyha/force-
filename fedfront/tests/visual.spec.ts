import { test, expect } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';

test('overview visual baseline at reference canvas', async ({ page }) => {
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', (error) => console.error(error.message));
  await page.setViewportSize({ width: 2085, height: 1165 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  await page.waitForTimeout(1200);
  await mkdir('docs/compare', { recursive: true });
  await page.screenshot({ path: 'docs/compare/overview.png', fullPage: false });
  await copyFile('Screenshot 2026-11-15 144608.png', 'docs/compare/reference.png');
});

test('dashboard remains usable at tablet and mobile widths', async ({ page }) => {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    const contentWidth = await page.locator('body').evaluate((element) => element.scrollWidth);
    expect(contentWidth, `page content is ${contentWidth}px wide at a ${width}px viewport`).toBeLessThanOrEqual(width);
  }
});
