# F.O.R.C.E (Florix Energy)

Footstep energy monitor: ESP32 firmware reads an INA219 at 20 Hz and streams 15-byte packets over BLE; the browser dashboard decodes them, computes energy and steps, stores sessions locally and shows them.

## Architecture

```
ESP32 + INA219 (firmware/)            BLE notify, 15-byte packet (packages/protocol)
        |
Browser: fedfront (Next.js static export, the UI)
        |  engine/index.ts: the only place an engine is created
        v
@force/worker   DashboardEngine facade (main thread: connection state, BLE source)
        |  postMessage
        v
Web Worker      @force/engine (decode, sessions, energy, steps, alerts, ESG)
                @force/storage (IndexedDB "force": sessions, raw chunks, minutes, steps, gaps, profile)
```

- Types: `@force/contracts` is the seam. The UI imports types from it and contains no metric calculation.
- Packages: `protocol`, `contracts`, `engine`, `simulator`, `device`, `storage`, `worker` (in `packages/`), `fedfront` (UI).
- Details: `docs/INTEGRATION.md`. Modes and data isolation: `docs/ENVIRONMENT.md`. Release status: `docs/RELEASE_READINESS.md`.

## Install (from the repo root only)

Node 20 or newer. One lockfile at the root installs every workspace, including the UI.

```
npm ci
```

## Run

| Goal | Command (repo root) |
| --- | --- |
| Dashboard, development, real engine | `npm run dev -w fedfront` then open http://localhost:3000 in Chrome or Edge |
| Dashboard, development, simulated hardware | PowerShell: `$env:NEXT_PUBLIC_ENGINE='mock'; npm run dev -w fedfront`; bash: `NEXT_PUBLIC_ENGINE=mock npm run dev -w fedfront` |
| Production build | `npm run web:build` (writes `fedfront/out/`) |
| Serve the production build | `node fedfront/scripts/serve-static.mjs fedfront/out 8080` then open http://127.0.0.1:8080 |
| Wireless monitor page (no build) | open `tools/ble_check.html` in Chrome |

Web Bluetooth needs Chrome or Edge, on `localhost`/`127.0.0.1` or HTTPS. Start Demo works in any browser.

## Check

| Scope | Command |
| --- | --- |
| Everything that CI runs for TypeScript | `npm run check:all` (generated protocol files, data layer, UI typecheck, lint, tests, build) |
| Data layer | `npm run check` |
| UI unit and integration tests | `npm run web:test` |
| Production static-site tests (after `web:build`) | `npm run web:e2e:static` |
| UI end-to-end and visual (mock mode) | `npm run web:e2e` |
| Firmware host tests | `pio test -d firmware -e native` |

First Playwright run: `npx playwright install chromium` in `fedfront/`.

CI: `.github/workflows/ci.yml` (jobs `backend`, `frontend`, `firmware`).
