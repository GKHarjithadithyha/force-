# F.O.R.C.E: Implementation Plan

Inputs: PRD, System Architecture, Tech Stack, and the Data Collection Requirements doc (DCR). DCR is traced line by line in
[DATA_COLLECTION_TRACEABILITY.md](DATA_COLLECTION_TRACEABILITY.md): what was adopted, what is already covered, what is deferred, and what conflicts and needs a decision.

Scope: everything except the frontend UI (`apps/web` is left empty for the frontend developer).
Authority: PRD decides **what**, Architecture decides **how**, Tech Stack decides **tools**.
Deviations and assumptions live in [DECISIONS.md](DECISIONS.md). Checkboxes below are kept current.

## 1. Workstreams

| ID  | Workstream        | Output                                                                                | Depends on |
| --- | ----------------- | ------------------------------------------------------------------------------------- | ---------- |
| P   | Protocol          | `packages/protocol`: constants, worked packets, generated C header + C++ test vectors | none       |
| C   | Contracts (seam)  | `packages/contracts`: types + `DashboardEngine`                                       | none       |
| A   | Firmware          | `firmware/` PlatformIO ESP32 project, host tests, `tools/ble_check.html`, bench docs  | P          |
| B1  | Engine            | decoder, sequence tracker, M1-M19, step detector, pipeline (pure TS)                  | P, C       |
| B2  | Simulator         | 15-byte packet generator with scripted faults                                         | P          |
| B3  | Device sources    | Bluetooth / Demo / Replay behind one interface                                        | P, C, B2   |
| B4  | Storage           | Dexie stores, writer, recovery, retention, CSV/JSON                                   | B1, C      |
| B5  | Worker + facade   | Web Worker host, main-thread client, `createDashboardEngine`, `createMockEngine`      | B1-B4      |
| D   | Docs              | INTEGRATION, PACKET_EXAMPLES, BENCH_TEST, DECISIONS                                   | all        |

## 2. Repo structure

```
package.json            npm workspaces root, scripts
tsconfig.base.json      strict TS shared config
eslint.config.js  .prettierrc.json  vitest.config.ts  .github/workflows/ci.yml
packages/
  protocol/   src/index.ts (constants) src/vectors.ts (worked packets) scripts/generate.ts
  contracts/  src/index.ts (types only)
  engine/     src/{decoder,sequence,energy,steps,esg,session,pipeline,profile}.ts
  device/     src/{source,bluetooth,demo,replay,connection}.ts
  simulator/  src/{simulator,faults}.ts
  storage/    src/{db,writer,recovery,export,retention}.ts
  worker/     src/{worker,protocol-messages,client,mock}.ts   (also hosts createDashboardEngine)
firmware/
  platformio.ini  include/{config.h,protocol_generated.h}
  src/{main.cpp,ina219.*,sampler.*,ble_server.*}  lib/packet/{packet.h,packet.cpp}
  test/test_packet/test_main.cpp  test/vectors_generated.h
tools/ble_check.html
apps/web/             EMPTY (frontend developer)
docs/                 IMPLEMENTATION_PLAN, DECISIONS, INTEGRATION, PACKET_EXAMPLES, BENCH_TEST
```

## 3. Milestones (build order)

Each milestone ends with: tests run, results reported, plan updated.

### M1. Repo, tooling, CI, protocol, contracts

- [x] npm workspaces root, strict `tsconfig.base.json`, ESLint, Prettier, Vitest, `.gitignore`
- [x] `packages/protocol`: UUIDs, name prefix, layout offsets, flag bits, Device Info shape/parser
- [x] `packages/contracts`: seam types, `DashboardEngine`
- [x] GitHub Actions workflow (TS: typecheck, lint, test; firmware: `pio test -e native`, `pio run`)
- [x] `apps/web/.gitkeep`
- **Accept:** `npm run typecheck && npm run lint && npm test` pass on a clean checkout.

### M2. Packet packer and decoder, shared worked examples

- [x] `packages/protocol` worked vectors (>= 3 plus edge cases) as the single source
- [x] Generator writes `firmware/include/protocol_generated.h` and `firmware/test/vectors_generated.h`; a TS test fails if generated files are stale
- [x] `firmware/lib/packet`: `pack_telemetry()`, flag helpers, power rounding
- [x] TS decoder + validator in `packages/engine`
- [x] Firmware host test (Unity, `pio test -e native`) and TS test agree byte for byte
- [x] `docs/PACKET_EXAMPLES.md` generated from the vectors
- **Accept:** same vectors pass in both languages; config.h/protocol constants test proves match.

### M3. Firmware BENCH_MODE streaming + `tools/ble_check.html`

- [x] `config.h` (every tunable), name from BLE MAC, NimBLE server, Device Info read, notify
- [x] Sampler task (`vTaskDelayUntil`), SPSC queue/ring to BLE task, non-blocking notify
- [x] `BENCH_MODE` synthetic footsteps (90 steps/min, 100-200 ms pulses, noise, up to 60 W)
- [x] `tools/ble_check.html` (Web Bluetooth, decodes, V/I/P, pps, lost count)
- **Accept:** `pio run -e esp32dev_bench` compiles; host tests pass; ble_check decoder verified against vectors in Node.

### M4. Engine: energy and gaps with golden files

- [x] Integer energy, doubled sum in nJ, per-minute fold; interval rule (<= 1000 ms)
- [x] Sequence tracking mod 65536; device-time wrap; gap records; bridged vs excluded
- [x] Golden-file test: recorded session vs hand calculation within 0.1%
- [x] DCR: per-step record fields (`id`, `stepNumber`, `avgW`, trigger V/I), `lastPacketAt`, `minPulseMs`, `minStepGapMs >= 50`, thresholds retuned to the real 0.5-2.5 W scale
- [x] DCR: cloud-ready payload builders (`footstep_event`, heartbeat) in `@force/engine`
- **Accept:** golden and unit tests pass.

### M5. Step detector and remaining metrics

- [x] Hysteresis step detector, min gap, pulse energy, cadence (10 s), steps per clock hour
- [x] M4 state with hold, M7, M8, ESG M13-M16 (profile driven), limit and low-rate flags, restart = new session
- **Accept:** one unit test per formula; step accuracy test on simulated walks.

### M6. Simulator and fault injection

- [x] Packet simulator: cadence, amplitude, noise, rate, jitter-free schedule
- [x] Faults: lost packets, duplicates, reorder, 5 s dropout, restart, stale stream, limit clip, malformed
- [x] Fault-injection tests for every row of Architecture section 12
- **Accept:** each fault yields the documented gap/session behaviour.

### M7. Storage and worker

- [x] Dexie stores (section 9), packed 1 s chunks, one transaction per second
- [x] DCR: `getTotals(fromMs, toMs)` (steps today, daily totals, tz-free) and `exportStepsCsv(fromMs, toMs)` (daily report, one row per step, `current_A` column)
- [x] DCR: JSON export carries `meta.measurementBoundary` and shunt assumption
- [x] Interrupted-session recovery, retention, quota warning, CSV/JSON export/import, additive migrations
- [x] Worker host: decode, sequence, engine, writer, 100 ms snapshots, history queries
- **Accept:** reprocessing a stored session reproduces live totals exactly (fake-indexeddb).

### M8. Sources, mock engine, facade, INTEGRATION.md

- [x] `BluetoothSource` + connection state machine (Architecture section 11), reconnect back-off 60 s
- [x] `DemoSource`, `ReplaySource`; common `DataSource` interface
- [x] `createDashboardEngine()` and `createMockEngine()`; `docs/INTEGRATION.md`
- **Accept:** state-machine tests with a fake GATT; mock engine drives the full `DashboardEngine` surface.

### M9. Real INA219 sampling and bench-test docs

- [x] Direct-register INA219 driver (32 V, /8 gain, 12-bit, no averaging), fault flag + background retry
- [x] Drop counters, rate-limited logging, watchdog (in `main.cpp`, compiled)
- [x] `docs/BENCH_TEST.md` (written; **the bench run itself is not done**: no board in this environment)
- **Accept:** `pio run -e esp32dev` compiles; INA219 conversion maths covered by host tests.

### M10. Performance run

- [x] 50 Hz x 1 h simulated (180 000 samples) through the pipeline: < 0.1 ms/sample (measured 0.0019 ms, see PERFORMANCE.md)
- [x] DCR: also 100 Hz x 1 h (360 000 samples) and report the number (0.0013 ms)
- **Accept:** perf test passes with recorded numbers in docs.

### M11. Actual load measurement and validation (NEXT)

Procedure and acceptance criteria: [LOAD_VALIDATION.md](LOAD_VALIDATION.md).

- [ ] Energise the measured circuit: `POWER INPUT: PRESENT` on serial and in the page (needs the 12 V loop wired through VIN+/VIN-, common ground, adapter isolation checked)
- [ ] Zero baseline with the load off (no input vs input present, offset noise)
- [ ] At least three load levels: 30 s page averages against a multimeter in series (current) and across the load (voltage)
- [ ] Shunt check from the ratio of INA219 to multimeter current; change `INA219_SHUNT_MOHM` only with this evidence
- [ ] 10-minute steady-load energy: page energy against multimeter V x I x t (PRD target within 5%)
- [ ] Confirm the R100 shunt's power rating before any run above the 2 A precaution level
- [ ] Record results in LOAD_VALIDATION.md and DECISIONS.md

## 3a. Status (15 Nov 2026)

All ten milestones are built and their automated acceptance checks pass: 289 TypeScript tests, 43 firmware host tests, all four firmware variants compile, and typecheck, ESLint and Prettier are clean.

**Verified on real hardware (Board 1):**

| Check | Result | Evidence |
| --- | --- | --- |
| Flash of `esp32dev` over the CP210x | Passed | esptool hash verification, 4 of 4 segments |
| Boot, INA219 found at 0x40, sensor and input status | Passed | serial log (H-22) |
| BLE advertising as `FORCE-E52E` | Passed | laptop scan, -53 to -59 dBm |
| GATT service, Device Info, telemetry notifications | Passed | 601 packets/30 s and 1,801/90 s at 20.0/s, 0 lost (H-22) |
| Rapid connect/disconnect cycles | Passed (8 of 8) | after the advertising watchdog (H-23) |
| **Chrome BLE dashboard end to end** | **PASSED** (owner-reported) | `tools/ble_check.html`: FORCE-E52E, firmware 1.0.0, STREAMING, 20 packets/s, 1,633 packets, 0 lost, flags 0x00, Device Info shown (H-24) |

**Not done, and why:** actual load measurement and validation (the measured circuit is still unpowered: bus 0.02 V, `NO INPUT`; this is milestone M11); the shunt value is unconfirmed by measurement (only the R100 marking); the R100 shunt's power rating; the GitHub Actions workflow has never run (no GitHub repo yet); retention is not wired to an automatic delete (needs a UI decision, DECISIONS ST-06); device-side buffering, MQTT and cloud from the Data Collection doc (needs your decision, DATA_COLLECTION_TRACEABILITY section 8); the frontend (`fedfront`) still runs on its own mock engine.

## 4. Test plan

| Level                 | Where                                 | What                                                                           |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Firmware host (Unity) | `firmware/test`                       | packer offsets, endianness, seq wrap, flags, negative current, rounding, INA219 maths |
| Cross-language        | `packages/protocol` + firmware        | shared vectors; generated-file drift test; config/protocol match test          |
| Unit                  | each TS package                       | every formula, every Architecture section 12 row                               |
| Golden                | `packages/engine/test/golden`         | energy vs hand calculation (0.1%); reprocess equals live                       |
| Fault injection       | `packages/simulator` + engine         | scripted faults                                                                |
| Storage/worker        | `packages/storage`, `packages/worker` | fake-indexeddb; recovery; export round trip                                    |
| Performance           | `packages/worker/test/perf`           | 50 Hz x 1 h, per-sample budget                                                 |
| Hardware in the loop  | manual, `docs/BENCH_TEST.md`          | idle, known load, 10-minute lost-packet run (needs a board; **not run here**)  |

## 5. Risks

| Risk                                                         | Mitigation                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| No board attached to this environment: firmware is compile-checked and host-tested only | Bench doc, ble_check tool; first hardware run is the user's                  |
| 0.1 ohm shunt is assumed                                     | One constant `INA219_SHUNT_MOHM`; user must confirm                          |
| Web Bluetooth is Chromium-only, main-thread-only             | Source on main thread; unsupported state + demo                              |
| NimBLE-Arduino 2.x API drift                                 | Pinned versions; compile in CI                                               |
| Seq/time heuristics for restart vs late packet              | Documented rules in DECISIONS, covered by fault tests                        |
| Float rounding in ESG                                        | Integer path to energy; floats only for display and ESG                      |

## 6. Open questions (none block)

1. Shunt resistance really 0.1 ohm? (assumed; constant in `config.h`)
2. How is the ESP32 powered in the field? (USB assumed; only matters for brown-out/watchdog behaviour)
3. Score formula, emission factor, wellness definition: placeholders, profile-driven.
4. Does existing firmware send another format? If yes, add a decoder behind the decoder interface.
5. Sensor limit with six modules: 3.2 A (INA219 rating) assumed.
