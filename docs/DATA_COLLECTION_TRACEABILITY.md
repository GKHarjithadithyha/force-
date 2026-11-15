# Data Collection Requirements: traceability

Source: "Data Collection Requirements Document for F.O.R.C.E. Prototype" (PDF, supplied 15 Nov 2026), referred to here as **DCR**.
It is now an input alongside the PRD, Architecture and Tech Stack. Precedence is unchanged: PRD decides what, Architecture how, Tech Stack tools. DCR adds requirements; where it contradicts an earlier source or your brief, the row says so and the decision is recorded in [DECISIONS.md](DECISIONS.md).

Legend: **Covered** already met by the design. **Adopted** added to the plan or code because of DCR. **Deferred** needs hardware, cloud or firmware work outside this brief; not built. **Conflict** DCR disagrees with another source; resolution stated, user input requested where it matters.

## 1. Scope and assumptions

| DCR item | Status | How |
| --- | --- | --- |
| One monitoring system, one ESP32, tiles not distinguished | Covered | One device id per stream. |
| No new sensors | Covered | INA219 only. |
| UTC timestamps | Covered | All seam times are epoch ms (UTC). Local day is a display choice; see `getTotals`. |
| Measurement boundary (after rectifier, or after the LM2596 buck, TBD) | **Conflict, open** | Your brief and the PRD say after the bridge rectifier; DCR describes rectifier, 4,700 uF cap, then buck and says "TBD". Software is identical either way. Wiring stays as briefed. Recorded as an open hardware question; Device Info / exports carry the note "measurement boundary: after bridge rectifier (assumed, confirm with hardware team)". |
| No external/battery/environment data | Covered | Not collected. |

## 2. Data inventory

| DCR field | Status | Where it lives |
| --- | --- | --- |
| Footstep_Event (one per step, timestamp of detection) | Covered + Adopted | `StepEvent`; added `id` (event_id), `stepNumber`, `avgW`, `voltageV`/`currentMa` at trigger. |
| Step_Count (since local midnight) | Adopted | Live `metrics.steps` (session). Daily total via `getTotals(dayStartMs, dayEndMs)`; the caller supplies its local-day bounds so the data layer stays time-zone free. |
| Voltage (V, float) | Covered | `voltageV` (wire carries integer mV on purpose, see P-02). |
| Current (A, float) | Covered, unit differs | Seam and wire use mA (integer). Step CSV also writes `current_A`. |
| Instantaneous power = V x I | Covered | Exact integer microwatts, `powerW`. |
| Peak power (per event) | Covered | `StepEvent.peakW`; session peak M8. |
| Average power (E / event duration) | Adopted | `StepEvent.avgW`; session average M7. |
| Interval energy (integral of P dt per event) | Covered | `StepEvent.energyJ`. |
| Cumulative energy | Covered | M5/M6. |
| Last_Comm_TS | Adopted | `LiveSnapshot.lastPacketAt`. |
| Device_Status (ONLINE/OFFLINE, counters) | Covered | `ConnectionState` plus alerts and quality counters. |

## 3. Acquisition and sampling

| DCR item | Status | How |
| --- | --- | --- |
| Voltage and current sampled simultaneously | Covered, with a caveat | The INA219 converts shunt and bus continuously and the firmware reads both registers within about 1 ms. Not strictly simultaneous, which is acceptable at footstep timescales. |
| Sample rate >= 100 Hz, 500-1000 Hz preferred | **Conflict, open** | Your brief fixes 20 Hz default (raisable) and one sample per BLE notification; the PRD needs >= 20 Hz. `SAMPLE_RATE_HZ` is configurable up to 100 Hz in `config.h`, 100 Hz is added to the performance run, and BENCH_TEST measures real pulse width. **Recommendation: after the bench pulse-width measurement, raise to 50-100 Hz.** 500-1000 Hz is not possible with one packet per sample over BLE and is not attempted. |
| Event window buffering until the pulse decays | Covered | Step detector pulse window. |
| Raw high-rate data discarded after aggregation | **Conflict, resolved** | PRD/Architecture keep raw samples (reprocessing, golden files, 30-day retention). Raw is kept in the browser; nothing is discarded on the device because the device stores nothing. |
| Unique event id for idempotency | Adopted | `StepEvent.id` = `deviceId_yyyyMMddTHHmmssSSSZ`. Raw samples are idempotent by (session, seq). |
| UTC time from an ESP32 RTC | **Conflict, resolved** | The ESP32 sends device uptime only (fixed protocol). UTC comes from the browser clock at first packet plus device time (Architecture section 6). |
| Persist unsent data in ESP32 flash, resend on reconnect | Deferred | Not in the BLE streaming contract. A link outage is shown as a gap and never back-filled. Needs a decision (see section 8). |
| Local daily aggregation on the device | Adopted in the app | `getTotals`; nothing on the device. |
| Missing reading -> null, count the error | Covered | Sensor-fault samples carry no measurement, are flagged, counted and not charted; invented values are never used. |

## 4. Event detection

| DCR item | Status | How |
| --- | --- | --- |
| Threshold trigger, debounce, refractory 100-300 ms | Covered | Hysteresis at half the threshold plus `minStepGapMs` (default 250 ms). |
| One event per step, no lift/bounce double count | Covered | Minimum gap; tested with a double-step case. |
| Reject blips below a minimum width or integral | Adopted | New profile field `minPulseMs` (default 0 = off). |
| Moving-average filter before thresholding | Deferred | Brief says the firmware must not filter. If wanted, add it in the app as a profile option. |
| Two triggers < 50 ms apart: ignore the second | Adopted | `validateProfile` requires `minStepGapMs >= 50`. |
| Reject a step with implausible values (zero voltage) | Covered | A pulse needs power above threshold, which needs voltage > 0. |
| Threshold calibration | Covered | Defaults retuned to the DCR's real scale (0.5-2.5 W combined): step threshold 0.5 W, idle 0.05 W. Placeholders; calibrate on the tile. |

## 5. Formulas

| DCR item | Status | How |
| --- | --- | --- |
| Energy = sum of P x dt | Covered, refined | Trapezoid (average of neighbouring powers x device-time difference), per PRD/Architecture D4. Identical when power is constant; better on short pulses. |
| Average power = E / T_event | Adopted | `avgW`. |
| Peak = max P in window | Covered | |
| Daily step count and energy, reset at local midnight | Adopted | `getTotals(local day bounds)`; the app does not reset anything, it queries. |

## 6. Transmission, storage, export

| DCR item | Status | How |
| --- | --- | --- |
| MQTT / HTTP JSON to the cloud, ACK, retry, buffer >= 10 events | Deferred | PRD D10: no server in v1; cloud is Phase 3. **Adopted as groundwork:** pure functions in `@force/engine` build the DCR payloads (`footstep_event` and `heartbeat` JSON, field names exactly as in DCR section "Example Payloads") so a gateway or later cloud sync reuses one shape. |
| Raw messages kept >= 30 days | Covered | D6: 30 days of raw chunks. |
| CSV/Excel export, one row per step | Adopted | `exportStepsCsv(fromMs, toMs)`; Excel opens CSV. Native `.xlsx` is not produced. |
| Daily report at end of day | Adopted (data side) | `exportStepsCsv` with the day's bounds. The "automatic at end of day" trigger is a frontend concern. |
| Traceability notes "TBD - confirm with hardware team" | Adopted | JSON session export carries `meta.measurementBoundary` and the shunt assumption; INTEGRATION.md lists the TBDs. |

## 7. Quality, failure, acceptance

| DCR item | Status | How |
| --- | --- | --- |
| V > 20 V or I > 5 A flagged as error, set to null | **Conflict, resolved** | Limits come from the hardware instead: bus voltage above 32.764 V is malformed (dropped, counted); current is bounded by the shunt (3.2 A) and flagged at the limit (M19). 20 V / 5 A would reject legitimate readings. |
| Data type checks, completeness, internal logs not sent | Covered | Decoder bounds checks; `quality.detail` counters. |
| Duplicate event ids ignored | Covered | Duplicate seq dropped; step ids unique. |
| Heartbeat when idle | Covered | The BLE stream is continuous; `no_data` and `no_generation` alerts. |
| Power loss: restore counters from non-volatile memory | Deferred (firmware) | The device keeps no counters; the app closes interrupted sessions at their last stored sample. |
| Accuracy: logged step count within +-0 events | **Conflict, open** | PRD target is within 5% of a manual count. Synthetic walks (clean, double-step, quick succession) are tested to exact counts; real-walking accuracy can only be measured on the tile. |
| Resilience: network down 5 minutes, no data lost | **Conflict, open** | Impossible over live BLE without an on-device buffer: data during a 5-minute outage is lost and shown as a gap. Needs the decision in section 8. |
| Export integrity; dashboard alignment (shown values equal stored values) | Covered | Tests: stored totals equal live totals; CSV round trip. |
| Timestamps ordered and UTC | Covered | Device-time driven, epoch UTC. |

## 8. Decisions needed from you

1. **Do you want the ESP32 to buffer and replay data (flash log, Wi-Fi, MQTT)?** DCR describes it; your brief and the PRD say BLE streaming of raw readings. I built to the brief. A device-side buffer would change firmware and the protocol (timestamps, replay flags); I will not do that without your go-ahead.
2. **Sample rate:** keep 20 Hz default, or default to 50/100 Hz? Recommendation: measure real pulse width first, then raise.
3. **Step accuracy target:** PRD 5% or DCR exact?
4. **Measurement boundary:** after the bridge rectifier (as briefed) or after the buck?
