import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Mock mode (simulated hardware). Theme behaviour and colour quality only.
const SCREENS = ['Overview', 'Live', 'Sessions', 'Connection', 'Calibration', 'Settings'];
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

/** WCAG contrast of the given elements' text against their effective (composited) background. */
async function contrastReport(page: Page, selectors: string[]) {
  return page.evaluate((sels) => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
    const over = (top: RGBA, bottom: RGBA): RGBA => { const a = top[3] + bottom[3] * (1 - top[3]); return a === 0 ? [0, 0, 0, 0] : [(top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a, (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a, (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a, a]; };
    const lum = ([r, g, b]: RGBA) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const background = (el: Element): RGBA => { let bg: RGBA = [0, 0, 0, 0]; for (let n: Element | null = el; n; n = n.parentElement) { bg = over(bg, parse(getComputedStyle(n).backgroundColor)); if (bg[3] >= 0.99) break; } return bg[3] >= 0.99 ? bg : over(bg, parse(getComputedStyle(document.body).backgroundColor)); };
    const out: Array<{ sel: string; text: string; ratio: number }> = [];
    for (const sel of sels) {
      const el = [...document.querySelectorAll(sel)].find((e) => (e as HTMLElement).offsetParent !== null && (e.textContent ?? '').trim());
      if (!el) { out.push({ sel, text: 'NOT FOUND', ratio: 0 }); continue; }
      const fg = parse(getComputedStyle(el).color); const bg = background(el);
      const text = over(fg, bg); const L1 = lum(text) + 0.05; const L2 = lum(bg) + 0.05;
      out.push({ sel, text: (el.textContent ?? '').trim().slice(0, 24), ratio: Math.round((Math.max(L1, L2) / Math.min(L1, L2)) * 100) / 100 });
    }
    return out;
  }, selectors);
}

/** Elements with an opaque dark background: remnants of the dark theme in light mode. */
async function darkRemnants(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    document.querySelectorAll('.app-shell *').forEach((el) => {
      if (el.matches('.connection-dot, .state-dot') /* status dots are intentionally coloured */ || el.closest('.dev-panel') || el.closest('canvas') || el.closest('.session-table') && el.tagName === 'TR') return;
      const bg = parse(getComputedStyle(el).backgroundColor);
      if (bg && bg.a > 0.6 && (bg.r + bg.g + bg.b) / 3 < 110) out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]} rgb(${bg.r},${bg.g},${bg.b})`);
    });
    return [...new Set(out)];
  });
}

// Gradient-filled controls (.range-tab.selected, .primary-action) cannot be measured by background colour; white on the purple gradient is >= 5:1 by token choice.
// Optional selectors (comparison line, green badge) only exist for some data and are skipped when absent.
const TEXT_CHECKS = ['.page-title', '.page-subtitle', '.panel-title', '.kpi-label', '.kpi-value', '.kpi-compare', '.kpi-note', '.badge-good', '.badge-warn', '.badge-info', '.state-pill.state-good', '.state-pill.state-muted', '.health-label', '.rt-hint', '.nav-item:not(.active)', '.nav-item.active', '.banner', '.connection-pill', '.range-tab:not(.selected)', '.clock-date', '.footer-mark'];
const OPTIONAL = new Set(['.kpi-compare', '.badge-good']);

test('dark is the default and the toggle switches, persists and survives a reload without a flash', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  expect(await theme(page)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(8, 11, 20)');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  expect(await theme(page)).toBe('light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(244, 245, 250)');
  expect(await page.evaluate(() => localStorage.getItem('force.theme'))).toBe('light');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

  // reload: the attribute is already set when the document is parsed (before React hydrates)
  await page.reload({ waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded');
  expect(await theme(page)).toBe('light');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  expect(await theme(page)).toBe('dark');
  await page.reload();
  expect(await theme(page)).toBe('dark');
});

test('a blocked or invalid stored preference falls back to dark', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('force.theme', 'purple-haze'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  expect(await theme(page)).toBe('dark');
});

for (const mode of ['dark', 'light'] as const) {
  test(`every screen is readable and consistent in the ${mode} theme`, async ({ page }) => {
    await page.addInitScript((m) => localStorage.setItem('force.theme', m), mode);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText(/Streaming/, { timeout: 15_000 });
    expect(await theme(page)).toBe(mode);
    await page.waitForTimeout(1500);

    const low = (await contrastReport(page, TEXT_CHECKS)).filter((r) => r.ratio < 4.5 && !(r.text === 'NOT FOUND' && OPTIONAL.has(r.sel)));
    expect(low, `low contrast on Overview (${mode}): ${JSON.stringify(low)}`).toEqual([]);
    for (const name of SCREENS) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(400);
      if (mode === 'light') expect(await darkRemnants(page), `dark remnants on ${name}`).toEqual([]);
      const generic = (await contrastReport(page, ['.page-title', '.utility-screen h2', '.info-line strong', '.info-cell strong', '.field-label', '.session-table th', '.secondary-action', '.empty-state strong', '.text-field'])).filter((r) => r.text !== 'NOT FOUND' && r.ratio < 4.5);
      expect(generic, `low contrast on ${name} (${mode}): ${JSON.stringify(generic)}`).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
