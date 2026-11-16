# Integration guide for the frontend (apps/web)

Everything below the UI is built: the firmware, the data layer, and a typed interface. You code against **one interface** and can build the whole UI today without hardware.

- Types: `@force/contracts` (types only).
- Engines: `createDashboardEngine()` (real device) and `createMockEngine()` (simulator, no hardware), both from `@force/worker`.
- Both return the same `DashboardEngine`. Swap one for the other with a flag and nothing else changes.

> **Rule:** never change `packages/contracts` without telling the data-layer side; every change is listed in the change log at the bottom of this file. Never break it silently.

## 1. Setup

The packages are plain TypeScript consumed from source (no build step). In `apps/web/package.json`:

```json
{ "dependencies": { "@force/contracts": "*", "@force/worker": "*" } }
```

Run `npm install` at the repo root (npm workspaces links them).

**Next.js (App Router, static export).** All engine code is browser-only.

```ts
// next.config.ts
export default { output: 'export', transpilePackages: ['@force/contracts', '@force/worker', '@force/engine', '@force/device', '@force/storage', '@force/simulator', '@force/protocol'] };
```

Create the engine once, in a client module (`"use client"`), never during server rendering:

```ts
// lib/engine.ts
'use client';
import { createDashboardEngine, createMockEngine } from '@force/worker';
import type { DashboardEngine } from '@force/contracts';

let engine: DashboardEngine | null = null;
export function getEngine(): DashboardEngine {
  if (!engine) {
    engine = process.env.NEXT_PUBLIC_MOCK === '1' ? createMockEngine({ autoStart: false }) : createDashboardEngine();
  }
  return engine;
}
```

The real engine starts its Web Worker with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` inside `@force/worker`; webpack 5 and Vite both bundle that pattern. If your bundler does not pick it up from `node_modules`, make your own worker file and pass it in:

```ts
// app/force.worker.ts
import '@force/worker/worker';
// elsewhere
import { createEngine } from '@force/worker';
const engine = createEngine({ createWorker: () => new Worker(new URL('./force.worker.ts', import.meta.url), { type: 'module' }) as any });
```

Web Bluetooth needs HTTPS (localhost counts), a Chromium browser, and a user click.

## 2. The ten-minute tour

```ts
const engine = getEngine();

// Zustand slice (the Tech Stack says screens subscribe to slices)
const useLive = create<{ snap: LiveSnapshot | null }>(() => ({ snap: null }));
engine.subscribeSnapshot((snap) => useLive.setState({ snap }));   // about every 100 ms

// Live chart: append, do not replace. Keep a ring buffer for the chosen window.
engine.subscribeChart((b) => appendToRing(b.times, b.powerW, b.voltageV, b.currentMa));
engine.subscribeGaps((g) => addGapShading(g.startMs, g.endMs, g.cause));
engine.subscribeSteps((s) => addStepMarker(s.t, s.peakW));

// Buttons
<button onClick={() => engine.connect()}>Connect</button>   // MUST run inside the click handler
<button onClick={() => engine.startDemo({ cadenceSpm: 90 })}>Demo</button>
<button onClick={() => engine.stop()}>Stop</button>
```

Every `subscribe*` returns an unsubscribe function: call it in your effect cleanup. `subscribeSnapshot` calls you back immediately with the latest snapshot if there is one.

## 3. What each part means

### Time and units
- Every absolute time is **epoch milliseconds, UTC**. Format with date-fns in the local zone.
- Power W, voltage V, current **mA**, energy J and Wh. `null` means "not measured": show a dash, never zero.
- `stepsPerHour` keys are UTC hour starts as ISO strings (`"2026-11-15T14:00:00.000Z"`): parse with `new Date(key)`.

### `LiveSnapshot`
| Field | Notes |
| --- | --- |
| `connection` | The state machine below. |
| `source` | `'device' \| 'demo' \| 'replay'`. **Show a banner whenever it is not `'device'`** (Architecture section 10); these sessions are also labelled in the session list. |
| `sessionId` | `null` while no session is open. After Stop, the last numbers remain in `metrics` but `sessionId` is `null`. |
| `metrics.measurementValid` | **Read this before showing any live number.** True only while the newest sample is a real measurement. False before the first sample and while the sensor is faulted or sending invalid readings: `voltageV`, `currentMa`, `powerW` then hold the LAST REAL values (never made-up ones), so dim them and show the `sensor_fault` alert. |
| `metrics.inputPresent` | True only when the newest sample is valid AND the bus voltage is at least the profile's `minInputV` (default 1 V). False means **no power source is detected, even though the sensor works**: show "No input", never a normal active source with zero current. An over-26 V source counts as present (it is out of spec, see `over_voltage`). |
| `metrics` | M1-M19. `cadenceSpm` is `null` until 10 s of continuous data exist. `energyPerStepJ` is `null` until the first step. `kcal` is `null` unless the profile has `kcalPerStep`. `rssiDbm` is `null` when the browser gives no value (usual on an open connection): show "not available". |
| `quality` | The data-quality line: show `recordedMs` next to every energy total, plus `bridgedMs`, `excludedGapMs`, `lostPackets`, `droppedPackets`. `recordedMs` includes `bridgedMs`. |
| `quality.detail` | Counters behind the line; `stepsUnreliable` is true while the sample rate is under 20 Hz. |
| `alerts` | Active alerts. `kind` is one of `sensor_limit`, `sensor_fault`, `no_data`, `no_generation`, `low_sample_rate`, `device_restart`, `no_input`, `over_voltage`, `storage_low`, `storage_error`, `clock_drift`, `source_error`. `message` is plain language and safe to show as is. |
| `lastPacketAt` | When the newest packet arrived (the "last seen" indicator). |

### Connection states (Architecture section 11)
| State | Show |
| --- | --- |
| `unsupported` | "Use Chrome or Edge" and offer demo. `connect()` rejects. `supported()` is false. |
| `idle` | Big Connect button, demo link. |
| `choosing` | The browser's own picker is open: show nothing special. |
| `connecting` | Spinner. |
| `streaming` | Live. |
| `stale` | Link open, no packet for over 1 s: dim the values, "No data". |
| `reconnecting` | Banner "Reconnecting..." (retries run for 60 s, then state becomes `idle`). The session stays open and continues. |
| `error` | The reason is in `alerts` (`source_error`). Offer Retry. |

A cancelled picker returns to `idle` without an error.

### Charts
- `ChartBatch` arrays are typed arrays of equal length, new points only. They are transferred to you, so you own them.
- **Gaps are never filled.** Draw a break at each `GapRecord`; do not interpolate. Causes: `lost_packets`, `link_down`, `device_restart`, `stale`.
- History: `getSessionSeries(id, [from, to])` returns raw samples for ranges up to an hour (reduce to min and max per pixel column so peaks survive) and **per-minute averages** beyond an hour (voltage and current are `NaN` there). Pair it with `getSessionGaps` and `getSessionSteps` for shading and markers.
- Axis scale: real output is about 0.5 to 2.5 W (the mock-up's 1,200 W is not real); scale to the data.

### Sessions
- A session opens at the first packet and closes on Stop, Disconnect, 60 s of failed reconnecting, or a device restart (the restart closes the current session and opens the next; an alert names both).
- `listSessions()` shows an open session only after the next once-a-second save. Sessions cut off by a closed tab are marked `interrupted` on the next start.
- Totals (M6, ESG) only add **real device** sessions. Demo and replay never feed them.

### Settings and recalculation
- `getProfile()` / `saveProfile(p)`. Invalid values reject with a message. A saved profile applies from the next sample.
- The default ESG values (emission factor, targets, weights) are **placeholders**; the Settings screen must say so until the business confirms them. The default thresholds (step 0.5 W, idle 0.05 W) are also starting points for the Calibration screen.
- **Calibration:** show live power and draw `stepThresholdW` and half of it. After the user changes it, call `recomputeSession(id, profile)` on a stopped session and then `getSessionSteps(id)` for the new markers. Raw samples are never edited. For a live preview, save the profile and watch `subscribeSteps`.
- `recomputeSession` throws for an open session or one whose raw data was removed by retention.

### Today, daily totals and the daily report
`getTotals(fromMs, toMs)` returns steps, energy, recorded time and peak for real-device sessions in a range. The data layer has no time zone: **you pass the bounds of the user's local day**.

```ts
const start = startOfDay(new Date()).getTime();
const today = await engine.getTotals(start, start + 86_400_000);
const csv = await engine.exportStepsCsv(start, start + 86_400_000);   // one row per step
```

### Exports and replay
- `exportCsv(id)`: raw samples with energy and step markers. `exportStepsCsv(from, to)`: the daily report. `exportSessionJson(id)`: a backup that `startReplay(file)` plays back at its original timing (as source `replay`).
- Files are untrusted: bad ones reject with a plain message (`startReplay` throws; show it).
- Download a `Blob` with `URL.createObjectURL`.

## 4. The mock engine

```ts
const mock = createMockEngine({ sim: { cadenceSpm: 100, peakW: 2 } });
await mock.connect();                              // starts the simulator, source 'demo'
mock.injectFault({ kind: 'stale', durationMs: 4000 }, 2000);   // 2 s from now
```

Faults: `drop` (a short one is bridged; every one is counted), `stale`, `duplicate`, `reorder`, `restart`, `clip`, `sensor_fault`, `malformed`, `bad_voltage`. Use them to build every empty and error state in PRD section 8. The mock stores into its own IndexedDB (`force-mock`), so it never touches real sessions. It runs on the main thread, not a Web Worker.

## 5. Behaviour to rely on

- `connect()` is the only call that needs a user gesture. Start it directly in the click handler.
- A hidden tab can be throttled by the browser: use the Screen Wake Lock API during a session and warn when the tab is hidden (frontend responsibility, Architecture section 10).
- If the worker hits an unexpected error, the engine replaces it, ends the session (data saved) and raises a `source_error` alert; the user reconnects.
- `engine.dispose()` exists on the objects returned by `createEngine` / `createMockEngine` (not part of the seam) for teardown.
- Nothing is sent to any server. The only persistence is the browser's IndexedDB.

## 6. Additions beyond the brief's seam

The brief's `DashboardEngine` is fully implemented as written. These **additive** items were needed by PRD requirements and change nothing that existed:

| Addition | Why |
| --- | --- |
| `getSessionSteps(id)`, `getSessionGaps(id)` | Step markers and gap shading on history charts (FR-4, FR-10, FR-15). |
| `renameSession(id, name)`, `deleteSession(id)`, `SessionSummary.name` | FR-7: name sessions; Sessions screen: rename and delete. |
| `getTotals(fromMs, toMs)`, `exportStepsCsv(fromMs, toMs)`, `RangeTotals` | Data Collection doc: steps today, daily totals, daily report. |
| `LiveQuality.detail` | The data-quality line (Architecture section 12). |
| `LiveSnapshot.lastPacketAt` | Data Collection doc: Last_Comm_TS. |
| `StepEvent.id, stepNumber, avgW, voltageV, currentMa` | Data Collection doc: per-event record fields, idempotent ids. |
| `DeviceProfile.minPulseMs` | Data Collection doc: reject blips. |
| `LiveMetrics.measurementValid`, `LiveMetrics.inputPresent`, `DeviceProfile.minInputV`, alert kinds `no_input` and `over_voltage` (v0.2.0) | Separate "sensor works" from "there is a power source": an unpowered input must not look like a normal active source. Profiles and backups from before this field are completed with the default (`minInputV` = 1 V), so stored data keeps working. A frontend that builds a full `DeviceProfile` object must now include `minInputV`. |
| `importSession(file)` (v0.3.0) | Backup restore: imports a `exportSessionJson` backup as a new session (never overwrites; a clashing id gets a suffix) and rebuilds derived records from the raw samples. Rejects invalid files with a plain message. Wraps the worker's existing `importSessionJson` RPC. |
| `createDashboardEngine` and `createMockEngine` live in `@force/worker`, not in `@force/contracts` | A factory inside contracts would make the types package depend on the whole runtime. `@force/worker` re-exports every contract type, so one import is enough. |

## 7. Still open (do not block the UI)

- ESG score formula, emission factor, wellness definition: profile-driven placeholders.
- The shunt value (assumed 0.1 ohm) and the measurement point (after the rectifier, per the brief; the Data Collection doc says "TBD"): see [BENCH_TEST.md](BENCH_TEST.md). Exports record both assumptions.
- Sample rate default (20 Hz) is under review: see [DATA_COLLECTION_TRACEABILITY.md](DATA_COLLECTION_TRACEABILITY.md).
- RSSI is only available when the browser exposes advertisement events.

## 8. Firmware side: how INA219 readings reach the app

No app change was needed: the existing data flow already carries every INA219 value.

```
INA219 (0x40, gain /8, 32 V range, 12-bit, no averaging)
  -> firmware sampler task, fixed 20 Hz schedule (device time stamped)
       shunt reg x 10 uV / INA219_SHUNT_MOHM = mA ; bus reg >> 3 x 4 mV = mV ; power = mV x mA / 1000 mW
  -> 15-byte BLE packet (RAW, unfiltered: seq, time, mV, mA, mW, flags)
  -> engine: energy, steps, alerts   -> LiveSnapshot (voltageV, currentMa, powerW, ...)
  -> dashboard
```

| Firmware condition | What the app sees |
| --- | --- |
| INA219 not answering | flag bit0, readings 0 -> `measurementValid` false, `inputPresent` false, alert `sensor_fault`; those samples are never used as data or energy |
| INA219 answers with impossible register values (all-ones bus register, shunt on a 16-bit rail) | the same fault packet (counted in the serial `[diag]` line as `invalid reads`) |
| sensor healthy but **bus voltage below the minimum** (an unpowered input reads about 0.02 V) | **not a BLE flag.** The app derives it from the voltage: `inputPresent` false, alert `no_input`, power and energy stay 0. The serial report shows `POWER INPUT: NO INPUT (UNDERVOLTAGE)`. |
| current at or above the sensor limit (3200 mA at 0.1 ohm) or ADC saturated | flag bit1 -> `metrics.sensorLimitReached`, alert `sensor_limit` |
| negative current (offset noise or reversed wiring) | `currentMa` signed as read, power 0, counted in `quality.detail.negativePowerSamples` |
| bus above 26 V (INA219 rating) | **not a BLE flag** (two flag bits only). The app derives it: alert `over_voltage` (error). Samples are still integrated because they were measured, but they are outside the chip's specification, so treat the energy of that period as suspect. The serial shows `POWER INPUT: OVER VOLTAGE`. |

**Three separate questions, three separate answers.** Never let one stand in for another:

| Question | Firmware serial line | App |
| --- | --- | --- |
| Is the INA219 answering on I2C? | `INA219 STATUS` | `sensor_fault` alert / `measurementValid` |
| Are the readings valid and in range? | `SENSOR STATUS` | `measurementValid`, `sensor_limit`, `negativePowerSamples` |
| Is there a power source on the input? | `POWER INPUT` | `inputPresent`, `no_input`, `over_voltage` |

The BLE packet format is unchanged: no flag bit was added. Older firmware and older stored data keep working. The minimum input voltage is `minInputV` in the profile on the app side (default 1 V) and `INPUT_MIN_MV` in `firmware/include/config.h` for the serial report (default 1000 mV). **Both defaults are assumptions**: the generator's real output range is not known yet. An idle footstep tile legitimately reads about 0 V between steps, so expect `no_input` to show while nobody is walking on it; set the threshold from real measurements, or to 0 to switch the alert off.

**Shunt current caution (H-16).** The firmware warns at 2 A (`HIGH_CURRENT_WARN_MA`). That is a **precautionary level, not a verified safe operating limit**: the R100 shunt's power rating is unknown. At 0.1 ohm the shunt dissipates 0.1 W at 1 A, 0.4 W at 2 A, 0.9 W at 3 A and 1.02 W at the 3.2 A sensor full scale. Staying below 2 A does not prove the shunt is safe, and the level is not proof that more is unsafe. Confirm the shunt's rated power, then set the value.

The **averaging** the serial report does (one value per 2 s) is for the Serial Monitor only. The BLE stream is raw by design, so the app's energy and step logic see every sample.

### Wireless monitor page (`tools/ble_check.html`)

BLE is the primary interface; USB serial is only for flashing and debugging. The page connects to `FORCE-XXXX` (service `3b94f647-2d69-4b87-9cfa-cbd59e4980b1`, telemetry notify `e16ad3d7-71eb-4ae8-ae94-701c916112ed`, Device Info read `529e09a0-9596-4c47-a9f5-f02da6b2ba91`), and shows connection state (`NOT CONNECTED`, `CONNECTING`, `STREAMING`, `STALE` after 1 s without a packet, `RECONNECTING` with the engine's 1, 2, 4, 5 s back-off for 60 s, `DISCONNECTED`), bus voltage, shunt voltage, current, power, energy, sensor status, power input, and the timestamp of the last valid reading.

**Verified end to end in Chrome** (owner-reported, 15 Nov 2026): FORCE-E52E, firmware 1.0.0, STREAMING at 20 packets/s, 1,633 packets, 0 lost, Device Info shown.

With **no power input** (bus below the minimum) the four primary cards (bus voltage, shunt voltage, current, power) show `—` and "no power input": zero current on a dead input is not a normal reading. The raw numbers stay in the "Raw reading" diagnostics row. A frontend should do the same with `metrics.inputPresent === false`: dash the primary tiles, keep raw values in a diagnostics view.

The **Validation capture** button averages 30 s of valid samples (mean, min, max, power, energy) for comparison with a multimeter ([LOAD_VALIDATION.md](LOAD_VALIDATION.md)).

Rules the page follows, same as the engine: live cards show `—` (never an old number) unless the link is `STREAMING` and the newest sample is a real measurement; the last real reading is listed separately with its time and marked "NOT current"; fault packets and impossible voltages are never used as data; energy is integrated only between two valid samples at most 1 s apart. **Shunt voltage is derived** (current x shunt), because the packet carries no shunt voltage; the shunt value comes from Device Info (`limitMa = 320000 / shunt_mohm`) and is never assumed. A unit test runs the page's own meter code against the engine on the same packets.

### Serial Monitor report (115200 baud, every 2 s)

```
ESP32 POWER MONITOR
-----------------------------
INA219 STATUS: CONNECTED            (or NOT RESPONDING, or SIMULATED (BENCH_MODE))
I2C ADDRESS: 0x40
BUS VOLTAGE: 12.30 V
SHUNT VOLTAGE: 42.000 mV
CURRENT: 420.00 mA (0.4200 A)
POWER: 5.166 W (5166 mW)
SENSOR STATUS: NORMAL               (NO DATA, SENSOR FAULT, INVALID READING, OVERRANGE,
                                     HIGH CURRENT, REVERSE CURRENT)
POWER INPUT: PRESENT                (NO INPUT (UNDERVOLTAGE), OVER VOLTAGE,
                                     UNKNOWN (NO VALID READING))
SAMPLES: 40 valid, 0 fault, 0 invalid | RATE: 20.0 Hz | SHUNT: 100 mOhm | BLE: advertising
-----------------------------
[diag] notified 0 | notify drops 0 | queue drops 0 | overruns 0 | sensor errors 0 | invalid reads 0
```

With no valid sample in an interval, the numeric lines read `n/a`. A `WARNING:` line follows each condition that is not fine (sensor and input are reported separately). For example, a working INA219 on an unpowered input prints `BUS VOLTAGE: 0.02 V`, `SENSOR STATUS: NORMAL`, `POWER INPUT: NO INPUT (UNDERVOLTAGE)` and a warning that zero current there is not a normal active source.

### Flash and run

```
cd firmware
pio test -e native                                   # 43 host tests
pio run -e esp32dev -t upload --upload-port COM6     # real sensor, 20 Hz
pio device monitor                                   # 115200
```

Other builds: `esp32dev_bench` (synthetic footsteps, no sensor), `esp32dev_50hz`, `esp32dev_100hz`. Then connect from the dashboard (or `tools/ble_check.html`) to `FORCE-XXXX`.

## Change log

| Date | Version | Change |
| --- | --- | --- |
| 2026-11-15 | 0.1.0 | First release of the seam. Brief's interface implemented in full plus the additions in section 6. |
| 2026-11-15 | 0.2.0 | Additive only. `LiveMetrics.measurementValid` and `LiveMetrics.inputPresent`; `DeviceProfile.minInputV` (default 1 V, assumption); alert kinds `no_input` and `over_voltage`. BLE packet unchanged. Old stored profiles and backups are completed with defaults. Firmware serial report gains a `POWER INPUT` line and `OVER VOLTAGE` moved from sensor status to power input. |
| 2026-11-15 | 0.3.0 | Additive only. `DashboardEngine.importSession(file)` (backup restore). The existing frontend in `fedfront/` now consumes `@force/contracts` and `@force/worker` directly (see section 9); its local contract copy and fake engine were removed. |
| 2026-11-16 | 0.3.1 | Behaviour fix, no type change. `importSession` / `importSessionJson` refuse a backup of a session that is already stored (same device and start time, under its id or an earlier import of it). Before, a second restore created a copy and the device totals counted it twice. fedfront joined the root npm workspaces (one lockfile). |
| 2026-11-16 | 0.4.0 | Additive, no contract change (`DashboardEngine` untouched). `Store.getTotalsExact(fromMs, toMs, deviceId?)` returns the same aggregation as `getTotals` (which now calls it) plus the exact energy as a BigInt; `Store.getSessionMinutes(id)`. New packages `@force/cloud` (Firestore model and browser sync client) and `@force/cloud-agent` (local Firestore writer). `AppEngine.sync` in fedfront; Cloud Sync panel on the Connection screen, shown only when `NEXT_PUBLIC_CLOUD_SYNC_URL` is set. See FIREBASE_SETUP.md. |

## 9. fedfront integration

`fedfront/` (Next.js static export) is the UI. It imports the packages from source through the root `node_modules/@force/*` workspace links (`transpilePackages`, `experimental.externalDir`, and a webpack `.js` to `.ts` extension alias in `fedfront/next.config.mjs`). Run `npm install` at the repo root before building fedfront.

- `fedfront/engine/index.ts` is the only place an engine is created. Default: the real engine (Web Worker, IndexedDB `force`, Web Bluetooth). `NEXT_PUBLIC_ENGINE=mock`: `createMockEngine({ autoStart: true })` on IndexedDB `force-mock`, plus a fault-injection panel.
- `fedfront/lib/live.ts`: display rules only. Power, voltage and current show a dash unless streaming a valid measurement with input present. Sensor status and power-input status are separate.
- `fedfront/lib/analytics.ts`: Overview history and today/yesterday from `getTotals` (real-device sessions only). CO2 uses the engine's `co2AvoidedKg`.
- The brand expansion is a browser display preference (`localStorage`), not part of `DeviceProfile`.
