# F.O.R.C.E Dashboard: Final Technology Stack

Date: 15 November 2026
Status: Final for build start. Companion to the Product Requirements Document and the System Architecture Document.

## 1. Summary

The dashboard is a browser app that reads the ESP32 over Bluetooth Low Energy (Web Bluetooth), calculates every metric in the browser, stores history on the user's device and draws it with ECharts. Version 1 has no backend. A cloud backend (Supabase) is added only in Phase 3, when several tiles or shared history are needed.

"v1" means needed from the start. "P3" means Phase 3 only.

## 2. Frontend

| Layer | Technology | Why it is used | When |
| --- | --- | --- | --- |
| Framework | Next.js (App Router), static export (`output: 'export'`) | Main app served as static files; ready for server features later | v1 |
| UI library | React | Reusable interface components | v1 |
| Language | TypeScript (strict mode) | Type safety on packet layouts and metric units | v1 |
| Styling | Tailwind CSS | Responsive layout from tablet to wide screen | v1 |
| Component library | shadcn/ui | Cards, buttons, dialogs, tabs, tables | v1 |
| Icons | Lucide React | Consistent interface icons | v1 |
| Charts | Apache ECharts | Power and energy charts, rings, gauges, floor-plan heatmap | v1 |
| Chart integration | echarts-for-react | ECharts inside React | v1 |
| Live state | Zustand | Screens subscribe to small slices of live data | v1 |
| Validation | Zod | Settings, imported CSV and JSON files, later API data | v1 |
| Date formatting | date-fns | Timestamps, hourly grouping, reporting periods | v1 |
| Installable app | Serwist (PWA service worker) | Offline start; install on desktop and Android | v1 |
| Server state | TanStack Query | Caching, loading and refetching cloud data | P3 |
| API communication | Native fetch | REST calls to the backend | P3 |
| Live server updates | Supabase Realtime (or native WebSocket) | Multi-tile live view | P3 |

Rules for this layer:
- All Bluetooth and worker code lives in client components (`"use client"`). Nothing that touches Bluetooth runs on a server.
- Zod validates files and settings only. The packet decoder is hand-written for speed.
- The live power chart uses ECharts large-data mode with downsampling. If one hour of data at 50 samples per second stutters on a mid-range laptop or phone, replace only that chart with uPlot; the rest stays on ECharts.

## 3. Device and data layer (runs in the browser)

| Layer | Technology | Why it is used | When |
| --- | --- | --- | --- |
| Device link | Web Bluetooth API | Reads ESP32 packets with no app install or gateway; Chrome and Edge only | v1 |
| Calculation | Web Worker with plain TypeScript functions | Decoder, energy, step detector and ESG metrics off the UI thread; easy to unit test | v1 |
| Local database | IndexedDB through Dexie | Holds hours of samples and session history on the device | v1 |
| Packet simulator | TypeScript module | Demo mode, tests and replay without hardware | v1 |
| Export and import | CSV and JSON | Reports, backups, regression recordings | v1 |

## 4. Backend and cloud (Phase 3)

| Layer | Technology | Why it is used | When |
| --- | --- | --- | --- |
| Backend and sign-in | Supabase (Postgres, Auth, Realtime) | Fastest path to accounts, sites and shared history | P3 |
| Custom API, only if needed | FastAPI or NestJS | Logic that Supabase cannot hold | P3 |
| Time-series storage | Postgres tables of minute buckets (TimescaleDB if volume grows) | Upload sessions, steps and buckets, not raw samples | P3 |
| File storage | Supabase Storage | Floor-plan images | P3 |
| Site gateway | ESP32 or Raspberry Pi forwarding over Wi-Fi | Many tiles on one floor; Web Bluetooth does not scale to that | P3, if needed |

## 5. Quality, delivery and hosting

| Layer | Technology | Why it is used |
| --- | --- | --- |
| Unit and component tests | Vitest + React Testing Library | Formulas checked against hand calculations (energy within 0.1%); component tests |
| End-to-end tests | Playwright | Connect, stream, reconnect and export flows against the simulator |
| Code quality | ESLint + Prettier | Consistent code |
| Version control | Git + GitHub | Source management and pull requests |
| CI | GitHub Actions | Type check, lint, tests and build on every push |
| Package manager | npm | Dependency management |
| Hosting | Vercel, Netlify or Cloudflare Pages | Static HTTPS, which Web Bluetooth requires; preview URL per pull request |

## 6. Decisions made

| Decision | Choice | Reason |
| --- | --- | --- |
| Charts | ECharts for all charts, uPlot only if the live chart fails the performance budget | One library covers every panel in the dashboard mock-up, including the heatmap |
| Phase 3 backend | Supabase | Auth, database and realtime in one service; a custom API can be added beside it |
| Backend in v1 | None | The ESP32 is the only data source; history stays on the device |
| Browser support | Chrome and Edge on desktop, Chrome on Android | Web Bluetooth limit; other browsers get an unsupported message and demo mode |

## 7. Build order

1. Phase 0: Next.js app skeleton, packet simulator, Bluetooth source and decoder, Connect screen.
2. Phase 1: worker pipeline, calculation engine (M1 to M12), live chart and tiles, Dexie storage, sessions, calibration, reconnect, CSV export.
3. Phase 2: settings profile, connection screen, alerts, ESG panel and score, session comparison, demo mode.
4. Phase 3: several tiles, floor-plan heatmap, Supabase sync.

## 8. Still open (does not block Phase 0)

- Service and characteristic UUIDs and the exact packet format, from the ESP32 firmware that is already written. The parser follows the firmware if it differs from the proposed contract.
- Sustainability score formula, grid emission factor and wellness definition.
- Whether iPhone or iPad support is required (it would add a wrapped native app).
