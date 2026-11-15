# F.O.R.C.E Dashboard: Frontend Specification and Tech Stack

Date: 15 November 2026
Audience: the developer (or code agent) building the frontend only.
Companion documents: Product Requirements Document (PRD), System Architecture Document, Tech Stack, and the design reference image "Intelligent Dashboard".
Precedence: the PRD decides what the product does. This document decides what the frontend looks like and how it is built. Where the design image shows something the PRD or hardware cannot supply, section 4 says what to do instead.

## 1. Scope

The frontend is everything the user sees: layout, screens, charts, tiles, settings forms, banners and the export buttons. It displays values and never calculates them.

Another developer builds, in parallel, the device and data layers: Bluetooth, packet decoding, the calculation engine, local storage and export files. The frontend talks to them only through one typed interface (section 7). Until the real engine exists, the frontend runs on a mock engine that emits plausible data.

In scope: Next.js app, all six screens, charts, floor-plan heatmap component (built now, shown in Phase 3), settings and calibration UI, unsupported-browser state, demo and replay banners, responsive layout, accessibility, frontend tests.
Out of scope: Web Bluetooth, packet decoding, any metric formula, IndexedDB, Web Worker, backend, REST calls.

## 2. Frontend tech stack

| Layer | Technology | Why it is used |
| --- | --- | --- |
| Framework | Next.js (App Router), static export (`output: 'export'`) | Main app served as static files over HTTPS; ready for server features in Phase 3 |
| UI library | React | Reusable interface components |
| Language | TypeScript (strict) | Type safety against the shared contract |
| Styling | Tailwind CSS with design tokens in CSS variables | Fast, consistent dark theme; tokens in section 3 |
| Components | shadcn/ui (Radix based) | Cards, buttons, dialogs, tabs, tables, tooltips, switches, selects |
| Icons | Lucide React | Consistent line icons that match the reference |
| Charts | Apache ECharts + echarts-for-react | Area, bar, gauge, ring and line charts with a dark theme |
| Floor-plan heatmap | Custom React SVG component | Hexagonal tile grid coloured by value; ECharts has no hex-grid series |
| UI and live state | Zustand | Subscribes to engine callbacks, exposes small selectors to screens |
| Validation | Zod | Settings form input and imported files |
| Dates and times | date-fns | Clock, hour and day grouping, report periods |
| Fonts | next/font with Inter (or the brand font if supplied) | No layout shift, self-hosted |
| Installable app | Serwist (PWA service worker) | Offline start, install on desktop and Android |
| Component workshop | Storybook (recommended) | Build and review every component against mock data without the engine |
| Unit and component tests | Vitest + React Testing Library | Component behaviour, formatters, selectors |
| End-to-end tests | Playwright | Screens, navigation, banners, responsive checks against the mock engine |
| Code quality | ESLint + Prettier | Consistent code |
| Version control, CI | Git + GitHub, GitHub Actions | Type check, lint, tests, build on every push |
| Package manager | npm | Dependencies |
| Hosting | Vercel, Netlify or Cloudflare Pages | Static HTTPS preview per pull request |

Added only in Phase 3: TanStack Query, native fetch and WebSocket (or Supabase Realtime) for cloud data.
Do not add: Redux, a second chart library (unless the live chart fails the performance budget in section 9), CSS-in-JS libraries, or any UI kit besides shadcn/ui.

## 3. Design reference analysis

The reference is a dark, high-contrast control-room dashboard with a purple accent. Match its structure and mood. Colours below are estimates taken from the image; confirm against the original design file if one exists.

**Layout.** Fixed left sidebar (logo, six navigation items, decorative hexagon art and "Florix Energy, Empower The World" at the bottom). Main area: title "Intelligent Dashboard" with a one-line subtitle, clock and date at the top right with a status pill. Below: a large map panel on the left, a column of Key Metrics tiles and System Status on the right, and three chart panels in a row at the bottom.

**Design tokens (starting values).**

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0A0A12` | Page background |
| `--panel` | `#11111C` | Cards and panels |
| `--panel-border` | `#23233A` | 1 px panel borders |
| `--sidebar-active` | `#3B2A7A` to `#5B3FD6` gradient | Selected nav item |
| `--accent` | `#8B5CF6` | Primary accent, active tabs, live dot |
| `--accent-2` | `#C026D3` | Heatmap and chart highlights |
| `--accent-soft` | `#A78BFA` | Chart lines and fills |
| `--text` | `#F4F4F8` | Headings and values |
| `--text-muted` | `#9A9AB5` | Labels and axis text |
| `--good` | `#22C55E` | Online, active, positive change |
| `--warn` | `#F59E0B` | Stale, reconnecting, low sample rate |
| `--bad` | `#EF4444` | Error, sensor fault, limit reached |

Radius 12 to 16 px on panels, 8 px on buttons and pills. Panel titles 16 to 18 px semibold, big numbers 28 to 36 px bold, labels 12 to 13 px muted. Chart areas use a purple gradient fill under a 2 px line, faint horizontal grid lines, axis text in muted colour. Positive change shown as a green up arrow with percentage and the text "vs. yesterday".

**Accessibility.** WCAG 2.1 AA contrast for all text (check `--text-muted` on `--panel`). Colour is never the only signal: every status has an icon and a word. Heatmap has a legend. Keyboard navigation and visible focus rings. Respect `prefers-reduced-motion`.

## 4. Adapting the reference to the real product

The reference was drawn for a 27-tile floor. The prototype is one tile with six modules, one sensor and no battery. Build the reference look, but change the content as follows.

| Reference element | In version 1 | Reason |
| --- | --- | --- |
| Live Floor Map, 27 hexagonal tiles | Build the heatmap component now, driven by a `tiles` array. Show it only when more than one tile exists (feature flag `multiTile`). In v1 the same slot shows a "Tile" panel: one large hexagon coloured by current power, with power, steps and status. | One tile has one sensor, nothing to compare (PRD, phase 3) |
| Key Metrics: Total Energy Generated | Keep. Auto-scale units (mWh, Wh, kWh). | A tile produces far less than 1.28 kWh; never hard-code the unit |
| Key Metrics: Total Footsteps | Keep | Steps from the step detector |
| Key Metrics: CO2 Offset (Est.) | Keep, label "Est." | Calculated from the emission factor in settings |
| Key Metrics: Energy Storage Level 68% Charging | Replace with Sustainability Score (0 to 100) | The sensor is after the rectifier, so there is no battery data |
| System Status: Total Tiles 27 / 27 | "Tiles 1 / 1" with state | One tile in v1 |
| System Status: Power Conditioning, System Temperature | Remove | No such sensors |
| System Status: Data Connection Online | Keep, driven by connection state, plus Sensor (OK or fault) and Signal strength when available | PRD metrics M17, M19 |
| Sidebar: Dashboard | Overview | PRD screen |
| Sidebar: Live Monitoring | Live | PRD screen |
| Sidebar: Tile Analytics | Sessions (history, comparison) | PRD screen |
| Sidebar: Energy Storage | Remove | No battery data |
| Sidebar: System Health | Connection (state, signal, sample rate, gaps, device info, event log) | PRD screen |
| Sidebar: Export Data | Keep as an action and a section inside Sessions | CSV and JSON export |
| (not in the reference) | Add Calibration and Settings to the sidebar | Required by the PRD |
| Header "System Online" | Connection pill: Streaming, Stale, Reconnecting, Connecting, Idle, Error, Demo, Replay | Architecture section 11 |
| Bottom charts: Power Output, Energy Generated, Foot Traffic | Keep all three | See section 5 |
| Chart scales in the image (2.5 W, 200 Wh) | Auto-scale to the data | Sample figures only. The sensor reads at most about 83 W |

Open question for the founder: the reference reads "Flooring Optimised for Renewable Clean Energy" under the logo, while the PRD says "Footstep Operated Renewable Conversion Engine". Use a single configurable constant for the expansion text until one is chosen.

## 5. Screens

### 5.1 Overview (default)
Layout follows the reference.
- Header: title, subtitle, live clock and date, connection pill.
- Tile panel (or floor map when `multiTile`): current power, steps today, status.
- Key Metrics (today): Total Energy Generated, Total Footsteps, CO2 Offset (Est.), Sustainability Score. Each with the change versus yesterday when yesterday has data; otherwise no arrow.
- System Status: Tiles, Data Connection, Sensor, Signal strength.
- Bottom row: Power Output (real-time) with a Live badge, Energy Generated with Today / Week / Month tabs (bars), Foot Traffic with Today / Week / Month tabs (steps per hour as an area chart).
- Next to each total, show recorded time and any gap time (data-quality line from the contract), so lost data is never hidden.
- Must read from about 2 metres: big numbers, high contrast; include a fullscreen / kiosk mode button that hides the sidebar.

### 5.2 Live
- Large real-time power chart with window selector (30 seconds, 5 minutes, 1 hour). Step markers on the line, gaps shaded and labelled, idle and step thresholds as faint lines.
- Voltage and current charts or mini sparklines, and the current generation state (Generating or Idle).
- Tiles: power, voltage, current, peak power, cadence, energy per step, session energy.

### 5.3 Sessions
- List of sessions: start, duration, source (Device, Demo, Replay), energy, peak power, steps, data-quality line, status (open, closed, interrupted).
- Select one to open its charts; select two to compare.
- Actions: export CSV, export JSON, recompute with current settings, delete all data (with a confirmation dialog).

### 5.4 Calibration
- Live power chart with the idle threshold, step threshold and half-threshold drawn as lines, and step markers shown as the engine detects them.
- Controls for thresholds and minimum step gap; a "count my steps" helper where the user taps the number of real steps and sees detected versus actual.
- Warning when the measured sample rate is below 20 per second.

### 5.5 Connection
- Connect and Disconnect buttons (Connect only from a click). Connection state with colour, icon and text; reconnect countdown (60 seconds).
- Device Info (name, ID, firmware, sample rate, sensor current limit), signal strength, measured packets per second, lost and dropped packet counts, recent connection events.
- Unsupported-browser state: "Use Chrome or Edge" message, Connect disabled, Start Demo offered.
- Demo and Replay start controls and a file picker for replay.

### 5.6 Settings
Form (Zod validated) for the device profile: idle threshold, step threshold, minimum step gap, grid emission factor, reference LED watts, phone battery Wh, kcal per step (optional), sustainability score weights and targets, sensor limit override, display units, brand expansion text. Save and reset-to-defaults. Storage status and retention setting if the engine exposes them.

### 5.7 Global elements
- Persistent banner "Demo" or "Replay" whenever the source is not the real unit.
- Alerts area for engine alerts (sensor limit reached, low sample rate, storage warning, hidden tab).
- Empty, loading and error states for every panel. Values dim when the connection is Stale.

## 6. Components

Build these once and reuse them. Each gets a Storybook story with mock data.

| Component | Purpose |
| --- | --- |
| `AppShell`, `Sidebar`, `Header` | Layout, navigation, clock, connection pill |
| `ConnectionPill` | State to colour, icon and text |
| `MetricCard` | Icon, label, value, unit, change versus yesterday, data-quality hint |
| `StatusRow` | Label, value, dot and text status |
| `TilePanel` | Single-tile hexagon with power, steps, status |
| `HexHeatmap` | Hexagonal grid from a `tiles` array (position, value, status), colour scale with legend, hover tooltip; ready for Phase 3 |
| `LivePowerChart` | ECharts area chart fed by chart batches; step markers, gap shading, threshold lines |
| `EnergyBarChart`, `FootTrafficChart` | Today / Week / Month tabs |
| `RangeTabs` | Today, Week, Month and window selectors |
| `GapShade`, `StepMarker` | Chart overlays |
| `SessionTable`, `SessionCompare` | History |
| `DeviceInfoCard`, `PacketStats` | Connection screen |
| `ThresholdEditor` | Calibration controls |
| `SettingsForm` | Profile form |
| `Banner`, `AlertList`, `EmptyState`, `ErrorState` | Global feedback |
| `UnsupportedBrowser` | Message plus demo button |
| `format` utilities | Auto-scale units: mW or W, mWh or Wh or kWh, g or kg CO2, durations |

## 7. The seam: how the frontend gets data

The frontend imports only the shared `contracts` package (types and the `DashboardEngine` interface). It never imports Bluetooth, storage or calculation code.

```ts
export type ConnectionState = 'unsupported'|'idle'|'choosing'|'connecting'|'streaming'|'stale'|'reconnecting'|'error';
export type SourceKind = 'device'|'demo'|'replay';
export interface DeviceInfo { deviceId: string; name: string; firmwareVersion: string; sampleRateHz: number; sensorLimitMa: number }
export interface LiveSnapshot { t: number; source: SourceKind; connection: ConnectionState; sessionId: string|null;
  metrics: { voltageV: number; currentMa: number; powerW: number; generating: boolean; sessionEnergyJ: number; sessionEnergyWh: number; totalEnergyWh: number; avgPowerW: number; peakPowerW: number; steps: number; cadenceSpm: number|null; energyPerStepJ: number|null; stepsPerHour: Record<string, number>; co2AvoidedKg: number; ledHours: number; phoneCharges: number; kcal: number|null; sustainabilityScore: number|null; rssiDbm: number|null; sampleRateHz: number; sensorLimitReached: boolean };
  quality: { recordedMs: number; bridgedMs: number; excludedGapMs: number; lostPackets: number; droppedPackets: number }; alerts: Alert[] }
export interface ChartBatch { times: Float64Array; powerW: Float64Array; voltageV: Float64Array; currentMa: Float64Array }
export interface StepEvent { t: number; peakW: number; durationMs: number; energyJ: number }
export interface GapRecord { startMs: number; endMs: number; cause: 'lost_packets'|'link_down'|'device_restart'|'stale' }
export interface SessionSummary { id: string; source: SourceKind; deviceId: string; startedAt: number; endedAt: number|null; status: 'open'|'closed'|'interrupted'; energyWh: number; peakPowerW: number; steps: number; recordedMs: number; bridgedMs: number; excludedGapMs: number }
export interface DashboardEngine {
  supported(): boolean; connect(): Promise<void>; disconnect(): Promise<void>;
  startDemo(opts?: { cadenceSpm?: number; sampleRateHz?: number }): void; startReplay(file: File): Promise<void>; stop(): void;
  subscribeSnapshot(cb: (s: LiveSnapshot) => void): () => void; subscribeChart(cb: (b: ChartBatch) => void): () => void;
  subscribeSteps(cb: (e: StepEvent) => void): () => void; subscribeGaps(cb: (g: GapRecord) => void): () => void;
  getDeviceInfo(): DeviceInfo | null; getProfile(): Promise<DeviceProfile>; saveProfile(p: DeviceProfile): Promise<void>;
  listSessions(): Promise<SessionSummary[]>; getSessionSeries(id: string, rangeMs?: [number, number]): Promise<ChartBatch>;
  exportCsv(id: string): Promise<Blob>; exportSessionJson(id: string): Promise<Blob>;
  recomputeSession(id: string, profile: DeviceProfile): Promise<SessionSummary>; deleteAllData(): Promise<void>;
}
```

**Two additions the Overview needs.** The contract above has no aggregated history for the Energy Generated and Foot Traffic charts or the "vs. yesterday" change. Code against this proposed addition and tell the data-layer developer to add it:

```ts
export type Bucket = 'hour' | 'day';
export interface HistoryPoint { t: number; energyWh: number; steps: number; recordedMs: number }
// add to DashboardEngine:
getHistory(range: 'today'|'week'|'month', bucket: Bucket): Promise<HistoryPoint[]>;
getTodayVsYesterday(): Promise<{ energyWh: [number, number]; steps: [number, number]; co2Kg: [number, number] }>;
```
Also needed for the heatmap in Phase 3: `listTiles(): Promise<TileInfo[]>` and per-tile snapshots keyed by device ID. Define `TileInfo` with `deviceId`, `name`, `x`, `y`; keep it behind the `multiTile` flag.

**Engine provider.** An `EngineProvider` creates the engine once. `NEXT_PUBLIC_ENGINE=mock` uses `createMockEngine()` (default during development); `real` uses `createDashboardEngine()` from the data layer. A Zustand store subscribes to the engine callbacks and exposes selectors such as `useSnapshot()`, `useConnection()`, `useAlerts()`. Screens never touch the engine directly except to call actions (connect, start demo, save profile, export).

**Mock engine.** Until the real one is delivered, build `createMockEngine()` yourself in the frontend repo: emits snapshots about every 100 ms, chart batches at 20 Hz with footstep-shaped pulses (peaks up to about 60 W, 90 steps per minute), occasional gaps, and can be switched between all connection states from a dev panel. Make the data realistic for one tile (watts, not kilowatts) so unit auto-scaling is exercised.

## 8. Behaviour rules

- Never calculate a metric. Format and display only. If a value is missing, show an em dash and, where useful, the reason.
- Never hide data loss: show recorded time and gap time beside totals; draw gaps on charts.
- Use auto-scaled units everywhere (see `format` utilities) and label units on axes.
- Chart updates: append points to a typed-array buffer and redraw at most 10 times per second; tiles update at most 4 times per second. No re-render of the whole page per sample.
- The Connect button must be triggered directly by a user click.
- Values dim and show "No data" when the connection is Stale.
- Demo and Replay banners are always visible when active and can never be dismissed.
- Responsive: tablet to wide desktop; the sidebar collapses to icons under a width breakpoint; Overview stays readable from about 2 metres on a client screen.
- Dark theme only in v1; theme tokens live in CSS variables so a light theme can be added later.

## 9. Performance and quality targets

- One hour of live data at 50 samples per second (180,000 points) on the Live chart without dropped frames on a mid-range laptop and an Android phone. Use ECharts large-data mode and downsampling. If it fails this target, replace only the Live chart with uPlot.
- Chart draw under 16 ms per frame; no layout shift on load; Lighthouse accessibility score 95 or higher.
- Tests: formatters and selectors with Vitest; component tests with React Testing Library; Playwright runs the Overview, Live, Connection and Settings flows against the mock engine at three screen widths.

## 10. Build order

1. Project setup: Next.js static export, Tailwind tokens, shadcn/ui, ESLint, Prettier, CI, Storybook.
2. Contracts package copy (or import) and the mock engine with a dev panel.
3. AppShell: sidebar, header, clock, ConnectionPill, banners.
4. Overview: MetricCards, tile panel, System Status, the three charts.
5. Live screen and the LivePowerChart with step markers and gap shading.
6. Connection screen, unsupported-browser state, demo and replay controls.
7. Sessions and export actions.
8. Calibration and Settings.
9. HexHeatmap component behind the `multiTile` flag, with a Storybook story using 27 mock tiles (the reference layout).
10. Responsive pass, accessibility pass, kiosk mode, PWA, end-to-end tests.
11. Switch `NEXT_PUBLIC_ENGINE` to `real` when the data layer is delivered and fix any contract differences listed in the data layer's `docs/INTEGRATION.md`.

## 11. Open items for the founder

- Which name expansion to show: "Flooring Optimised for Renewable Clean Energy" or "Footstep Operated Renewable Conversion Engine".
- Sustainability score formula, emission factor and wellness definition (the score card shows a placeholder until agreed).
- Brand assets: logo files, font, and the original design file if one exists, so tokens can be matched exactly.
- Whether the dashboard needs a light theme.

## 12. Kick-start prompt for the code agent

```text
You are building the FRONTEND of the F.O.R.C.E Dashboard. Read FORCE_Frontend_Spec_and_Tech_Stack.md fully, then the PRD, and look at the attached design reference image. Use exactly the tech stack in section 2.
1. Write docs/IMPLEMENTATION_PLAN.md first: milestones from section 10, tasks, acceptance checks, folder structure, component list, risks, open questions. Then start milestone 1 immediately, without waiting for approval, and keep the plan's checkboxes current.
2. Match the reference's look and layout, with the content changes in section 4. Do not implement Bluetooth, decoding, calculations or storage; code only against the contracts in section 7 and build the mock engine yourself.
3. Auto-scale all units; never hard-code kWh or kW.
4. After each milestone run type check, lint and tests and report what passed. Ask only if blocked; otherwise record the assumption in docs/DECISIONS.md and continue.
```
