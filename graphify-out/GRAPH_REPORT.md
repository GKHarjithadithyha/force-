# Graph Report - FED  (2026-11-16)

## Corpus Check
- 154 files · ~105,767 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 6, .example 1, .css 1)

## Summary
- 1589 nodes · 3329 edges · 97 communities (80 shown, 17 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 248 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- session.ts
- protocol/src/index.ts
- test_sensor_bench/test_main.cpp
- engine.test.ts
- Engine
- package.json
- fedfront/package.json
- render.ts
- WorkerHost
- test_packet/test_main.cpp
- SessionEngine
- protocol.test.ts
- src/backup.ts
- DashboardEngine
- BluetoothSource
- Lib
- worker/package.json
- Pipeline
- with
- storage/package.json
- F.O.R.C.E Dashboard — System Architecture Document
- release.test.ts
- compilerOptions
- device/package.json
- ConnectionState
- db.ts
- F.O.R.C.E Dashboard — Product Requirements Document
- main.cpp
- engine.test.ts
- engine/package.json
- fakes.ts
- Bench test: first run on real hardware
- Telemetry packets
- Store
- FakeCharacteristic
- simulator/package.json
- F.O.R.C.E: Implementation Plan
- sequence.ts
- dashboard.tsx
- ServerCallbacks
- F.O.R.C.E Dashboard: Final Technology Stack
- SessionSummary
- 3. Milestones (build order)
- contracts/package.json
- protocol/package.json
- Stats
- 3. What each part means
- ina219.cpp
- other-screen.tsx
- TelemetryInput
- bluetooth.ts
- .prettierrc.json
- tsconfig.json
- contracts/src/index.ts
- CLAUDE.md
- .claude/CLAUDE.md
- test_power_report/test_main.cpp
- helpers.ts
- SessionsScreen
- dependencies
- docs/DECISIONS.md
- ConnectionState
- engine/src/messages.ts
- compilerOptions
- Milestone 11: actual load measurement and validation
- F.O.R.C.E Dashboard: Frontend Specification and Tech Stack
- charts.tsx
- scripts
- layout.tsx
- F.O.R.C.E Dashboard Design Extraction
- FakeClock
- scripts
- Integration guide for the frontend (apps/web)
- next.config.mjs
- Char
- dependencies
- F.O.R.C.E Dashboard Implementation Plan
- devDependencies
- @playwright/test
- hex-heatmap.stories.tsx
- extends
- main.ts
- tailwindcss
- @testing-library/jest-dom
- hardware-path.test.ts
- Data Collection Requirements: traceability
- eslint.config.js
- F.O.R.C.E (Florix Energy)
- Environment configuration
- artifacts.test.ts
- engine-mode.d.mts
- serve-static.mjs
- Meter
- vitest@4.1.12

## God Nodes (most connected - your core abstractions)
1. `Store` - 55 edges
2. `Engine` - 46 edges
3. `DashboardEngine` - 45 edges
4. `Pipeline` - 44 edges
5. `SessionEngine` - 37 edges
6. `DeviceProfile` - 36 edges
7. `WorkerHost` - 36 edges
8. `BluetoothSource` - 32 edges
9. `SessionSummary` - 30 edges
10. `Dashboard()` - 28 edges

## Surprising Connections (you probably didn't know these)
- ``LiveSnapshot`` --references--> `LiveSnapshot`  [INFERRED]
  docs/INTEGRATION.md → packages/contracts/src/index.ts
- `M1. Repo, tooling, CI, protocol, contracts` --references--> `DashboardEngine`  [INFERRED]
  docs/IMPLEMENTATION_PLAN.md → packages/contracts/src/index.ts
- `Engine (M4, M5)` --references--> `Pipeline`  [INFERRED]
  docs/DECISIONS.md → packages/engine/src/pipeline.ts
- `4. Event detection` --references--> `validateProfile()`  [INFERRED]
  docs/DATA_COLLECTION_TRACEABILITY.md → packages/engine/src/profile.ts
- `Worker and facade (M7, M8)` --references--> `createMockEngine()`  [INFERRED]
  docs/DECISIONS.md → packages/worker/src/mock.ts

## Import Cycles
- 2-file cycle: `packages/protocol/src/index.ts -> packages/protocol/src/vectors.ts -> packages/protocol/src/index.ts`

## Communities (97 total, 17 thin omitted)

### Community 0 - "session.ts"
Cohesion: 0.12
Nodes (18): LiveMetrics, LiveQuality, component(), kcal(), ledHours(), phoneCharges(), sustainabilityScore(), CADENCE_WINDOW_MS (+10 more)

### Community 1 - "protocol/src/index.ts"
Cohesion: 0.19
Nodes (15): DecodeFailure, DecodeResult, DeviceInfoJson, DeviceInfoParse, MAX_VOLTAGE_MV, OFFSET, PACKET_SIZE, TelemetryFields (+7 more)

### Community 2 - "test_sensor_bench/test_main.cpp"
Cohesion: 0.06
Nodes (32): BenchParams, idleVoltageMv, noiseMa, noiseMv, peakMaxMw, peakMinMw, peakVoltageMv, pulseMaxMs (+24 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.14
Nodes (25): 6. Additions beyond the brief's seam, Charts, DashboardState, ChartBatch, DeviceProfile, GapRecord, LiveSnapshot, RangeTotals (+17 more)

### Community 4 - "Engine"
Cohesion: 0.06
Nodes (8): M8. Sources, mock engine, facade, INTEGRATION.md, DemoSource, ReplaySource, DataSource, hash01(), mulberry32(), PacketSimulator, Engine

### Community 5 - "package.json"
Cohesion: 0.18
Nodes (10): description, tsx@4.23.15, engines, node, name, private, type, version (+2 more)

### Community 6 - "fedfront/package.json"
Cohesion: 0.07
Nodes (40): devDependencies, autoprefixer@^10.4.20, eslint@^9.17.0, eslint-config-next@^15.1.6, fake-indexeddb@6.2.8, @force/protocol@*, @force/storage@*, jsdom@^25.0.1 (+32 more)

### Community 7 - "render.ts"
Cohesion: 0.31
Nodes (7): bytesToC(), hexBytes(), macToC(), renderPacketExamples(), renderVectorsHeader(), DEVICE_NAME_PREFIX, PROTOCOL_VERSION

### Community 8 - "WorkerHost"
Cohesion: 0.19
Nodes (5): WorkerHost, createInlineWorker(), main(), mkHost(), started()

### Community 9 - "test_packet/test_main.cpp"
Cohesion: 0.10
Nodes (18): M2. Packet packer and decoder, shared worked examples, compute_power_mw(), format_device_info(), format_device_name(), make_flags(), pack_telemetry(), put_u16(), put_u32() (+10 more)

### Community 10 - "SessionEngine"
Cohesion: 0.07
Nodes (7): RawSample, cloneProfile(), SessionEngine, SessionSink, StepDetector, det(), run()

### Community 11 - "protocol.test.ts"
Cohesion: 0.15
Nodes (9): check, root, GENERATED, computePowerMw(), deviceNameFromMac(), formatDeviceInfo(), isPosInt(), parseDeviceInfo() (+1 more)

### Community 12 - "src/backup.ts"
Cohesion: 0.12
Nodes (18): Data integrity audit, Known limitations, Placeholders and assumptions shown in the UI, Release readiness (software), Test report, BACKUP_FORMAT, BACKUP_VERSION, BackupChunk (+10 more)

### Community 14 - "BluetoothSource"
Cohesion: 0.13
Nodes (8): Integration test: board to UI, Remaining integration gaps, Running the real browser test, Status, What the automated test proves (simulated radio), BluetoothSource, bluetoothSupported(), describeBluetoothError()

### Community 16 - "worker/package.json"
Cohesion: 0.11
Nodes (22): dependencies, @force/contracts@*, @force/device@*, @force/engine@*, @force/protocol@*, @force/simulator@*, @force/storage@*, exports (+14 more)

### Community 17 - "Pipeline"
Cohesion: 0.14
Nodes (5): Pipeline, GapCause, base(), run(), run()

### Community 18 - "with"
Cohesion: 0.07
Nodes (35): name, runs-on, steps, concurrency, cancel-in-progress, group, CI, name (+27 more)

### Community 19 - "storage/package.json"
Cohesion: 0.12
Nodes (20): dependencies, dexie@4.4.7, @force/contracts@*, @force/engine@*, @force/protocol@*, devDependencies, @force/simulator@*, exports (+12 more)

### Community 20 - "F.O.R.C.E Dashboard — System Architecture Document"
Cohesion: 0.10
Nodes (19): 10. Application and UI architecture, 11. Connection lifecycle, 12. Error handling and data quality, 13. Security and privacy, 14. Performance and capacity budget, 15. Testing strategy, 16. Deployment and release, 17. Evolution to Phase 3 (+11 more)

### Community 21 - "release.test.ts"
Cohesion: 0.27
Nodes (9): Bucket, HistoryPoint, Range, addLocalDays(), getHistory(), getTodayVsYesterday(), historyBuckets(), startOfLocalDay() (+1 more)

### Community 22 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+11 more)

### Community 23 - "device/package.json"
Cohesion: 0.14
Nodes (17): dependencies, @force/contracts@*, @force/engine@*, @force/protocol@*, @force/simulator@*, exports, @force/contracts, @force/engine (+9 more)

### Community 25 - "db.ts"
Cohesion: 0.11
Nodes (21): ChunkRow, ConnectionEventRow, DeviceRow, GapRow, LATEST_SCHEMA_VERSION, MetaRow, MinuteRow, OpenResult (+13 more)

### Community 26 - "F.O.R.C.E Dashboard — Product Requirements Document"
Cohesion: 0.13
Nodes (14): 10. Technical approach, 11. Release plan, 12. Risks, assumptions and open questions, 13. Sources, 1. Overview, 2. Goals and success metrics, 3. Users and use cases, 4. System at a glance (+6 more)

### Community 27 - "main.cpp"
Cohesion: 0.14
Nodes (10): Firmware (M3, M9), First run on real hardware (Board 1, 15 Nov 2026, over USB serial), accFault(), accInvalid(), accValid(), initWatchdog(), readSample(), samplerTask() (+2 more)

### Community 28 - "engine.test.ts"
Cohesion: 0.19
Nodes (12): makeBackup(), bytesToBase64(), SessionBackup, DEFAULT_PROFILE, FLAG, DEFAULT_SIM_CONFIG, FaultKind, SimConfig (+4 more)

### Community 29 - "engine/package.json"
Cohesion: 0.16
Nodes (13): dependencies, @force/contracts@*, @force/protocol@*, exports, @force/contracts, @force/protocol, main, name (+5 more)

### Community 30 - "fakes.ts"
Cohesion: 0.11
Nodes (14): BluetoothDeviceLike, PACKET, setup(), streaming(), EXPECTED_INFO, FakeBluetooth, FakeDevice, INFO_JSON (+6 more)

### Community 31 - "Bench test: first run on real hardware"
Cohesion: 0.11
Nodes (16): 0. Confirm the assumptions first, 1. Build and flash, 2. BLE link with BENCH_MODE (no wiring needed), 2a. Wireless only (USB unplugged), 3. Real sensor: wiring check, 4. Idle readings, 5. Known load against a multimeter, 5a. Sample test from a bench supply (no footstep generator) (+8 more)

### Community 32 - "Telemetry packets"
Cohesion: 0.17
Nodes (11): Device Info (UTF-8 JSON, fixed key order, no whitespace), Name from MAC, negative_current, Packet examples, power_rounds_down, power_rounds_half_up, Protocol, seq_max_and_limit_flag (+3 more)

### Community 33 - "Store"
Cohesion: 0.09
Nodes (8): ForceDatabase, emptyBatchSeries(), Store, stripRow(), unpackChunk(), mk(), mkStore(), onlySession()

### Community 35 - "simulator/package.json"
Cohesion: 0.18
Nodes (11): dependencies, @force/protocol@*, exports, @force/protocol, main, name, private, sideEffects (+3 more)

### Community 36 - "F.O.R.C.E: Implementation Plan"
Cohesion: 0.22
Nodes (6): 1. Workstreams, 2. Repo structure, 3a. Status (15 Nov 2026), 4. Test plan, 5. Risks, 6. Open questions (none block)

### Community 37 - "sequence.ts"
Cohesion: 0.20
Nodes (6): LATE_SEQ_WINDOW, LATE_TIME_WINDOW_MS, SeqClass, SequenceTracker, DEVICE_TIME_MODULUS, SEQ_MODULUS

### Community 38 - "dashboard.tsx"
Cohesion: 0.14
Nodes (27): Home(), ChartCard(), Dashboard(), descriptors, FAULTS, indicatorText, items, Metric() (+19 more)

### Community 40 - "F.O.R.C.E Dashboard: Final Technology Stack"
Cohesion: 0.20
Nodes (9): 1. Summary, 2. Frontend, 3. Device and data layer (runs in the browser), 4. Backend and cloud (Phase 3), 5. Quality, delivery and hosting, 6. Decisions made, 7. Build order, 8. Still open (does not block Phase 0) (+1 more)

### Community 41 - "SessionSummary"
Cohesion: 0.19
Nodes (7): SessionSummary, encodeRawSample(), PipelineSink, MinuteBucket, Collected, summaryFields(), runLive()

### Community 42 - "3. Milestones (build order)"
Cohesion: 0.20
Nodes (10): 3. Milestones (build order), M10. Performance run, M11. Actual load measurement and validation (NEXT), M1. Repo, tooling, CI, protocol, contracts, M3. Firmware BENCH_MODE streaming + `tools/ble_check.html`, M4. Engine: energy and gaps with golden files, M5. Step detector and remaining metrics, M6. Simulator and fault injection (+2 more)

### Community 43 - "contracts/package.json"
Cohesion: 0.22
Nodes (8): exports, main, name, private, sideEffects, type, types, version

### Community 44 - "protocol/package.json"
Cohesion: 0.22
Nodes (8): exports, main, name, private, sideEffects, type, types, version

### Community 45 - "Stats"
Cohesion: 0.20
Nodes (9): Stats, advRestarts, invalidReads, notifyDrops, notifyOk, overruns, queueDrops, samples (+1 more)

### Community 46 - "3. What each part means"
Cohesion: 0.25
Nodes (8): 3. What each part means, Connection states (Architecture section 11), Exports and replay, `LiveSnapshot`, Sessions, Settings and recalculation, Time and units, Today, daily totals and the daily report

### Community 48 - "other-screen.tsx"
Cohesion: 0.18
Nodes (16): CalibrationScreen(), errorText(), Field(), InfoCell(), InfoLine(), Note, NoteLine(), NUM_FIELDS (+8 more)

### Community 49 - "TelemetryInput"
Cohesion: 0.25
Nodes (6): TelemetryInput, currentMa, deviceTimeMs, flags, seq, voltageMv

### Community 50 - "bluetooth.ts"
Cohesion: 0.12
Nodes (8): BluetoothLike, GattServerLike, RECONNECT_BACKOFF_MS, RECONNECT_WINDOW_MS, ServiceLike, STALE_AFTER_MS, Clock, EngineDeps

### Community 51 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 52 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): ./tsconfig.base.json, extends, include

### Community 53 - "contracts/src/index.ts"
Cohesion: 0.15
Nodes (15): Alert, AlertKind, CreateDashboardEngine, DisplayUnits, QualityDetail, ScoreTargets, ScoreWeights, SourceKind (+7 more)

### Community 56 - "test_power_report/test_main.cpp"
Cohesion: 0.05
Nodes (79): classify(), classify_input(), compute_measurement(), format_power_report(), input_status_message(), input_status_text(), InputStatus, NoInput (+71 more)

### Community 57 - "helpers.ts"
Cohesion: 0.15
Nodes (17): block, both(), html, lib, root, Row, Sample, Golden (+9 more)

### Community 58 - "SessionsScreen"
Cohesion: 0.40
Nodes (8): download(), SessionCompare(), SessionsScreen(), formatCo2(), formatEnergy(), formatPower(), formatQuality(), formatRecorded()

### Community 59 - "dependencies"
Cohesion: 0.18
Nodes (12): Button(), ButtonProps, buttonVariants, cn(), class-variance-authority@^0.7.1, clsx@^2.1.1, @radix-ui/react-slot@^1.2.3, tailwind-merge@^3.7.0 (+4 more)

### Community 60 - "docs/DECISIONS.md"
Cohesion: 0.22
Nodes (8): Data Collection Requirements doc (DCR), Device sources (M8), Engine (M4, M5), Inputs and environment, Protocol, Storage (M7), Worker and facade (M7, M8), openDatabase()

### Community 61 - "ConnectionState"
Cohesion: 0.22
Nodes (7): 2. Data inventory, ConnectionState, DeviceInfo, realClock, Timer, DemoOptions, Fault

### Community 62 - "engine/src/messages.ts"
Cohesion: 0.29
Nodes (6): DeviceStatus, FootstepEventMessage, HeartbeatMessage, toFootstepEventMessage(), toHeartbeatMessage(), compactUtc()

### Community 63 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 64 - "Milestone 11: actual load measurement and validation"
Cohesion: 0.25
Nodes (8): After this milestone, Already verified (do not repeat), Milestone 11: actual load measurement and validation, Not verified, and what this milestone settles, Pass criteria (proposed; the PRD target is 5 % for energy), Procedure, Results (fill in; empty means not measured), Setup

### Community 65 - "F.O.R.C.E Dashboard: Frontend Specification and Tech Stack"
Cohesion: 0.10
Nodes (19): 10. Build order, 11. Open items for the founder, 12. Kick-start prompt for the code agent, 1. Scope, 2. Frontend tech stack, 3. Design reference analysis, 4. Adapting the reference to the real product, 5.1 Overview (default) (+11 more)

### Community 66 - "charts.tsx"
Cohesion: 0.29
Nodes (12): bucketLabel(), chartOption(), emptyTitle(), EnergyChart(), firstIndexFrom(), PowerChart(), PowerSeries, ReactECharts (+4 more)

### Community 67 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, build-storybook, dev, lint, start, storybook, test (+5 more)

### Community 68 - "layout.tsx"
Cohesion: 0.12
Nodes (11): inter, metadata, dynamic, serwist, WorkerGlobalScope, next@^15.1.6, serwist@^9.0.12, @serwist/next@^9.5.13 (+3 more)

### Community 69 - "F.O.R.C.E Dashboard Design Extraction"
Cohesion: 0.18
Nodes (10): Charts and live indicator, F.O.R.C.E Dashboard Design Extraction, Icons, Known visual deviations / open data, Palette, Shape, borders and effects, Source and canvas, Tile grid and sidebar (+2 more)

### Community 71 - "scripts"
Cohesion: 0.11
Nodes (19): scripts, check, check:all, check:generated, check:web, format, format:check, gen:protocol (+11 more)

### Community 72 - "Integration guide for the frontend (apps/web)"
Cohesion: 0.18
Nodes (11): 1. Setup, 2. The ten-minute tour, 4. The mock engine, 7. Still open (do not block the UI), 8. Firmware side: how INA219 readings reach the app, 9. fedfront integration, Change log, Flash and run (+3 more)

### Community 73 - "next.config.mjs"
Cohesion: 0.27
Nodes (7): ENGINE_MODES, resolveEngineMode(), baseConfig, FORCE_PACKAGES, nextConfig(), ROOT, withSerwist

### Community 75 - "dependencies"
Cohesion: 0.11
Nodes (19): dependencies, date-fns@^4.1.0, echarts@^5.6.0, echarts-for-react@^3.0.2, @force/contracts@*, @force/engine@*, @force/worker@*, lucide-react@^0.468.0 (+11 more)

### Community 76 - "F.O.R.C.E Dashboard Implementation Plan"
Cohesion: 0.33
Nodes (5): Component list, F.O.R.C.E Dashboard Implementation Plan, Proposed folders, Risks and assumptions, Task structure

### Community 77 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, eslint@10.15.0, fake-indexeddb@6.2.8, prettier@3.10.1, @types/node@26.6.6, typescript@5.9.3, eslint, fake-indexeddb (+3 more)

### Community 78 - "@playwright/test"
Cohesion: 0.12
Nodes (8): @playwright/test@^1.49.1, port, port, errors, out, seen, timeout, @playwright/test

### Community 79 - "hex-heatmap.stories.tsx"
Cohesion: 0.22
Nodes (5): meta, Reference27Tiles, Story, tiles, preview

### Community 80 - "extends"
Cohesion: 0.50
Nodes (3): extends, next/core-web-vitals, next/typescript

### Community 81 - "main.ts"
Cohesion: 0.50
Nodes (3): @storybook/react-vite@^8.6.19, config, @storybook/react-vite

### Community 82 - "tailwindcss"
Cohesion: 0.50
Nodes (3): tailwindcss@^3.4.17, config, tailwindcss

### Community 86 - "hardware-path.test.ts"
Cohesion: 0.10
Nodes (20): Seam and packaging, 5. Behaviour to rely on, TileInfo, Decisions and assumptions, Milestones and acceptance checks, AppEngine, createAppEngine(), EngineMode (+12 more)

### Community 88 - "Data Collection Requirements: traceability"
Cohesion: 0.25
Nodes (8): 1. Scope and assumptions, 3. Acquisition and sampling, 4. Event detection, 5. Formulas, 6. Transmission, storage, export, 7. Quality, failure, acceptance, 8. Decisions needed from you, Data Collection Requirements: traceability

### Community 89 - "eslint.config.js"
Cohesion: 0.25
Nodes (7): browserOnly, @eslint/js@10.0.1, globals@17.14.0, typescript-eslint@8.72.2, @eslint/js, globals, typescript-eslint

### Community 90 - "F.O.R.C.E (Florix Energy)"
Cohesion: 0.33
Nodes (5): Architecture, Check, F.O.R.C.E (Florix Energy), Install (from the repo root only), Run

### Community 91 - "Environment configuration"
Cohesion: 0.40
Nodes (4): Data isolation, Environment configuration, Variables, What is configured, measured or estimated

### Community 92 - "artifacts.test.ts"
Cohesion: 0.22
Nodes (4): DEVICE_INFO_CHAR_UUID, TELEMETRY_CHAR_UUID, Pulse, root

### Community 94 - "serve-static.mjs"
Cohesion: 0.33
Nodes (3): port, root, TYPES

## Knowledge Gaps
- **67 isolated node(s):** `next/core-web-vitals`, `next/typescript`, `stepsPerMin`, `pulseMinMs`, `pulseMaxMs` (+62 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 664 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `First run on real hardware (Board 1, 15 Nov 2026, over USB serial)` connect `main.cpp` to `src/backup.ts`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `DashboardEngine` (e.g. with `Storage (M7)` and `1. Workstreams`) actually correct?**
  _`DashboardEngine` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `next/core-web-vitals`, `next/typescript`, `stepsPerMin` to the rest of the system?**
  _67 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `session.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Why does `withProfileDefaults()` connect `src/backup.ts` to `Store`, `engine.test.ts`, `WorkerHost`, `contracts/src/index.ts`, `helpers.ts`, `main.cpp`, `db.ts`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Pipeline` (e.g. with `Engine (M4, M5)` and `Storage (M7)`) actually correct?**
  _`Pipeline` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `test_sensor_bench/test_main.cpp` be split into smaller, more focused modules?**
  _Cohesion score 0.05612244897959184 - nodes in this community are weakly interconnected._