# F.O.R.C.E Dashboard Design Extraction

## Source and canvas

- Source: `Screenshot 2026-11-15 144608.png` (used as the provided Intelligent Dashboard reference).
- Canvas: **2085 × 1165 px**.
- The image is a photograph/screenshot of a dashboard displayed in perspective, not a flat viewport capture. Its visible app surface runs approximately from `(17, 8)` to `(2070, 1165)`, with perspective distortion; measurements below are apparent image pixels and should be normalized against the app surface when implementing.
- Sidebar: leftmost app column, approximately **370 px** wide at top, narrowing slightly in the perspective image; logo at x≈73/y≈80. Main content starts at x≈410.
- Header: title/subtitle occupy y≈88–182; chart/panel area begins y≈215. Header height from content start is about **125 px**.
- Main panel gutters: about **18–22 px**.
- Main upper row, from x≈409 to 2054, y≈215 to 887 (height ≈672): tile/floor-map panel x≈409–1425 (width ≈1016); right column x≈1447–2054 (width ≈607). Key Metrics at y≈253–638 (height ≈385); System Status at y≈648–885 (height ≈237).
- Bottom charts, y≈897–1159 (height ≈262): Power Output x≈409–956 (width ≈547); Energy Generated x≈976–1542 (width ≈566); Foot Traffic x≈1559–2054 (width ≈495).
- In a flat desktop implementation, preserve the proportions: sidebar about 18% of app width; main area 82%; upper row about 2/3 + 1/3; three equal chart columns.

## Palette

The source is photographed and has perspective, glare, and compression. These are representative visible hex values; refine by sampling the source when it is displayed flat in a browser. Existing spec token estimates are retained where individual pixels cannot be reliably isolated.

| Purpose | Hex |
| --- | --- |
| Outer / page background | `#05070D` |
| Main panel fill | `#0C111A` |
| Sidebar base | `#0B0D1A` |
| Panel border | `#202A37` |
| Subtle divider / chart grid | `#25303B` |
| Sidebar active gradient | `#3B2A7A` → `#5B3FD6` |
| Purple accent | `#A94BFF` |
| Magenta accent | `#C026D3` |
| Chart line / active lavender | `#C07BFF` |
| Chart area start / end | `#8B3DE3` at ~45% opacity → transparent |
| Hex heatmap low / inactive | `#31323C` |
| Hex heatmap high | `#B43DFF` |
| Primary text | `#F4F4F8` |
| Secondary text | `#B7B8C8` |
| Muted text / axis | `#9294A8` |
| Good / online | `#31DDB0` |
| Warning | `#F59E0B` |
| Error | `#EF4444` |

## Typography

- Closest supplied font match: Inter (the source appears to use a geometric modern sans; the exact brand font was not supplied).
- Page title: approximately 34 px, 700, slightly tight tracking (~−0.3 px).
- Subtitle: approximately 25 px, 400, muted, normal tracking.
- Panel titles: 19–22 px, 600–700.
- Metric values: 28–32 px, 700; supporting metric labels 15–17 px, 400–500.
- Body / nav labels: 17–19 px, 500.
- Axis labels: 14–16 px, 400.
- Clock: date 14 px, 500; time 23 px, 700.
- Small pills / chart tabs: 14–16 px, 500.

## Shape, borders and effects

- Panels: 13–16 px radius, 1 px cool charcoal border; very dark translucent fill. Soft inner highlight along top edge; subtle black shadow, no pronounced blur.
- Metric subcards: 13 px radius, 1 px border, slightly lighter fill.
- Buttons/tabs/status pills: 18–24 px pill radius; dropdowns about 12 px.
- Active sidebar item: 14 px radius, purple left/top glow, purple gradient fill and subtle outer glow.
- Hexagons: beveled/extruded dark graphite cells with thin edge highlight and soft lower shadow; bright cells glow purple. No heavy global glass blur.

## Icons

Lucide-style, thin rounded stroke, approximately 26–30 px in sidebar and 22–25 px in cards/status rows:

- Nav: `LayoutDashboard`, `Search` (or `Activity`), `PanelTop`/`SlidersHorizontal`, `Battery` (removed per prototype rules), `ShieldCheck`, `Upload`/`UploadCloud`.
- Metrics: `Zap`, `Footprints`, `Leaf`, `Battery` (replaced by sustainability score icon, likely `Sprout`).
- Status: `Layers3`, `Cpu`, `Wifi`, `Thermometer` (remove hardware-inapplicable rows).
- Header info: `Info`; dropdown chevron: `ChevronDown`.

## Charts and live indicator

- Power chart: 2 px violet line with small 3–4 px lavender points; smooth/near-smooth footstep curve; purple area gradient fading to transparent at the baseline.
- Grid: 1 px blue-gray horizontal and vertical lines, visually around 20–30% opacity.
- Axis text: 14–16 px muted gray; axis titles vertical on the left; x tick labels spaced at 2-hour marks for aggregate charts and ~2-minute marks for live.
- Energy bars: vivid purple gradient, approximately 14–16 px width with slight 2–3 px corner rounding; hourly bars.
- Foot traffic: 2 px lavender line, 3 px points, low-opacity purple fill.
- Live badge: small dark pill, purple dot with soft glow, white “Live” label.
- Gauge/ring: no clearly visible reference ring; do not add one without spec data.

## Tile grid and sidebar

- Reference map contains **27 pointy-top hexagons**, laid out in staggered rows (3, 4, 5, 5, 5, 5), with approximately 12–16 px apparent gaps. Cells around 90–120 px wide in the perspective photo. Value scale is charcoal low through saturated purple/high magenta; centered white/lavender indicator point. Vertical legend has 5 bands from `>2.0`, `1.0–2.0`, `0.5–1.0`, `0.1–0.5`, `0`.
- Single-tile v1 panel uses this same treatment and slot, with one larger centered hexagon plus watts, steps and state.
- Sidebar logo: white `F.O.R.C.E.` uppercase wordmark, geometric sans, with small widely tracked expansion beneath. No logo asset supplied.
- Nav row height about 82 px, icon left and label, ~18 px vertical gap. Active Dashboard row is a rounded purple gradient rectangle.
- Bottom decoration: thin purple outline hexagons partially cropped by lower/left edges; brand text “FLORIX ENERGY” in widely spaced uppercase, then “Empower The World”.
- In the prototype, sidebar labels become Overview, Live, Sessions, Connection, Export Data, Calibration, Settings. Expansion text is one configurable constant; default assumption is “Flooring Optimised for Renewable Clean Energy”.

## Tokens

Use CSS variables as the source of truth and expose matching Tailwind theme values. Suggested names: `--bg`, `--panel`, `--panel-border`, `--sidebar`, `--sidebar-active-start`, `--sidebar-active-end`, `--accent`, `--accent-2`, `--accent-soft`, `--text`, `--text-secondary`, `--text-muted`, `--good`, `--warn`, `--bad`, `--radius-panel`, `--radius-control`, `--space-panel`.

## Known visual deviations / open data

- The screenshot is photographed in perspective, so flat pixel dimensions and exact colors cannot be recovered unambiguously. Layout values above are approximate apparent measurements.
- No separate `design/reference.png`, original design file, font, or brand logo asset exists in the workspace; used `Screenshot 2026-11-15 144608.png` as the reference.
- The PRD docx referenced by the brief was not present in the workspace or attachment directory. Product behavior follows the supplied frontend spec.
- The v1 screenshot substitutes the permitted one-tile card for the 27-tile floor map, updates the metrics and status rows, and uses the specified renamed navigation. The sample runs in Demo mode, so the required persistent Demo banner appears above the panel grid.
- The source image contains photographic perspective, heavy bevels/glows, and a rasterized wordmark. The browser implementation is flat and uses a text wordmark because original brand assets were not supplied. These are the main remaining style differences; chart data and the clock naturally change between captures.
- The extracted viewport screenshot is saved at `docs/compare/overview.png` (2085 × 1165); the source copy is `docs/compare/reference.png`. The browser screenshot preserves the source canvas size. The photographic image is not a pixel-aligned flat screenshot, so a meaningful pixel-diff score is unavailable.
- The comparison pass now places the sidebar at 380 px, begins the main grid at x≈408, uses the 1.67:1 upper split, delays the metrics panel to match its reference inset, and fits three charts across the lower row. Remaining differences are the mock-data values, the mandated Demo banner, and the missing original vector logo/font/3D tile art.
