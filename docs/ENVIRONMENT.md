# Environment configuration

The dashboard (`fedfront/`) has one switch: which engine it runs. Everything else is fixed in code or saved in the device profile (Settings screen).

## Variables

| Variable | Values | Default | Effect |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_ENGINE` | unset, `device`, `mock` | unset (= `device`) | `device`: the real engine (Web Bluetooth, Web Worker, IndexedDB `force`). `mock`: the same engine pipeline fed by the packet simulator, on IndexedDB `force-mock`, with a "Mock engine" banner and a fault-injection panel. Any other value stops `next dev` and `next build` with an error. |
| `FORCE_ALLOW_MOCK_BUILD` | `1` | unset | `next build` refuses `NEXT_PUBLIC_ENGINE=mock` unless this is `1`. Only for a deliberately labelled demo build. |
| `NEXT_PUBLIC_CLOUD_SYNC_URL` | unset, `/api/sync/v1`, or `http://127.0.0.1:8787/api/sync/v1` | unset (cloud sync off) | Firestore cloud sync through the local sync agent. Not a secret. Ignored in mock mode. The agent's own settings live in `.env.cloud` at the repository root; see FIREBASE_SETUP.md. |
| `NEXT_PUBLIC_DATA_SOURCE` | unset, `cloud` | unset (local dashboard) | `cloud`: the public hosted build. The page reads stored values from Firestore over REST (no Bluetooth, no engine, no local database). Needs `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. Not a secret. Unset: the local dashboard, unchanged. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project id | unset | Cloud viewer only. Public value, not a secret. A cloud build without it shows a configuration error. |
| `NEXT_PUBLIC_PUBLIC_DEVICE_ID` | device id, for example `FORCE-71B6` | unset (first device in `devices`) | Cloud viewer only. Which device to show. |
| `E2E_MODE` / `E2E_CLOUD_PORT` | `cloud` / port | unset / `3300` | `playwright test tests/cloud-viewer.cloud.spec.ts --config playwright.config.ts` runs the cloud viewer spec on its own dev server with Firestore mocked. The default run skips `*.cloud.spec.ts`. |
| `E2E_PORT` | port | `3100` | Port of the dev server the mock-mode Playwright suite starts. |
| `STATIC_PORT` | port | `3200` | Port of the static server the production-export Playwright suite starts. |
| `CI` | any | unset | Playwright never reuses an already running server. |

For a public deployment leave `NEXT_PUBLIC_CLOUD_SYNC_URL` unset; `npm run hosting:config -w fedfront` fails (exit 1) when it is set, so a public build can never depend on a visitor's localhost. With `NEXT_PUBLIC_DATA_SOURCE=cloud` it adds `https://firestore.googleapis.com` to the CSP `connect-src`. See RELEASE_READINESS.md, "Public hosting".

Set them in the shell, or in `fedfront/.env.local` (git-ignored). `fedfront/.env.example` documents them.

## Data isolation

| Mode | IndexedDB | Session source | In device totals and history charts |
| --- | --- | --- | --- |
| Device, Connect (real sensor) | `force` | `device` | Yes |
| Device, Start Demo | `force` | `demo` | No |
| Device, Start Replay | `force` | `replay` | No |
| Restored backup | `force` | as in the file | Only if the file is a `device` session, and never twice (a backup of a session that is still stored is refused) |
| Mock (`NEXT_PUBLIC_ENGINE=mock`) | `force-mock` | `demo` | Never: separate database |

`getTotals` (the source of the Overview's today, yesterday, and history charts) counts `device` sessions only. Demo and replay sessions show in the Sessions list with their source and in the live view under a "Demo data" or "Replay data" banner.

## What is configured, measured or estimated

| Kind | Values | Where |
| --- | --- | --- |
| Measured | voltage, current, power (INA219 via BLE), energy (integrated in the engine), steps (detected from measured power), data quality | Live, Overview, Sessions |
| Configured (assumption until measured) | `minInputV` 1 V, `idleThresholdW`, `stepThresholdW`, `minStepGapMs`, `minPulseMs` | Settings, Calibration |
| Estimate (placeholder factor) | CO2 avoided (`emissionFactorKgPerKwh` 0.475), LED hours, phone charges | Overview (labelled "Placeholder factor", under the "(Est.)" title) |
| Placeholder (not a result) | Sustainability score (weights and targets not agreed) | Overview (labelled "Placeholder formula") |
| Not supported | Multi-tile floor map (no multi-tile API; one sensor) | The Overview shows the single tile |

