# Release readiness (software)

Status as of 2026-11-16. Software only: no hardware was used for any result here. Hardware validation (M11 load measurement) is a separate milestone, see `docs/LOAD_VALIDATION.md`.

## Test report

| Suite | Command | Data | Result |
| --- | --- | --- | --- |
| Generated protocol files fresh | `npm run check:generated` | n/a | pass |
| Data layer typecheck, lint, format | `npm run check` | n/a | pass |
| Data layer tests (protocol, engine, simulator, device, storage, worker, BLE page) | `npm test` | simulated | 289 / 289 pass, 20 files |
| Firmware host tests | `pio test -d firmware -e native` | synthetic | 43 / 43 pass |
| UI typecheck and lint | `npm run web:typecheck`, `npm run web:lint` | n/a | pass |
| UI unit and mock-engine integration (incl. backup and restore, config modes, DB isolation, day boundaries, decimation, chart batching) | `npm run web:test` | simulated | 17 / 17 pass, 4 files |
| Production build (real-engine mode) | `npm run web:build` | n/a | pass; `/` 86 kB, 191 kB first load |
| Production build refused in mock mode | `NEXT_PUBLIC_ENGINE=mock npm run web:build` | n/a | refused, as intended |
| Production static-site tests (real engine and real Web Worker, Start Demo; default mode, no mock DB, demo kept out of device analytics, backup export, duplicate restore refused, restore after delete) | `npm run web:e2e:static` | simulated | 2 / 2 pass |
| E2E and visual, mock mode (flows; 1440, 1024 and 390 px without horizontal scroll) | `npm run web:e2e` | simulated | 3 / 3 pass |
| Real-engine mode under `next dev` (Start Demo through the dev-bundled worker) | ad-hoc Playwright run | simulated | streaming, no page errors |
| Clean install from the root on a fresh copy (no `node_modules`) | `npm ci && npm run check:all` | simulated | pass: 690 packages; 289 data-layer tests, 17 UI tests, lint, typecheck and production build all green |

**Hardware-dependent, not part of this report:** BLE connect from the dashboard to the ESP32 (verified earlier with `tools/ble_check.html` in Chrome, DECISIONS H-24), accuracy against a multimeter, shunt value, real `minInputV`, real step thresholds.

## Data integrity audit

| Area | Finding | Action |
| --- | --- | --- |
| Session calculations | All in `@force/engine` (integer energy, step detection, alerts). The UI computes none: it formats, picks what to show, and downsamples the chart for display. | none |
| Imported sessions | **Defect:** restoring a backup of a session that was still stored created a second copy; device totals counted it twice. | Fixed in `Store.importSessionJson`: refused with "already stored". Tests in storage, worker host, UI and the static suite. |
| Duplicate sessions | Live sessions get unique ids; a different session sharing an id still gets an `-importN` suffix and is never overwritten. | covered by tests |
| Daily, weekly, monthly aggregation | `getTotals` sums stored minute buckets and steps of `device` sessions only. The UI asks for local-day bounds; buckets tile the range with no gap or overlap. | test added |
| Time zones and DST | Bounds are local midnights built with `setDate` (DST safe); minute buckets are UTC minutes, so any offset (including 30 and 45 min) aligns. On a DST change day the "Today" hourly buckets are 1 h each from local midnight, so one label is shifted for that day only; totals are unaffected. | documented |
| Energy accumulation | Integer doubled-nJ trapezoid in the engine; gaps over 1 s excluded; tested in the data layer. | none |
| Backup and restore | Round trip rebuilds energy, steps, gaps and recorded time exactly from the raw samples; bad files rejected with a plain message. | tests extended |
| Profile migration | Old profiles and backups are completed with defaults (`withProfileDefaults`); tested. The UI-only brand text moved out of the profile to browser storage. | none |
| Invalid and stale measurements | Engine flags `measurementValid` and `inputPresent`; the UI shows a dash for power, voltage and current unless streaming a valid measurement with input present, and keeps the raw value on Connection as a diagnostic. | tested |
| Disconnection | The engine ends the session and keeps it; the running session cannot be deleted. | none |
| Demo and replay | Stored with their source, excluded from totals, labelled in the UI. Mock mode uses a separate database. | tests added |

## Placeholders and assumptions shown in the UI

- CO2 avoided: emission factor 0.475 kg/kWh is a placeholder. Labelled "Estimate · placeholder emission factor".
- Sustainability score: weights and targets not agreed. Labelled "Placeholder formula · not agreed, not a result".
- `minInputV` 1 V: an assumption until measured on the generator. Labelled in Settings and Calibration.
- Step and idle thresholds: placeholders until calibrated on the real tile.
- Multi-tile floor map: not supported (no multi-tile API, one sensor). The Overview shows the single tile; nothing simulates more tiles.

## Known limitations

- Not a git repository yet: CI (`.github/workflows/ci.yml`) is written but has never run on GitHub.
- Hardware validation (M11) not done: accuracy, shunt value and thresholds are unverified.
- `next lint` is deprecated in Next 15.5 (still works; migrate to the ESLint CLI before Next 16).
- npm 11 lists `esbuild` install scripts as not approved; the prebuilt binaries install as optional packages and every check passes.
- The Overview chart row sits about 35 px lower than the original reference because the metric cards gained a provenance line and System Status gained the Power Input row.
- Web Bluetooth needs Chrome or Edge on `localhost` or HTTPS.

