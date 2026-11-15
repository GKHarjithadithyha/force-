# Bench test: first run on real hardware

**Status: not yet run.** The firmware compiles (both builds) and its maths is covered by 21 host-side tests, but no board was available while it was written. This document is the first hardware run. Tick each box and note the result; the **pass** lines are what to compare against.

Tools you need: the board (Board 1 first, Board 2 is the backup with identical firmware), a USB-C cable, PlatformIO, Chrome or Edge, a bench multimeter, a known resistive load (for example a 10 ohm / 10 W resistor) and a DC source (a bench supply, or the tile's rectified output).

## 0. Confirm the assumptions first

| Assumption | Where | Check |
| --- | --- | --- |
| Shunt is **0.1 ohm** | `INA219_SHUNT_MOHM` in `firmware/include/config.h` | Read the marking on the shunt (R100 = 0.1 ohm). If it differs, change the constant and rebuild: every current reading scales with it. |
| INA219 I2C address 0x40 | `INA219_I2C_ADDR` | Default for the common breakout (A0 and A1 open). |
| SDA = GPIO21, SCL = GPIO22 | `config.h` | Matches the brief. |
| Measurement point | wiring | Brief and PRD: DC output after the bridge rectifier. The Data Collection doc also describes an LM2596 buck after the rectifier and calls the point "TBD". The software works for either; **write down which one you used.** |

## 1. Build and flash

```
cd firmware
pio test -e native                 # host tests, no board needed
pio run -e esp32dev_bench -t upload   # BENCH_MODE first: no sensor required
pio device monitor                 # 115200
```

Expected serial lines (the MAC part differs):

```
[boot] F.O.R.C.E firmware 1.0.0, proto 1, 20 Hz, BENCH_MODE (synthetic signal, no sensor)
[ble] advertising as FORCE-A1B2
[ble] device info: {"proto":1,"id":"FORCE-A1B2","fw":"1.0.0","rateHz":20,"limitMa":3200}
ESP32 POWER MONITOR
-----------------------------
INA219 STATUS: SIMULATED (BENCH_MODE)
I2C ADDRESS: 0x40
BUS VOLTAGE: 6.00 V
SHUNT VOLTAGE: 0.000 mV
CURRENT: 0.00 mA (0.0000 A)
POWER: 0.000 W (0 mW)
SENSOR STATUS: NORMAL
POWER INPUT: PRESENT
SAMPLES: 40 valid, 0 fault, 0 invalid | RATE: 20.0 Hz | SHUNT: 100 mOhm | BLE: advertising
-----------------------------
[diag] notified 0 | notify drops 0 | queue drops 0 | overruns 0 | sensor errors 0 | invalid reads 0
```

The power report block (every 2 s, `POWER_REPORT_INTERVAL_MS`) shows the interval average of bus voltage, shunt voltage, current and power, plus a sensor status (`NORMAL`, `SENSOR FAULT`, `INVALID READING`, `OVERRANGE`, `OVER VOLTAGE`, `HIGH CURRENT`, `REVERSE CURRENT`, `NO DATA`). With no valid sample it prints `n/a`, never a stand-in number. So section 5a can be done with only a serial monitor and a multimeter (no browser needed). The averaging is for the display only: the BLE packets stay raw.

- [ ] **Pass:** the name is `FORCE-` plus the last four hex characters of the BLE address (compare with a phone BLE scanner).
- [ ] **Pass:** the report's `RATE` shows 20.0 Hz (19.5 to 20.5; one report interval can include a tick more or less) and the `[diag]` line shows `overruns 0`.

## 2. BLE link with BENCH_MODE (no wiring needed)

Open `tools/ble_check.html` in Chrome or Edge (double-click works for `file://` in Chrome; otherwise `npx serve tools`). Press **Connect** and choose the unit.

- [ ] Device Info row shows the JSON above.
- [ ] Voltage idles around 6.0 V with current within a few mA of zero, power spikes to tens of watts about 1.5 times a second.
- [ ] **Pass:** packets per second 20 (19 to 21), lost packets 0, device-time rate about 20 Hz, malformed 0, power mismatch 0.
- [ ] Press the board's **EN** button: the page reports "device restarted", the counters carry on.
- [ ] Move out of range and back: the page disconnects (Connect again works), and advertising restarts by itself (the serial log shows "advertising again").

## 3. Real sensor: wiring check

Flash the real build: `pio run -e esp32dev -t upload`. Power the board from USB; disconnect the load.

```
INA219 VCC -> 3V3   GND -> GND (shared with the tile output ground)
INA219 SDA -> GPIO21   SCL -> GPIO22
INA219 VIN+ -> tile DC +   VIN- -> toward the load   (high side, in series)
```

- [ ] Serial: `[sensor] INA219 found and configured (32 V, gain /8, 12-bit, no averaging)`.
- [ ] Unplug SDA: `[sensor] INA219 NOT FOUND` or `sensor FAULT`; `ble_check` shows flag `SENSOR FAULT`, and packets keep arriving at 20 Hz. Plug it back: `INA219 is answering again` within about a second and the flag clears.
- [ ] **Pass:** both fault and recovery happen with no reboot and no gap in sequence numbers.

## 4. Idle readings

No load, source connected or tile at rest.

- [ ] Record 30 s in `ble_check`. **Pass:** current within +-3 mA of zero (the INA219 resolution is 0.1 mA at 0.1 ohm); voltage steady to a few tens of mV; power near zero. Small negative currents are normal and show as 0 W.

## 5. Known load against a multimeter

Use a steady DC source and a known load; put the multimeter in series (current) or across the load (voltage). Take at least three points across the range, for example 0.2 A, 0.5 A, 1 A.

| Point | Multimeter V | Multimeter I | ble_check V | ble_check I | V error | I error |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

- [ ] **Pass:** within 5% of the multimeter (PRD target) after allowing for the multimeter's own accuracy. Systematic error that scales with current means the shunt value is wrong: fix `INA219_SHUNT_MOHM`.
- [ ] Power in `ble_check` equals V x I within rounding.
- [ ] Energy check in the dashboard: run the load for 10 minutes; the session energy should equal multimeter power x time within 5%.

## 2a. Wireless only (USB unplugged)

The monitor needs no USB: it reads the BLE stream. Keep USB for flashing and serial debugging only.

1. **Power the ESP32 without USB.** Do not put 12 V on the ESP32. Use a **buck converter set to 5.0 V** (the LM2596 module already in the design works): adapter + and - to the buck input, buck output to the ESP32 `5V`/`VIN` pin and `GND`. Set the buck to 5.0 V with a multimeter **before** connecting the ESP32. Tap the buck input from the adapter **before** the INA219 VIN+, so the ESP32's own current is not counted as load. The buck GND, adapter -, ESP32 GND and INA219 GND are then one common ground. Never connect 12 V to the `3V3` pin or any GPIO, and never feed 5 V into `VIN` while USB is also plugged in (many DevKits have no protection diode).
2. Is the ESP32 alive? On the laptop (Bluetooth on) open `tools/ble_check.html` in Chrome or Edge and press Connect. **If `FORCE-XXXX` is not in the picker, the board is unpowered, not advertising, or another device is already connected to it** (it accepts one connection).
3. Pass: state `STREAMING`, about 20 packets/s, lost 0. Cover the sensor wiring or power-cycle the board: the page must show `RECONNECTING` and recover by itself within 60 s, and the live cards must show `—` (never an old number) while the link is down.
4. The firmware on the board is whatever was last flashed. Only the hardened build with the serial `POWER INPUT` line needs USB to flash; the BLE data and the page's own input/sensor status work with the previous build too, because the packet format did not change.

## 5a. Sample test from a bench supply (no footstep generator)

A steady DC source gives a known current, so this confirms the shunt value on its own.

```
Supply +  -> INA219 VIN+      INA219 VIN- -> resistor -> Supply -
Supply -  -> ESP32 GND (common ground)      ESP32 powered from USB only
```

- Supply **24 V or less** (INA219 rated 26 V), current limit **2 A or less** (the sensor clips at 3.2 A). Resistor rated for the power. Ground first, supply on last.
- Flash the real build (`esp32dev`), open `ble_check`.
- [ ] No load: current within +-3 mA of zero, voltage equal to the supply.
- [ ] 5 V across about 22 ohm, 10 ohm and 5 ohm (about 0.23 A, 0.5 A, 1.0 A). Record the multimeter and the page.
- **Shunt check:** real shunt = 100 mohm x (page current / meter current). About 1.00 confirms 0.1 ohm. A constant ratio of 0.5 means 50 mohm, 2.0 means 200 mohm: set `INA219_SHUNT_MOHM` to the real value and reflash.
- The pulse check stays empty with steady DC. That is expected.

## 6. Pulse width and sample rate (decides the default rate)

The Data Collection doc expects pulses of tens to hundreds of ms and asks for 100 Hz or more; the brief defaults to 20 Hz. Settle it with data:

- [ ] Walk on the tile with `ble_check` open at 20 Hz. The **pulse check** in the table (set its threshold to your step threshold, 0.5 W to start) counts the samples each step spans and gives advice after 5 steps. **If the median is fewer than 4 samples, raise the rate.**
- [ ] To raise it, flash a ready-made build instead of editing code: `pio run -e esp32dev_50hz -t upload` or `pio run -e esp32dev_100hz -t upload`. Repeat sections 2 and 7 at the new rate, then set `SAMPLE_RATE_HZ` in `config.h` to make it the default. 100 Hz is about 1.5 kB/s over BLE and well inside what a link carries; the engine handles it with a large margin (see [PERFORMANCE.md](PERFORMANCE.md)).
- [ ] Note the pulse width and the rate you chose in [DECISIONS.md](DECISIONS.md).

## 7. Ten-minute lost-packet run

`ble_check` open, phone and laptop closed to the unit (about 1 m), no other BLE device connected to it.

- [ ] Run for 10 minutes without touching anything.
- [ ] **Pass:** lost packets 0 (PRD: none over 60 minutes; accept up to 0.1% at this stage and note where losses cluster), duplicates and late 0, packets per second steady, serial `queue drops 0`, `notify drops 0`, `overruns 0`.
- [ ] Repeat at 3 m with a wall in between and note the loss rate. Losses are expected to appear as gaps and are never replayed (the device keeps no history).
- [ ] If `notify drops` climbs: the BLE stack is refusing packets (link too slow). Try a shorter connection interval (`BLE_CONN_INTERVAL_*` in `config.h`), a lower rate, or less distance.

## 8. Then the dashboard

Once the backend is wired into the frontend (docs/INTEGRATION.md): connect from the dashboard, walk on the tile, and compare the step count with a manual count over 100 steps (PRD: within 5%; the Data Collection doc asks for exact). Tune `stepThresholdW` in the profile if it miscounts; stored sessions can be recomputed with new thresholds.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Not in the Chrome picker | Another central is connected to it (single connection), or the board is not advertising: check the serial log. |
| `INA219 NOT FOUND` | Address (A0/A1), SDA/SCL swapped, no common ground, or 3.3 V missing. |
| Current has the wrong size | Shunt value; confirm `INA219_SHUNT_MOHM`. |
| Current reads 3200 and flag AT LIMIT | Real current above 3.2 A, or the sensor range is wrong for this shunt. |
| Rate below 20 Hz in the serial log | `overruns` rising: I2C slow or hung (check wiring and pull-ups). |
| Board resets every few seconds | Brown-out from a weak USB supply, or the task watchdog (`WDT_TIMEOUT_S`) tripping: check serial for the reset reason. How the board is powered in the field is still unknown and may matter here. |
