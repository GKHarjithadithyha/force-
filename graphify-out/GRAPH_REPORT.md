# Graph Report - FED  (2026-11-16)

## Corpus Check
- 250 files · ~153,489 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 35 file(s) not represented in the graph (top: .xml 9, (none) 8, .css 4)

## Summary
- 2408 nodes · 5086 edges · 148 communities (100 shown, 48 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 307 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `871e9a9f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- session.ts
- protocol/src/index.ts
- test_sensor_bench/test_main.cpp
- contracts/src/index.ts
- Engine
- package.json
- fedfront/package.json
- render.ts
- WorkerHost
- test_packet/test_main.cpp
- $
- validate.ts
- DeviceProfile
- DashboardEngine
- BluetoothSource
- ble-page.test.ts
- worker/package.json
- Pipeline
- with
- storage/package.json
- F.O.R.C.E Dashboard — System Architecture Document
- release.test.ts
- compilerOptions
- device/package.json
- client.ts
- db.ts
- F.O.R.C.E Dashboard — Product Requirements Document
- main.cpp
- simulator/src/index.ts
- engine/package.json
- FakeDevice
- Bench test: first run on real hardware
- Telemetry packets
- Store
- writer.ts
- simulator/package.json
- 3. Milestones (build order)
- dashboard.tsx
- live.ts
- ServerCallbacks
- F.O.R.C.E Dashboard: Final Technology Stack
- decoder.ts
- ReplaySource
- contracts/package.json
- protocol/package.json
- Stats
- 3. What each part means
- ina219.cpp
- other-screen.tsx
- TelemetryInput
- model.ts
- .prettierrc.json
- tsconfig.json
- BenchParams
- CLAUDE.md
- .claude/CLAUDE.md
- test_power_report/test_main.cpp
- helpers.ts
- main.py
- dependencies
- fixtures.ts
- dashboard-header.tsx
- dependencies
- compilerOptions
- Milestone 11: actual load measurement and validation
- F.O.R.C.E Dashboard: Frontend Specification and Tech Stack
- charts.tsx
- scripts
- layout.tsx
- F.O.R.C.E Dashboard Design Extraction
- F.O.R.C.E. Firebase Firestore setup
- scripts
- 8. Firmware side: how INA219 readings reach the app
- next.config.mjs
- hardware-path.test.ts
- dependencies
- cloud-agent/package.json
- devDependencies
- @playwright/test
- hex-heatmap.stories.tsx
- extends
- main.ts
- tailwindcss
- cloud/package.json
- createMockEngine
- dexie.ts
- eslint.config.js
- F.O.R.C.E (Florix Energy)
- Environment configuration
- fakes.ts
- engine-mode.d.mts
- src/main.ts
- SyncClient
- expo
- MemoryDocStore
- days.ts
- AdminDocStore
- destop/package.json
- devDependencies
- compilerOptions
- Clock
- AGENTS.md
- bluetooth.test.ts
- FakeCharacteristic
- sequence.ts
- F.O.R.C.E. multi-agent plan
- MainApplication.kt
- Florix APP/package.json
- startCloudSync
- F.O.R.C.E Dashboard Implementation Plan
- Integration test: board to UI
- analytics.ts
- Release readiness (software)
- MainActivity.kt
- scripts
- metro.config.js
- Data Collection Requirements: traceability
- Decisions and assumptions
- vite.config.ts
- MemorySyncStateStore
- bluetoothSupported
- Run and deploy your AI Studio app
- expo-dev-client@~6.0.21
- expo-status-bar@^3.0.9
- postcss@^8.5.6
- react-dom@19.1.0
- @react-native-async-storage/async-storage
- react-native-safe-area-context
- react-native-screens@~4.16.0
- react-native-web@^0.21.0
- react-native-worklets@0.5.1
- three@^0.183.1

## God Nodes (most connected - your core abstractions)
1. `Store` - 62 edges
2. `DashboardEngine` - 46 edges
3. `Pipeline` - 46 edges
4. `Engine` - 46 edges
5. `DeviceProfile` - 41 edges
6. `SessionEngine` - 37 edges
7. `WorkerHost` - 36 edges
8. `SessionSummary` - 35 edges
9. `StepEvent` - 33 edges
10. `BluetoothSource` - 32 edges

## Surprising Connections (you probably didn't know these)
- ``LiveSnapshot`` --references--> `LiveSnapshot`  [INFERRED]
  docs/INTEGRATION.md → packages/contracts/src/index.ts
- `M1. Repo, tooling, CI, protocol, contracts` --references--> `DashboardEngine`  [INFERRED]
  docs/IMPLEMENTATION_PLAN.md → packages/contracts/src/index.ts
- `Change log` --references--> `DashboardEngine`  [INFERRED]
  docs/INTEGRATION.md → packages/contracts/src/index.ts
- `Remaining integration gaps` --references--> `BluetoothSource`  [INFERRED]
  docs/HARDWARE_INTEGRATION_TEST.md → packages/device/src/bluetooth.ts
- `Status` --references--> `BluetoothSource`  [INFERRED]
  docs/HARDWARE_INTEGRATION_TEST.md → packages/device/src/bluetooth.ts

## Import Cycles
- 2-file cycle: `packages/protocol/src/index.ts -> packages/protocol/src/vectors.ts -> packages/protocol/src/index.ts`

## Communities (148 total, 48 thin omitted)

### Community 0 - "session.ts"
Cohesion: 0.07
Nodes (28): LiveMetrics, LiveQuality, component(), kcal(), ledHours(), phoneCharges(), sustainabilityScore(), DeviceStatus (+20 more)

### Community 1 - "protocol/src/index.ts"
Cohesion: 0.21
Nodes (16): computePowerMw(), DeviceInfoJson, DeviceInfoParse, deviceNameFromMac(), formatDeviceInfo(), isPosInt(), packTelemetry(), parseDeviceInfo() (+8 more)

### Community 2 - "test_sensor_bench/test_main.cpp"
Cohesion: 0.10
Nodes (16): clamp_to_i16(), ina219_at_limit(), ina219_bus_overflow(), ina219_bus_to_mv(), ina219_reading_valid(), ina219_shunt_to_ma(), datasheet_cal(), datasheet_ma() (+8 more)

### Community 3 - "contracts/src/index.ts"
Cohesion: 0.08
Nodes (46): 2. Data inventory, Charts, DashboardState, LiveStatusDoc, Alert, ChartBatch, ConnectionState, CreateDashboardEngine (+38 more)

### Community 5 - "package.json"
Cohesion: 0.18
Nodes (10): description, tsx@4.23.15, engines, node, name, private, type, version (+2 more)

### Community 6 - "fedfront/package.json"
Cohesion: 0.06
Nodes (44): devDependencies, autoprefixer@^10.4.20, eslint@^9.17.0, eslint-config-next@^15.1.6, fake-indexeddb@6.2.8, @force/protocol@*, @force/storage@*, jsdom@^25.0.1 (+36 more)

### Community 7 - "render.ts"
Cohesion: 0.21
Nodes (9): check, root, bytesToC(), GENERATED, hexBytes(), macToC(), renderPacketExamples(), renderVectorsHeader() (+1 more)

### Community 8 - "WorkerHost"
Cohesion: 0.16
Nodes (7): Data integrity audit, withProfileDefaults(), WorkerHost, createInlineWorker(), main(), mkHost(), started()

### Community 9 - "test_packet/test_main.cpp"
Cohesion: 0.10
Nodes (18): M2. Packet packer and decoder, shared worked examples, compute_power_mw(), format_device_info(), format_device_name(), make_flags(), pack_telemetry(), put_u16(), put_u32() (+10 more)

### Community 10 - "$"
Cohesion: 0.06
Nodes (65): App(), AppContent(), BluetoothConnectModal(), BluetoothConnectModalProps, Dashboard(), DashboardProps, $, Counter (+57 more)

### Community 11 - "validate.ts"
Cohesion: 0.16
Nodes (40): ALERT_KINDS, arr(), bool(), Bounds, close(), CONNECTION, dateIn(), deviceIdOf() (+32 more)

### Community 12 - "DeviceProfile"
Cohesion: 0.14
Nodes (10): DevicePayload, DeviceProfile, PipelineConfig, PushResult, cloneProfile(), finiteNonNeg(), finitePos(), validateProfile() (+2 more)

### Community 16 - "worker/package.json"
Cohesion: 0.11
Nodes (22): dependencies, @force/contracts@*, @force/device@*, @force/engine@*, @force/protocol@*, @force/simulator@*, @force/storage@*, exports (+14 more)

### Community 17 - "Pipeline"
Cohesion: 0.06
Nodes (16): record(), SessionSummary, RawSample, Pipeline, PipelineSink, GapCause, SessionEngine, SessionSink (+8 more)

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
Cohesion: 0.16
Nodes (15): CloudSyncStatus(), LABEL, time(), AppEngine, cloudSyncUrl(), createAppEngine(), EngineMode, engineMode() (+7 more)

### Community 22 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+11 more)

### Community 23 - "device/package.json"
Cohesion: 0.14
Nodes (17): dependencies, @force/contracts@*, @force/engine@*, @force/protocol@*, @force/simulator@*, exports, @force/contracts, @force/engine (+9 more)

### Community 24 - "client.ts"
Cohesion: 0.11
Nodes (18): recorded(), BACKOFF_BASE_MS, BACKOFF_MAX_MS, backoffMs(), DEFAULT_LIVE_INTERVAL_MS, fresh(), Outcome, PARK_MS (+10 more)

### Community 25 - "db.ts"
Cohesion: 0.07
Nodes (37): 3. Existing model to Firestore mapping, makeBackup(), BACKUP_FORMAT, BACKUP_VERSION, BackupChunk, BackupMeta, backupPackets(), base64ToBytes() (+29 more)

### Community 26 - "F.O.R.C.E Dashboard — Product Requirements Document"
Cohesion: 0.13
Nodes (14): 10. Technical approach, 11. Release plan, 12. Risks, assumptions and open questions, 13. Sources, 1. Overview, 2. Goals and success metrics, 3. Users and use cases, 4. System at a glance (+6 more)

### Community 27 - "main.cpp"
Cohesion: 0.15
Nodes (10): Firmware (M3, M9), First run on real hardware (Board 1, 15 Nov 2026, over USB serial), accFault(), accInvalid(), accValid(), initWatchdog(), readSample(), samplerTask() (+2 more)

### Community 28 - "simulator/src/index.ts"
Cohesion: 0.17
Nodes (4): DemoSource, hash01(), mulberry32(), PacketSimulator

### Community 29 - "engine/package.json"
Cohesion: 0.16
Nodes (13): dependencies, @force/contracts@*, @force/protocol@*, exports, @force/contracts, @force/protocol, main, name (+5 more)

### Community 31 - "Bench test: first run on real hardware"
Cohesion: 0.11
Nodes (16): 0. Confirm the assumptions first, 1. Build and flash, 2. BLE link with BENCH_MODE (no wiring needed), 2a. Wireless only (USB unplugged), 3. Real sensor: wiring check, 4. Idle readings, 5. Known load against a multimeter, 5a. Sample test from a bench supply (no footstep generator) (+8 more)

### Community 32 - "Telemetry packets"
Cohesion: 0.17
Nodes (11): Device Info (UTF-8 JSON, fixed key order, no whitespace), Name from MAC, negative_current, Packet examples, power_rounds_down, power_rounds_half_up, Protocol, seq_max_and_limit_flag (+3 more)

### Community 33 - "Store"
Cohesion: 0.07
Nodes (10): StoreLocalSource, sourceFor(), ForceDatabase, LATEST_SCHEMA_VERSION, SCHEMA, Store, stripRow(), mk() (+2 more)

### Community 34 - "writer.ts"
Cohesion: 0.11
Nodes (15): DocStore, DocWrite, MAX_BATCH_WRITES, ValidationError, CHILDREN, CloudWriter, ConflictError, WriterStats (+7 more)

### Community 35 - "simulator/package.json"
Cohesion: 0.18
Nodes (11): dependencies, @force/protocol@*, exports, @force/protocol, main, name, private, sideEffects (+3 more)

### Community 36 - "3. Milestones (build order)"
Cohesion: 0.11
Nodes (15): 2. Repo structure, 3. Milestones (build order), 3a. Status (15 Nov 2026), 4. Test plan, 5. Risks, 6. Open questions (none block), M10. Performance run, M11. Actual load measurement and validation (NEXT) (+7 more)

### Community 37 - "dashboard.tsx"
Cohesion: 0.15
Nodes (21): Home(), ChartCard(), Dashboard(), FAULTS, items, POWER_WINDOWS, RangeTabs(), SessionCompare() (+13 more)

### Community 38 - "live.ts"
Cohesion: 0.24
Nodes (14): LiveScreen(), connectionRow(), DeviceHealth(), Row, RealTimePowerCard(), hasData(), inputStatus(), LIVE (+6 more)

### Community 40 - "F.O.R.C.E Dashboard: Final Technology Stack"
Cohesion: 0.20
Nodes (9): 1. Summary, 2. Frontend, 3. Device and data layer (runs in the browser), 4. Backend and cloud (Phase 3), 5. Quality, delivery and hosting, 6. Decisions made, 7. Build order, 8. Still open (does not block Phase 0) (+1 more)

### Community 41 - "decoder.ts"
Cohesion: 0.24
Nodes (7): DecodeFailure, DecodeResult, encodeRawSample(), MAX_VOLTAGE_MV, OFFSET, PACKET_SIZE, TELEMETRY_VECTORS

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
Cohesion: 0.19
Nodes (19): CalibrationScreen(), ConnectionScreen(), download(), errorText(), Field(), InfoCell(), InfoLine(), Note (+11 more)

### Community 49 - "TelemetryInput"
Cohesion: 0.20
Nodes (6): TelemetryInput, currentMa, deviceTimeMs, flags, seq, voltageMv

### Community 50 - "model.ts"
Cohesion: 0.09
Nodes (29): bigintToString(), CLOUD_SCHEMA_VERSION, DailyPayload, DailySummaryDoc, DataGapDoc, DEVICE_ID_RE, DeviceConfigDoc, DeviceDoc (+21 more)

### Community 51 - ".prettierrc.json"
Cohesion: 0.33
Nodes (5): printWidth, semi, singleQuote, tabWidth, trailingComma

### Community 52 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): ./tsconfig.base.json, extends, include

### Community 53 - "BenchParams"
Cohesion: 0.11
Nodes (16): BenchParams, idleVoltageMv, noiseMa, noiseMv, peakMaxMw, peakMinMw, peakVoltageMv, pulseMaxMs (+8 more)

### Community 56 - "test_power_report/test_main.cpp"
Cohesion: 0.05
Nodes (79): classify(), classify_input(), compute_measurement(), format_power_report(), input_status_message(), input_status_text(), InputStatus, NoInput (+71 more)

### Community 57 - "helpers.ts"
Cohesion: 0.12
Nodes (22): decodePacket(), DEFAULT_PROFILE, block, both(), html, lib, Meter, root (+14 more)

### Community 58 - "main.py"
Cohesion: 0.05
Nodes (19): Settings, Database, get_db_pool(), find_all_bluetooth_ports(), get_current_reading(), get_journey(), get_security_mode(), lifespan() (+11 more)

### Community 59 - "dependencies"
Cohesion: 0.18
Nodes (12): Button(), ButtonProps, buttonVariants, cn(), class-variance-authority@^0.7.1, clsx@^2.1.1, @radix-ui/react-slot@^1.2.3, tailwind-merge@^3.7.0 (+4 more)

### Community 60 - "fixtures.ts"
Cohesion: 0.18
Nodes (18): RATE_LIMITS, WriterOptions, closeAll(), commit(), DEVICE, NOW, OTHER, records() (+10 more)

### Community 61 - "dashboard-header.tsx"
Cohesion: 0.31
Nodes (7): DashboardHeader(), descriptors, toneColor, ThemeToggle(), connectionTone(), date-fns@^4.1.0, date-fns

### Community 62 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, autoprefixer@^10.4.24, expo-file-system@~19.0.21, expo-gl@~16.0.10, lightningcss@^1.31.1, lucide-react-native@^0.562.0, react@19.1.0, react-native@0.81.5 (+15 more)

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
Cohesion: 0.14
Nodes (27): bucketLabel(), ChartEmpty(), EnergyChart(), firstIndexFrom(), historyOption(), PowerChart(), PowerOutputChart(), PowerSeries (+19 more)

### Community 67 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, build-storybook, dev, lint, start, storybook, test (+5 more)

### Community 68 - "layout.tsx"
Cohesion: 0.13
Nodes (10): inter, metadata, serwist, WorkerGlobalScope, THEME_KEY, themeInitScript, serwist@^9.0.12, @serwist/next@^9.5.13 (+2 more)

### Community 69 - "F.O.R.C.E Dashboard Design Extraction"
Cohesion: 0.18
Nodes (10): Charts and live indicator, F.O.R.C.E Dashboard Design Extraction, Icons, Known visual deviations / open data, Palette, Shape, borders and effects, Source and canvas, Tile grid and sidebar (+2 more)

### Community 70 - "F.O.R.C.E. Firebase Firestore setup"
Cohesion: 0.09
Nodes (21): 10. Decisions and limitations to review, 11. Files, 1. How it fits the existing system, 2. Firestore collections, 4. How synchronisation works, 5. Security model, 6. Manual steps you must do, 7. Verify that data reaches Firestore (+13 more)

### Community 71 - "scripts"
Cohesion: 0.08
Nodes (24): scripts, check, check:all, check:generated, check:web, cloud:agent, cloud:check, cloud:grant-reader (+16 more)

### Community 72 - "8. Firmware side: how INA219 readings reach the app"
Cohesion: 0.50
Nodes (4): 8. Firmware side: how INA219 readings reach the app, Flash and run, Serial Monitor report (115200 baud, every 2 s), Wireless monitor page (`tools/ble_check.html`)

### Community 73 - "next.config.mjs"
Cohesion: 0.16
Nodes (10): dynamic, ENGINE_MODES, resolveEngineMode(), baseConfig, FORCE_PACKAGES, nextConfig(), ROOT, withSerwist (+2 more)

### Community 74 - "hardware-path.test.ts"
Cohesion: 0.15
Nodes (4): CHART_FLUSH_MS, board(), Char, L

### Community 75 - "dependencies"
Cohesion: 0.09
Nodes (22): dependencies, echarts@^5.6.0, echarts-for-react@^3.0.2, @force/cloud@*, @force/contracts@*, @force/engine@*, @force/worker@*, lucide-react@^0.468.0 (+14 more)

### Community 76 - "cloud-agent/package.json"
Cohesion: 0.07
Nodes (32): dependencies, firebase-admin@14.5.1, @force/cloud@*, @force/contracts@*, @force/engine@*, description, devDependencies, firebase@13.3.0 (+24 more)

### Community 77 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint@10.15.0, fake-indexeddb@6.2.8, prettier@3.10.1, @types/node@26.6.6, typescript@5.9.3, vitest@4.1.12, eslint (+5 more)

### Community 78 - "@playwright/test"
Cohesion: 0.08
Nodes (11): @playwright/test@^1.49.1, port, port, errors, out, seen, timeout, OPTIONAL (+3 more)

### Community 79 - "hex-heatmap.stories.tsx"
Cohesion: 0.17
Nodes (8): HexHeatmap(), Props, meta, Reference27Tiles, Story, tiles, TileInfo, preview

### Community 80 - "extends"
Cohesion: 0.50
Nodes (3): extends, next/core-web-vitals, next/typescript

### Community 81 - "main.ts"
Cohesion: 0.50
Nodes (3): @storybook/react-vite@^8.6.19, config, @storybook/react-vite

### Community 83 - "cloud/package.json"
Cohesion: 0.11
Nodes (21): dependencies, dexie@4.4.7, @force/contracts@*, @force/engine@*, @force/storage@*, description, devDependencies, @force/simulator@* (+13 more)

### Community 86 - "createMockEngine"
Cohesion: 0.18
Nodes (17): Seam and packaging, 1. Workstreams, M8. Sources, mock engine, facade, INTEGRATION.md, 1. Setup, 2. The ten-minute tour, 4. The mock engine, 5. Behaviour to rely on, 6. Additions beyond the brief's seam (+9 more)

### Community 88 - "dexie.ts"
Cohesion: 0.13
Nodes (8): LocalSource, SessionSyncState, DEVICE_DB_NAME, deviceDatabaseSource(), DexieSyncStateStore, SYNC_DB_NAME, SyncDatabase, openDatabase()

### Community 89 - "eslint.config.js"
Cohesion: 0.25
Nodes (7): browserOnly, @eslint/js@10.0.1, globals@17.14.0, typescript-eslint@8.72.2, @eslint/js, globals, typescript-eslint

### Community 90 - "F.O.R.C.E (Florix Energy)"
Cohesion: 0.33
Nodes (5): Architecture, Check, F.O.R.C.E (Florix Energy), Install (from the repo root only), Run

### Community 91 - "Environment configuration"
Cohesion: 0.40
Nodes (4): Data isolation, Environment configuration, Variables, What is configured, measured or estimated

### Community 92 - "fakes.ts"
Cohesion: 0.13
Nodes (9): GattServerLike, ServiceLike, INFO_JSON, Listener, DEVICE_INFO_CHAR_UUID, SERVICE_UUID, TELEMETRY_CHAR_UUID, Pulse (+1 more)

### Community 94 - "src/main.ts"
Cohesion: 0.07
Nodes (38): port, root, TYPES, classifyFirestoreError(), checkCredentialsFile(), ConfigError, describeConfig(), Env (+30 more)

### Community 95 - "SyncClient"
Cohesion: 0.24
Nodes (6): policyOf(), SyncClient, AgentPolicy, dataFingerprint(), fullFingerprint(), SessionRecord

### Community 96 - "expo"
Cohesion: 0.10
Nodes (20): package, permissions, projectId, expo, android, extra, ios, name (+12 more)

### Community 98 - "days.ts"
Cohesion: 0.31
Nodes (8): currentTimeZone(), localDateKey(), LocalDay, localDay(), localDaysSpanned(), localDayStart(), nextLocalDay(), pad()

### Community 100 - "destop/package.json"
Cohesion: 0.11
Nodes (17): { app, BrowserWindow }, path, build, appId, win, devDependencies, electron@^28.0.0, electron-builder@^24.0.0 (+9 more)

### Community 101 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @babel/core@^7.29.0, eslint@^9.39.3, eslint-plugin-react@^7.37.5, eslint-plugin-react-hooks@^7.0.1, @types/node@^22.14.0, @types/react@~19.1.10, typescript@~5.9.2 (+11 more)

### Community 102 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, allowJs, experimentalDecorators, isolatedModules, jsx, lib, module (+10 more)

### Community 105 - "bluetooth.test.ts"
Cohesion: 0.11
Nodes (13): RECONNECT_BACKOFF_MS, RECONNECT_WINDOW_MS, FakeClock, PACKET, setup(), streaming(), EXPECTED_INFO, FakeBluetooth (+5 more)

### Community 107 - "sequence.ts"
Cohesion: 0.33
Nodes (5): LATE_SEQ_WINDOW, LATE_TIME_WINDOW_MS, SeqClass, DEVICE_TIME_MODULUS, SEQ_MODULUS

### Community 108 - "F.O.R.C.E. multi-agent plan"
Cohesion: 0.17
Nodes (11): Agents and file ownership, Always ask the user first, Codex, F.O.R.C.E. multi-agent plan, Protected (no agent edits without the user's approval), Second Claude account, Task board, Token rules (+3 more)

### Community 110 - "Florix APP/package.json"
Cohesion: 0.12
Nodes (16): expo-asset@~12.0.12, expo-device@~8.0.10, @expo/metro-runtime@~6.1.2, react-native-reanimated@~4.1.1, tailwindcss@^3.4.19, tailwindcss, name, optionalDependencies (+8 more)

### Community 111 - "startCloudSync"
Cohesion: 0.33
Nodes (5): startCloudSync(), client(), source(), fetchTransport(), message()

### Community 112 - "F.O.R.C.E Dashboard Implementation Plan"
Cohesion: 0.33
Nodes (5): Component list, F.O.R.C.E Dashboard Implementation Plan, Proposed folders, Risks and assumptions, Task structure

### Community 113 - "Integration test: board to UI"
Cohesion: 0.33
Nodes (5): Integration test: board to UI, Remaining integration gaps, Running the real browser test, Status, What the automated test proves (simulated radio)

### Community 114 - "analytics.ts"
Cohesion: 0.24
Nodes (10): 9. fedfront integration, Bucket, HistoryPoint, Range, addLocalDays(), DayTotals, getHistory(), getTodayVsYesterday() (+2 more)

### Community 115 - "Release readiness (software)"
Cohesion: 0.40
Nodes (4): Known limitations, Placeholders and assumptions shown in the UI, Release readiness (software), Test report

### Community 121 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, android, build, dev, ios, lint, preview, start (+1 more)

### Community 122 - "metro.config.js"
Cohesion: 0.25
Nodes (7): config, { getDefaultConfig }, { withNativeWind }, expo@~54.0.34, nativewind@^4.2.2, expo, nativewind

### Community 123 - "Data Collection Requirements: traceability"
Cohesion: 0.25
Nodes (8): 1. Scope and assumptions, 3. Acquisition and sampling, 4. Event detection, 5. Formulas, 6. Transmission, storage, export, 7. Quality, failure, acceptance, 8. Decisions needed from you, Data Collection Requirements: traceability

### Community 124 - "Decisions and assumptions"
Cohesion: 0.25
Nodes (8): Data Collection Requirements doc (DCR), Decisions and assumptions, Device sources (M8), Engine (M4, M5), Inputs and environment, Protocol, Storage (M7), Worker and facade (M7, M8)

### Community 125 - "vite.config.ts"
Cohesion: 0.33
Nodes (4): vite@^6.2.0, @vitejs/plugin-react@^5.0.0, vite, @vitejs/plugin-react

## Knowledge Gaps
- **71 isolated node(s):** `expo/tsconfig.base`, `DASHBOARD`, `POWER_USAGE`, `PRESSURE_SENSOR`, `next/core-web-vitals` (+66 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 941 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `First run on real hardware (Board 1, 15 Nov 2026, over USB serial)` connect `main.cpp` to `WorkerHost`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `DashboardEngine` (e.g. with `Storage (M7)` and `1. Workstreams`) actually correct?**
  _`DashboardEngine` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `expo/tsconfig.base`, `DASHBOARD`, `POWER_USAGE` to the rest of the system?**
  _71 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `session.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06829268292682927 - nodes in this community are weakly interconnected._
- **Why does `withProfileDefaults()` connect `WorkerHost` to `contracts/src/index.ts`, `DeviceProfile`, `db.ts`, `main.cpp`, `helpers.ts`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Pipeline` (e.g. with `Engine (M4, M5)` and `Storage (M7)`) actually correct?**
  _`Pipeline` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `test_sensor_bench/test_main.cpp` be split into smaller, more focused modules?**
  _Cohesion score 0.10052910052910052 - nodes in this community are weakly interconnected._