# Integration test: board to UI

Path under test: ESP32 → BLE → `BluetoothSource` → worker engine → IndexedDB → Zustand → fedfront UI.

Board used: FORCE-71B6, BLE address 88:57:21:AD:71:B6, firmware 1.0.0 (see DECISIONS H-26 to H-28).

## Status

| Link in the path | Evidence | Kind | Result |
| --- | --- | --- | --- |
| Board → BLE (advertise, GATT service, Device Info, 20 Hz notify) | `blecheck_pinned.py` from this laptop: 401 packets in 20.0 s, 0 lost, 0 malformed | **real hardware**, Python client | pass |
| Browser (Chrome) → physical board | `npm run web:hardware-check` | **real hardware**, needs a free BLE link | **not performed**: the board was held by another client, see below |
| `BluetoothSource` → engine → IndexedDB → Zustand → UI display rules | `fedfront/tests/hardware-path.test.ts` | **simulated radio**, real code after it | pass |
| Mock and demo isolation from real device data | same test, plus `release.test.ts` | simulated | pass |

**No claim is made that Chrome connected to the board.** The attempt on 16 Nov 2026 found an empty device chooser for 45 s and 0 BLE devices heard by a second client. The board's own serial report showed `BLE: streaming` with a notification counter still rising, so another client already held its single BLE connection. I did not reset the board or drop that link.

## What the automated test proves (simulated radio)

`hardware-path.test.ts` replaces only the Bluetooth radio with a fake that behaves like FORCE-71B6: the Device Info JSON the firmware sends, and packets modelled on the captured values (11.576 V, 40 mA). It checks, using the real engine, storage and UI rules:

1. The picker filter is `namePrefix FORCE-` plus the service UUID. Neither FORCE-E52E nor FORCE-71B6 appears in it: nothing is hardcoded.
2. Device Info is read from the unit: id, name, firmware, 20 Hz, 3200 mA.
3. Snapshots carry `source: device`, a recent `lastPacketAt`, 11.576 V, 40 mA, 0.463 W, input present, sensor normal, 0 lost, 0 dropped.
4. Session energy equals the integral of the received samples (about 0.463 W × recorded seconds).
5. The chart buffer holds only the received samples.
6. A 0.02 V input gives `inputPresent: false`: the UI shows "No input", hides the reading, and still reports the sensor as Normal.
7. After disconnect the session is stored as a `device` session with the unit's id and counted in today's totals.
8. A demo run afterwards is stored as `demo` and leaves the device totals unchanged.
9. IndexedDB `force-mock` is never created.

## Running the real browser test

A unit accepts one BLE client. Close other tabs or tools connected to FORCE-71B6 first (the page `tools/ble_check.html`, another dashboard tab, nRF Connect, a phone).

```
npm run web:build
node fedfront/scripts/serve-static.mjs fedfront/out 8080        # keep running
DEVICE_NAME=FORCE-71B6 npm run web:hardware-check               # second terminal
```

The script opens Chromium, answers the Bluetooth chooser through the DevTools `DeviceAccess` domain, waits for `Streaming`, then records what the Connection, Overview and Live screens and the Sessions list showed, with screenshots in `./hardware-check`. It prints `"result": "CONNECTED"`, or exits 2 with `"NOT CONNECTED"`. Compare the printed values with the serial report; a pass needs both to agree.

Manual alternative: open http://127.0.0.1:8080 in Chrome, Connection → Connect, choose FORCE-71B6.

## Remaining integration gaps

- Browser-to-board connection not yet observed (above).
- RSSI is optional: `BluetoothSource` takes it from `advertisementreceived` events (`watchAdvertisements`). If the browser sends none, the UI shows "—". Whether Chrome delivers them on a connected unit has not been checked on hardware.
- Accuracy against a multimeter is unverified (M11): the dashboard shows what the INA219 reports.
- The board's INA219 config register read 0x3527 before the firmware wrote it (H-26); unexplained, harmless to the data path.
