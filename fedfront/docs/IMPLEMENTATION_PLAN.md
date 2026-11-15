# F.O.R.C.E Dashboard Implementation Plan

Source order reviewed: the provided screenshot and `FORCE_Frontend_Spec_and_Tech_Stack.md`. The referenced `FORCE_Dashboard_PRD.docx` is missing from the workspace and attachment directory; follow the frontend spec and document assumptions in `DECISIONS.md`.

## Milestones and acceptance checks

- [x] **1. Project setup** — Next.js App Router/static export; strict TypeScript; Tailwind CSS variables/theme; shadcn-style button primitives; Lucide; ESLint/Prettier; Vitest/RTL; Playwright; Storybook; GitHub Actions. **Visual checkpoint:** browser screenshot recorded at 2085×1165.
- [x] **2. Contracts and mock engine** — define section 7 interfaces including history and tile additions; implement `createMockEngine()` at 20 Hz with one-tile pulses, gaps and dev state controls; mock default with real-mode integration notice. **Visual checkpoint:** inspected demo banner/status/dev controls against tokens.
- [x] **3. App shell** — sidebar, configurable brand line, nav, header, clock, status pill, demo/replay banner and alert area. **Visual checkpoint:** compared shell bounds, spacing, colors and typography.
- [x] **4. Overview** — single-tile hex panel, metric cards, status, live power, energy bars, foot traffic, tabs and data-quality lines; formatted values only. **Visual checkpoint:** compared full overview and adjusted panel proportions.
- [x] **5. Live** — real-time chart, time windows, step markers, gap shading, threshold lines and live metrics. **Visual checkpoint:** matched chart tokens and panel style.
- [x] **6. Connection** — state, device/packet information, unsupported-browser message, demo/replay controls. **Visual checkpoint:** checked card and status styling.
- [x] **7. Sessions** — typed list, two-session comparison, exports, recompute and confirmed delete actions via contracts. **Visual checkpoint:** checked table and action styling.
- [x] **8. Calibration and Settings** — threshold controls, count helper, Zod-validated profile form, reset and brand expansion. **Visual checkpoint:** checked controls and spacing.
- [x] **9. Hex heatmap** — custom SVG grid, scale legend, `multiTile` support, 27-tile Storybook reference story. **Visual checkpoint:** verified Storybook builds the 27-tile story.
- [x] **10. Responsive/accessibility/kiosk/PWA/E2E** — responsive shell, keyboard focus, kiosk toggle, Serwist, Overview/Live/Connection/Settings flows and no-overflow checks at three widths. **Visual checkpoint:** screenshots at reference size and responsive widths.
- [ ] **11. Real engine integration readiness** — the data layer and `createDashboardEngine()` implementation are absent. Mock remains default; `NEXT_PUBLIC_ENGINE=real` shows the integration state. **Visual checkpoint:** pending data-layer delivery.

## Task structure

- [x] Build and document the frontend against the supplied contracts.
- [x] Add a repeatable screenshot command/output under `docs/compare/` and retain a reference copy.
- [x] Run final typecheck, lint, unit/component tests and browser comparison; log remaining differences above.

## Proposed folders

```text
app/                  App Router pages, layout, global styles
components/            shell, cards, charts, controls, feedback
components/ui/          reusable shadcn-style controls
contracts/              typed dashboard engine seam
engine/                  provider, mock engine, engine selector
lib/                     formatting, validation, date helpers
stores/                  Zustand state and actions
stories/                 Storybook component stories
tests/                   Vitest/RTL and Playwright coverage
docs/compare/             reference and generated screenshots
```

## Component list

`AppShell`, `Sidebar`, `Header`, `ConnectionPill`, `MetricCard`, `StatusRow`, `TilePanel`, `HexHeatmap`, `LivePowerChart`, `EnergyBarChart`, `FootTrafficChart`, `RangeTabs`, `GapShade`, `StepMarker`, `SessionTable`, `SessionCompare`, `DeviceInfoCard`, `PacketStats`, `ThresholdEditor`, `SettingsForm`, `Banner`, `AlertList`, `EmptyState`, `ErrorState`, `UnsupportedBrowser`.

## Risks and assumptions

- Reference image is a perspective photograph with no original flat asset; geometry and color extraction are approximate.
- PRD is absent; behavior follows the supplied frontend spec only.
- Real-engine module is not present; implement the seam and keep mock as default.
- No logo, font or brand asset is supplied; approximate the wordmark with text and use Inter.
- Metric calculations remain outside the UI; mock fixture values represent engine outputs. Missing values render as an em dash.
- The engine contract exposes today/yesterday raw pairs but not a precomputed trend. To keep UI math out of scope, the cards display yesterday's direct value without computing a percentage arrow.
- `NEXT_PUBLIC_ENGINE=real` cannot call a real engine until the data-layer package is provided. The frontend remains contract-ready with a visible integration state in real mode.
