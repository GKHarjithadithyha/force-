import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// Cloud viewer build (E2E_MODE=cloud, see playwright.config.ts). Firestore REST is mocked at the
// network layer: no real project is contacted and no Bluetooth or local database is involved.
const FS = '**/firestore.googleapis.com/**';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const int = (n: number) => ({ integerValue: String(n) });
const dbl = (n: number) => ({ doubleValue: n });
const ts = (ms: number) => ({ timestampValue: new Date(ms).toISOString() });

function liveDoc(ageMs: number, connection = 'streaming') {
  const at = Date.now() - ageMs;
  return { name: 'projects/force-e2e/databases/(default)/documents/liveStatus/FORCE-71B6', fields: {
    deviceId: { stringValue: 'FORCE-71B6' }, connection: { stringValue: connection }, sessionId: { stringValue: 's' },
    sampleAt: ts(at), lastPacketAt: ts(at), measurementValid: { booleanValue: true }, inputPresent: { booleanValue: true }, generating: { booleanValue: true },
    measured: { mapValue: { fields: { voltageV: dbl(3.3), currentMa: dbl(12.5), powerW: dbl(4.2) } } },
    link: { mapValue: { fields: { rssiDbm: int(-61), sampleRateHz: int(10) } } },
    calculated: { mapValue: { fields: { sessionEnergyWh: dbl(1.25), totalEnergyWh: dbl(10.5), avgPowerW: dbl(3), peakPowerW: dbl(6), steps: int(42), cadenceSpm: dbl(88) } } },
    estimated: { mapValue: { fields: { co2AvoidedKg: dbl(0.005) } } },
    alerts: { arrayValue: {} },
  } };
}
const day = (date: string, steps: number, wh: number) => ({ document: { name: `x/dailySummaries/FORCE-71B6_${date}`, fields: { deviceId: { stringValue: 'FORCE-71B6' }, date: { stringValue: date }, dayStart: ts(Date.parse(`${date}T00:00:00Z`)), steps: int(steps), energyWh: dbl(wh), peakPowerW: dbl(6.5), sessions: int(3) } } });

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page: Page, live: (route: Route) => Promise<void>) {
  const hits = { live: 0, daily: 0 };
  await page.route(FS, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.url().includes('/liveStatus/')) { hits.live++; return live(route); }
    if (req.url().endsWith(':runQuery')) { hits.daily++; return json(route, 200, [day('2026-11-17', 120, 4.5), day('2026-11-16', 80, 3)]); }
    return json(route, 404, {});
  });
  return hits;
}

test('shows the stored live values, daily rows and a Live badge, with no Bluetooth or engine UI', async ({ page }) => {
  const hits = await mock(page, (r) => json(r, 200, liveDoc(5000)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Intelligent Dashboard' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Live/, { timeout: 15_000 });
  await expect(page.getByTestId('live-power')).toHaveText('4.2 W');
  const live = page.getByRole('region', { name: 'Live power' });
  await expect(live.getByText('3.3 V')).toBeVisible();
  await expect(live.getByText('12.5 mA')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Key metrics' });
  await expect(kpis.getByText('10.5 Wh')).toBeVisible();
  await expect(kpis.getByText('1.25 Wh')).toBeVisible();
  await expect(kpis.getByText('42', { exact: true })).toBeVisible();
  await expect(kpis.locator('.badge', { hasText: 'Estimate' })).toBeVisible();
  const table = page.getByRole('region', { name: 'Daily summaries' });
  await expect(table.getByRole('row')).toHaveCount(3); // header + 2 days
  await expect(table.getByRole('cell', { name: '2026-11-17' })).toBeVisible();
  await expect(page.getByText('Not connected')).toHaveCount(0);
  expect(hits.live).toBeGreaterThan(0);
  expect(hits.daily).toBeGreaterThan(0);
});

test('a stale document shows the Stale state, not Live', async ({ page }) => {
  await mock(page, (r) => json(r, 200, liveDoc(5 * 60_000)));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(/Stale/, { timeout: 15_000 });
  await expect(page.locator('.banner', { hasText: 'Stale' })).toBeVisible();
});

test('404 says No data yet', async ({ page }) => {
  await mock(page, (r) => json(r, 404, { error: { code: 404 } }));
  await page.goto('/');
  await expect(page.getByTestId('live-power')).toHaveText('No data yet', { timeout: 15_000 });
  await expect(page.locator('.banner', { hasText: 'No data yet' })).toBeVisible();
});

test('403 explains that the rules are not deployed', async ({ page }) => {
  await mock(page, (r) => json(r, 403, { error: { code: 403 } }));
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Cloud access not permitted (rules not deployed?)' })).toBeVisible({ timeout: 15_000 });
});

test('a server error keeps the last good values and shows the retry banner', async ({ page }) => {
  let n = 0;
  await mock(page, (r) => (++n === 1 ? json(r, 200, liveDoc(1000)) : json(r, 503, { error: { code: 503 } })));
  await page.goto('/');
  await expect(page.getByTestId('live-power')).toHaveText('4.2 W', { timeout: 15_000 });
  // the 15 s poll fails with 503: the value stays and the banner appears
  await expect(page.getByRole('alert').filter({ hasText: 'Connection problem, retrying' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('live-power')).toHaveText('4.2 W');
});
