# Milestone 11: actual load measurement and validation

Goal: show that the voltage, current, power and energy the monitor reports match a multimeter, with a real load. **Nothing in this document has been run yet.** Every result table below is empty on purpose; fill it in from real readings only.

## Already verified (do not repeat)

- Firmware flashed and running on Board 1; INA219 answers at 0x40; 20.0 Hz; BLE link to the laptop and to Chrome verified (DECISIONS H-22, H-24).
- Current state of the measured circuit: **not energised**. The page shows `NO INPUT (UNDERVOLTAGE)` at about 0.02 V.

## Not verified, and what this milestone settles

- Whether the INA219 reads the real load current correctly (the shunt value is only the R100 marking, 0.1 ohm).
- Whether bus voltage and energy are within the PRD target (5 % of a bench multimeter).

## Setup

12 V DC adapter (3 A rating) -> INA219 VIN+ ; INA219 VIN- -> 12 V LED + ; LED - -> adapter - ; adapter - also to the INA219 GND and ESP32 GND (one common ground). ESP32 powered separately (USB or a 5 V buck, never 12 V on `3V3` or GPIO). Monitor: `tools/ble_check.html` in Chrome (or the serial report over USB).

**Gate before any measurement:** the page must show `POWER INPUT: PRESENT` and the serial report `POWER INPUT: PRESENT` with the LED switched on. If it still says `NO INPUT`, stop: the INA219 is not on the live loop (check the VIN+/VIN- terminals clamp bare copper, the supply is on, and the grounds are common). Do not calibrate anything while it says `NO INPUT`.

**Safety:**
- Keep the current below the 2 A precaution level. That level is **precautionary and unverified**: the R100 shunt's power rating is unknown. At 0.1 ohm the shunt dissipates 0.1 W at 1 A, 0.4 W at 2 A, 0.9 W at 3 A. Do not use the adapter's 3 A limit as a test target. Find the shunt's rated power first if you want to go higher.
- The INA219's input limit is 26 V; the 12 V loop is inside it.
- Multimeter in current mode goes **in series** on the LED return (LED - to adapter -), on its amp range with the right jack and fuse. Never measure voltage with the leads in the current jacks.

## Procedure

Record each step in the tables below. Use the page's **Validation capture** (30 s average) for the monitor's number, and take the multimeter reading during the same 30 s.

1. **Zero baseline.** Load off, adapter on. Capture 30 s. Expect current within about +-1.5 mA (INA219 offset; it showed -1.4 mA unpowered). This is the accuracy floor: compare at currents well above it.
2. **Three load levels.** For example the LED alone, and the LED with a second 12 V load or a resistor in parallel so the total current is roughly 100 mA, 300 mA and 600 mA (keep the total below 1 A). At each level: capture 30 s, and read the multimeter current (in series) and voltage (across the load, black probe on the common ground).
3. **Compute** for each level: error % = (monitor - meter) / meter x 100, for voltage, current and power (power meter value = V x I from the multimeter).
4. **Shunt check.** If the current error has the same sign and size at all three levels (a constant ratio), the shunt value is the likely cause: `R_real = INA219_SHUNT_MOHM x (I_monitor / I_meter)` (this firmware computes current as shunt voltage divided by that constant). If the error varies with the level, suspect wiring or the meter instead. **Change `INA219_SHUNT_MOHM` only with this evidence from at least three levels, then reflash and repeat step 2.**
5. **Energy.** Steady load for 10 minutes. Note the page's energy at the start and the end, and the multimeter's average V and I over the same time. Expected energy = V x I x time. The multimeter reading is only as good as its accuracy (often 1 to 2 % on current), so judge the result against that.

## Pass criteria (proposed; the PRD target is 5 % for energy)

| Quantity | Pass |
| --- | --- |
| Bus voltage | within 1 % of the multimeter |
| Current (above 100 mA) | within 5 % of the multimeter |
| Power | within 5 % of the multimeter V x I |
| 10-minute energy | within 5 % of V x I x t |
| Lost packets during the 10 minutes | 0 |
| `SENSOR STATUS` | `NORMAL` throughout |

## Results (fill in; empty means not measured)

| Level | Multimeter V | Multimeter I | Page V (30 s mean) | Page I (30 s mean) | V error | I error | Power error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Zero (load off) | | | | | | | |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

| Energy test | Value |
| --- | --- |
| Start / end page energy (J) | |
| Multimeter V, I, duration | |
| Expected V x I x t (J) | |
| Page energy (J) and error % | |
| Lost packets | |

Conclusion (shunt value kept at 100 mohm, or changed to ___ mohm because ___): ______

## After this milestone

If it passes, log the numbers in DECISIONS.md, remove the "shunt unconfirmed" caveat, and tune `minInputV` from the real generator (an idle tile reads about 0 V between steps). Then: pulse width and sample rate on the tile, and the PRD acceptance runs (100-step count accuracy, 60-minute run).
