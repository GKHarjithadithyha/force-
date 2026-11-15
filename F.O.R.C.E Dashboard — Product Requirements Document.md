# F.O.R.C.E Dashboard — Product Requirements Document

Nov 15, 2026 · @florix energy

**Product:** F.O.R.C.E (Footstep Operated Renewable Conversion Engine) Dashboard, a web application by Florix Energy.

The dashboard reads live electrical data from the prototype's ESP32 over Bluetooth Low Energy (BLE) and shows power, energy and footfall metrics in the browser. The hardware is finished; this document specifies only the software that collects, calculates, stores and visualises its data.

## 1. Overview

**Problem.** The prototype generates electricity from footsteps, but there is no software to view its output, compare sessions, prove performance to clients, or show the "live monitoring" and "ESG reporting" promised in the Florix investor deck.

**Solution.** A web dashboard that connects directly to the F.O.R.C.E unit's ESP32 over BLE, receives its INA219 voltage and current readings, calculates power, energy, step and ESG metrics in the browser, and presents them in the style of the Florix Analytics Dashboard mock-up.

|  |  |
| --- | --- |
| In scope (v1) | Connecting to one ESP32 over BLE, receiving raw readings, all calculations, live charts, session history stored in the browser, CSV export, ESG-style summary |
| Out of scope (v1) | ESP32 firmware and circuit changes, cloud accounts, several tiles at once, native mobile apps |
| Data source | One INA219 sensor per tile, reading the output directly after the bridge rectifier; the prototype is one tile with six modules |
| Platform | Web app on desktop and Android Chrome or Edge, see Technical approach |

## 2. Goals and success metrics

v1 succeeds if a person can open the web app, connect to a F.O.R.C.E unit in under a minute, walk on it, and watch the power, energy and step count respond in real time.

**Goals**

- G1: Show live voltage, current and power from the unit with under 1 second of delay.
- G2: Turn raw readings into footstep metrics: step count, energy per step, cadence and cumulative energy.
- G3: Keep a history of every session and let the user export it.
- G4: Present results in the Florix dashboard style (generation chart, ESG score, density view) so the same screen can be used in client demos and investor meetings.

**Non-goals for v1:** hardware or ESP32 firmware changes, user accounts and cloud sync, several tiles at once, and native mobile apps.

**Success metrics** (proposed targets, to be confirmed in testing)

| Metric | Target | How measured |
| --- | --- | --- |
| Time from "Connect" to first live reading | 30 s or less | Stopwatch test, 10 attempts |
| Display delay, step to screen | 1 s or less | Compare step timestamp on unit and screen |
| Step count accuracy | Within 5% of manual count | 100-step walking test, 5 runs |
| Energy reading accuracy | Within 5% of a bench multimeter | Same load, 10-minute session |
| Unplanned data loss in a 60-minute session | None | Sequence-number check on stored samples |
| Automatic reconnect after signal drop | 10 s or less | Walk out of range and back |

## 3. Users and use cases

Three groups use the dashboard in v1; the first is the primary user.

| User | What they need | Main screens |
| --- | --- | --- |
| Florix engineer or demonstrator | Check the unit works, tune and test, run live demos for clients and investors | Live view, Device and health, Sessions |
| Client facility or sustainability manager (transport hubs, malls, campuses, smart-city pilots, as named in the deck) | See how much energy the floor produces and how busy it is, without electronics knowledge | Overview, ESG summary, Reports |
| Faculty or evaluator at a pilot site | Verify claims with exportable data | Sessions, CSV export |

**Key use cases**

1. Connect to a unit, see the live power graph move as someone steps on the tile.
2. Record a named test session (for example "10 people, 5 minutes") and review totals afterwards.
3. Compare two sessions, such as different loads or tile configurations.
4. Show the ESG summary on a screen during a client visit.
5. Download the session data as CSV for the client's own report.
6. Notice early if the unit stops producing or the sensor reaches its current limit.

## 4. System at a glance

&#91;embedded content: data path · 6 stages, hardware to browser\]

One INA219 reads the tile's output right after the bridge rectifier. The ESP32 streams those readings over Bluetooth LE; the browser app calculates every metric, stores the results and draws the screens.

## 5. Data input from the ESP32

The app has one data source: the ESP32, over Bluetooth Low Energy (BLE). The ESP32 sends raw sensor readings only; every calculation happens in the app. The ESP32 firmware itself is outside this document.

**What is measured.** One INA219 sensor per tile reads the DC output directly after the bridge rectifier. The prototype is one tile with six modules, so one sensor and one ESP32 describe the whole tile. The readings show what the tile generates, before any converter, battery or load, so the app has no battery or load data.

**What the app receives.** The ESP32 exposes one BLE service. Values are little-endian and every packet fits the default 20-byte BLE payload.

| Characteristic | Access | Field | Type | Unit | Purpose |
| --- | --- | --- | --- | --- | --- |
| Telemetry | Notify, 20 Hz proposed | Sequence number | 2 bytes | none | Rises by 1 per packet; gaps show lost packets |
|  |  | Device time | 4 bytes | ms | Time since the ESP32 started; used to integrate energy |
|  |  | Voltage | 2 bytes | mV | Rectifier output voltage |
|  |  | Current | 2 bytes, signed | mA | Rectifier output current |
|  |  | Power | 4 bytes | mW | Optional; if missing, the app calculates voltage times current |
|  |  | Status flags | 1 byte | none | Sensor fault, current at sensor limit |
| Device Info | Read, once | Device ID, firmware version, sample rate, sensor current limit | text and numbers | various | Shown on the Connection screen and used for alerts |

The unit advertises as `FORCE-` plus the last four characters of its Bluetooth address. Browsers talk only to BLE devices, so classic Bluetooth serial cannot be used.

**Sample rate matters.** A heel-strike pulse lasts roughly 100 to 200 ms, so at 10 samples per second a step may leave only one or two samples. The app needs at least 20 samples per second to count steps reliably, and 50 if the link allows it.

This table is a proposed contract. If the ESP32 already sends data in another format, the app's parser is adapted to it; only the fields above are required.

## 6. Calculations and metrics

The dashboard shows 19 metrics in five groups: electrical (M1 to M3), generation and energy (M4 to M8), footfall (M9 to M12), ESG (M13 to M16) and connection health (M17 to M19). M1 and M2 come straight from the ESP32; M3 comes from it or is calculated; all others are calculated in the app. Settings marked (set) are values the user can change.

| ID | Metric | Unit | How it is calculated | Refresh |
| --- | --- | --- | --- | --- |
| M1 | Voltage | V | As received | Every packet |
| M2 | Current | mA | As received, signed | Every packet |
| M3 | Power | W | Voltage times current, or the power value sent | Every packet |
| M4 | Generation state | text | Generating when power is above the idle threshold (set), otherwise idle | Every packet |
| M5 | Session energy | J, Wh | Sum of power times the time between samples, using the device time stamps; time gaps over 1 second are skipped, not filled | Every packet |
| M6 | Total energy, all sessions | Wh | Sum of M5 over every saved session | 1 s |
| M7 | Average power | W | Session energy divided by recorded time, gaps excluded | 1 s |
| M8 | Peak power | W | Highest M3 in the session | Every packet |
| M9 | Step count | steps | A step is counted when power rises above the step threshold (set) and later falls below half of it; steps closer than the minimum gap (set) count once | On each step |
| M10 | Cadence | steps/min | Steps in the last 10 seconds times 6 | 1 s |
| M11 | Energy per step | J | Power integrated over the pulse that made the step | On each step |
| M12 | Steps per hour | steps | Step count grouped by clock hour | 1 min |
| M13 | CO2 avoided | kg | Energy in kWh times the grid emission factor (set) | 1 min |
| M14 | Equivalent use | LED hours, phone charges | Energy in Wh divided by the reference LED watts and phone battery Wh (set) | 1 min |
| M15 | Wellness impact | steps | Step count; calories shown only if kcal per step (set) is filled in | 1 min |
| M16 | Sustainability score | 0 to 100 | Weighted mix of M13, M14 and M15 scores; weights and targets to be agreed | 1 min |
| M17 | Signal strength | dBm | Bluetooth RSSI as the browser reports it | 1 s |
| M18 | Sample rate and gaps | Hz, count | Packets per second; missing sequence numbers counted as gaps with their total duration | 1 s |
| M19 | Sensor limit alert | flag | Current at or above the sensor limit from Device Info (set to override), or the status flag from the ESP32 | Every packet |

**Gaps and accuracy.** Because energy is calculated in the app, any time the Bluetooth link is down is not counted. The app shows recorded energy and recorded time next to each total, marks every gap on the charts, and never fills a gap with estimated values.

**Step tuning.** Default thresholds are only a starting point. The Calibration screen (section 8) lets a person watch live power with the thresholds drawn on it and adjust them until the step markers match real steps.

## 7. Functional requirements

Priority: **P0** must ship in v1, **P1** should ship in v1, **P2** is planned for a later phase.

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1 | The user can click Connect, choose a nearby F.O.R.C.E unit from the browser's Bluetooth chooser, and see the connection state: searching, connected, reconnecting or disconnected. | P0 |
| FR-2 | The app reads Device Info, subscribes to Telemetry, checks every packet, and uses the sequence number to detect lost packets. | P0 |
| FR-3 | The app calculates M3 to M12 live from the incoming readings, exactly as defined in section 6. | P0 |
| FR-4 | A live line chart shows power in watts for the last 5 minutes by default, selectable from 1 minute to 1 hour, with the peak marked and gaps drawn as gaps. | P0 |
| FR-5 | Headline tiles show power, session energy, step count and cadence. | P0 |
| FR-6 | Every received sample, detected step and session summary is stored in the browser's local database and survives a page refresh. | P0 |
| FR-7 | The user can start, name and stop a session; the session list shows start time, duration, recorded energy, steps and peak power. | P0 |
| FR-8 | If the connection drops, the app retries automatically for 60 seconds, marks the gap, and continues the same session without resetting totals. | P0 |
| FR-9 | Any session can be exported as CSV with time, voltage, current, power, energy and step markers. | P0 |
| FR-10 | A Calibration screen shows live power with the step and idle thresholds drawn on it and step markers added as steps are detected; changing a threshold updates the markers at once. | P0 |
| FR-11 | A Settings screen holds units, thresholds, minimum step gap, emission factor, reference loads, sensor limit override and theme. | P1 |
| FR-12 | A Connection screen shows device ID, firmware version, signal strength, sample rate and gap count (M17, M18). | P1 |
| FR-13 | Alerts appear for sensor limit reached, no data for a set time, and no generation for a set time. | P1 |
| FR-14 | The ESG panel shows CO2 avoided, equivalent use and the sustainability score (M13 to M16). | P1 |
| FR-15 | Two sessions can be compared side by side on the power chart. | P1 |
| FR-16 | A fullscreen display mode shows the Overview for screens at client sites. | P1 |
| FR-17 | A demo mode replays a recorded session or generates simulated packets, so the dashboard can be shown and tested without hardware. | P1 |
| FR-18 | The app can connect to several tiles at once, each with its own ESP32 and sensor, and shows a floor-plan heatmap of steps per tile. | P2 |
| FR-19 | Optional cloud sync with sign-in lets several people see the same history and receive alerts. | P2 |

## 8. Dashboard screens

The visual reference is the "Florix Analytics Dashboard" mock-up on page 8 of the Florix deck: a dark header bar with the date and time, and light cards on a grid, using green for low and amber for high values. The Overview follows that layout; the other screens reuse its colours and card style.

**How each panel in the mock-up is delivered**

| Mock-up panel | v1 behaviour | Uses |
| --- | --- | --- |
| Real-Time Energy Generation (W): line chart, time axis, peak tooltip | Live power chart with area fill, tooltip on the peak, 5 minute window by default; the axis scales to the tile's actual output | M3, M8 |
| Sustainability Score (ESG): ring chart, 92/100, three rings | Score in the centre and three rings for Carbon Offset, Energy Savings and Wellness Impact | M13 to M16 |
| Crowd Density: floor-plan heatmap, Low to High legend | v1 shows steps per hour as a bar chart in the same colours, since one tile has one sensor. The floor-plan heatmap arrives when several tiles can connect (Phase 3) | M12 |
| Header: title, date and time | Same, plus a connection chip with device name and signal bars | M17 |

**Screens**

1. **Overview.** Headline tiles (power, session energy, steps, cadence), the three mock-up panels, and a session start and stop button.
2. **Live.** Large charts for voltage, current and power on one time axis, a scrolling list of detected steps with energy per step, and a pause button.
3. **Sessions.** Saved sessions with totals and charts, compare two sessions, export to CSV, rename and delete.
4. **Calibration.** Live power with step and idle thresholds drawn on the chart, step markers, and controls to adjust them.
5. **Connection.** Connection state, device details, signal strength, sample rate, gap count, alerts, and a button to forget the device.
6. **Settings.** Units, thresholds, emission factor, reference loads, sensor limit override, theme.

**Empty and error states:** not connected (large Connect button and a demo mode link), browser not supported (names supported browsers), Bluetooth off, device out of range, no data arriving, and sensor limit reached.

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Handle 20 to 50 samples per second for at least 1 hour (up to 180,000 samples) without the charts lagging or the page slowing. Show new data within 1 second of arrival. |
| Calculation accuracy | Every formula in section 6 has automated tests. Energy from a recorded test file must match a hand calculation to within 0.1%. |
| Browser support | Chrome and Edge on Windows, macOS and Linux, and Chrome on Android. Safari, Firefox and iOS browsers do not support Web Bluetooth, so the app shows an "unsupported browser" message and offers demo mode. |
| Connection | Served over HTTPS, as the browser requires. A connection starts only from a user click. Automatic reconnect for 60 seconds after a drop. |
| Data integrity | Lost packets are detected by sequence number and drawn as gaps; they are never filled with invented values. Stored data is never altered after it is saved. |
| Storage | History is kept in the browser's local database. The app warns before storage runs low and always offers CSV export. |
| Security and privacy | v1 stores no personal data and sends nothing to a server. Cloud sync (P2) adds sign-in and encrypted transport. |
| Usability | A first-time user connects without instructions. The layout works from tablet to wide desktop, and the Overview stays readable from about 2 metres on a client screen. |
| Accessibility | Text contrast meets WCAG 2.1 AA. Colour is never the only signal; charts carry labels and the heatmap carries a legend. |
| Configurability | Metric formulas, thresholds and units live in one settings profile per device, so a different tile design needs a new profile, not a rewrite. |
| Testability | A packet simulator reproduces the ESP32 stream, so the whole app can be tested without hardware. |

## 10. Technical approach

The recommendations below are suggestions for the build team, not fixed decisions.

| Layer | Recommendation | Why |
| --- | --- | --- |
| Web app | React with TypeScript, built with Vite, installable as a progressive web app | Fast to build, works offline once loaded, easy to host as static files |
| Bluetooth | Browser Web Bluetooth API, wrapped in one connection module | Needs no app install or gateway; BLE only |
| Calculations | One module of plain functions (packet parser, energy, step detector, ESG), kept apart from the screens and run in a background worker | Easy to test against recorded files; keeps the charts smooth |
| Charts | A canvas-based time-series library for live charts, a standard chart library for bars and rings | Canvas stays smooth at 20 to 50 samples per second |
| Local storage | IndexedDB through a small wrapper | Holds hours of samples and survives refreshes |
| Hosting | Any static HTTPS host | HTTPS is required for Web Bluetooth |
| Cloud sync (P2) | Hosted database with sign-in | Only when several people need the same history or alerts |

**Data flow in the app.** Bluetooth notification, then packet parser, then calculation module, then local database and live charts. The parser checks the sequence number and device time on every packet; the calculation module never sees a packet that failed the check.

**Platform limits to plan around.** Web Bluetooth works only in Chromium-based browsers, only over HTTPS, and only after a user click; the browser asks the user to pick the device when connecting. A wrapped or native mobile app is the fallback if iPhone support becomes a requirement.

## 11. Release plan

Four phases, each ending in a gate that must pass before the next starts. Dates are left open until the team confirms capacity.

| Phase | Delivers | Exit gate |
| --- | --- | --- |
| 0. Foundations | Data contract in section 5 agreed with the ESP32 side; packet simulator; web app skeleton with the Connect screen and packet parser | Simulator and the real unit both stream packets the parser reads with no errors |
| 1. Core dashboard (all P0) | Live telemetry, calculations M3 to M12, power chart, headline tiles, sessions, calibration, auto reconnect, local history, CSV export | Success metrics in section 2 met on the real unit during a 60 minute test |
| 2. Client-ready (all P1) | Settings, connection screen, alerts, ESG panel and score, session compare, fullscreen mode, demo mode | Shown to one client or pilot site without engineer help |
| 3. Multi-tile (P2) | Several tiles connected at once, floor-plan heatmap of steps per tile, optional cloud sync | Second tile with its own sensor and ESP32 available for testing |

## 12. Risks, assumptions and open questions

**Assumptions**

- The prototype is one tile with six modules and one INA219 sensor, which reads the DC output directly after the bridge rectifier. All v1 metrics therefore describe the whole tile's raw generation.
- The ESP32 sends raw voltage and current readings over BLE; the app does all calculations.
- v1 runs in the browser with data kept locally; there is no server or user account.
- Several tiles, each with its own sensor and ESP32, are a later phase.

**Open questions**

- [ ] What sample rate can the ESP32 send over BLE? The step counter needs at least 20 per second.
- [ ] Does the ESP32 already send BLE data, and in what format? If so, the app's parser follows it instead of section 5.
- [ ] What is the current limit of the sensor setup with six modules? The files rate the INA219 at 3.2 A and 26 V, about 83 W at most.
- [ ] How should the sustainability score be calculated, which grid emission factor applies, and what counts as wellness impact?
- [ ] Is iPhone or iPad support required? If yes, plan a wrapped app.
- [ ] When are further tiles planned? That sets the date for the heatmap.

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Step detection miscounts | Wrong step count and energy per step | Calibration screen, adjustable thresholds, accuracy test against manual counts |
| Sample rate too low | Steps are missed or merged | Require 20 samples per second or more; warn when the measured rate is lower |
| Lost packets | Energy under-counted during gaps | Show recorded energy and recorded time together; mark gaps; auto reconnect |
| Mock-up values taken as real | The mock shows up to 1,200 W and a 92 score; the sensor itself cannot read above about 83 W | Axes scale to real data, demo data labelled clearly, score formula agreed before launch |
| Current above sensor limit | Readings stop rising and under-report | Sensor limit alert (M19) |
| Unsupported browser | iPhone and Safari users cannot connect | Unsupported-browser message, demo mode, wrapped app as a later option |

## 13. Sources

This document uses your project files and your clarification of 15 November 2026. The browser limits in sections 9 and 10 are general Web Bluetooth behaviour, not from your files.

| Source | Used for |
| --- | --- |
| Your clarification, 15 Nov 2026 | One tile with six modules, one sensor per tile, readings taken directly after the bridge rectifier, software-only scope |
| power sensing unit.png | ESP32 and INA219 connection to the tile output |
| Industrial\_Mechanical\_Energy\_Harvesting\_Tile\_System.docx | INA219 rating of 26 V and 3.2 A |
| Kinetic Energy Flooring Engineering Study.pdf | Footfall analytics and BLE ideas, 100 to 200 ms heel-strike timing |
| Copy of florix.pdf (page 8) | Florix Analytics Dashboard mock-up and its three panels |
| FOOTSTEP ENERGY GENERATOR.jpg | Photo of the multi-module prototype |
