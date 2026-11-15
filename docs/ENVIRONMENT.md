# Environment configuration

The dashboard (`fedfront/`) has one switch: which engine it runs. Everything else is fixed in code or saved in the device profile (Settings screen).

## Variables

| Variable | Values | Default | Effect |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_ENGINE` | unset, `device`, `mock` | unset (= `device`) | `device`: the real engine (Web Bluetooth, Web Worker, IndexedDB `force`). `mock`: the same engine pipeline fed by the packet simulator, on IndexedDB `force-mock`, with a "Mock engine" banner and a fault-injection panel. Any other value stops `next dev` and `next build` with an error. |
| `FORCE_ALLOW_MOCK_BUILD` | `1` | unset | `next build` refuses `NEXT_PUBLIC_ENGINE=mock` unless this is `1`. Only for a deliberately labelled demo build. |
| `E2E_PORT` | port | `3100` | Port of the dev server the mock-mode Playwright suite starts. |
| `STATIC_PORT` | port | `3200` | Port of the static server the production-export Playwright suite starts. |
| `CI` | any | unset | Playwright never reuses an already running server. |

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

