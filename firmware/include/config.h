// F.O.R.C.E firmware: every tunable lives here.
// Protocol constants (UUIDs, name prefix, packet layout, flag bits) are NOT here: they come from
// protocol_generated.h, generated from packages/protocol so firmware and web cannot drift.
#pragma once

#include "protocol_generated.h"

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------
#define FW_VERSION "1.0.0"

// ---------------------------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------------------------
// Samples per second. Default 20 (dashboard needs >= 20). Raisable to 50. Must divide 1000.
#ifndef SAMPLE_RATE_HZ
#define SAMPLE_RATE_HZ 20
#endif
#define SAMPLE_PERIOD_MS (1000 / SAMPLE_RATE_HZ)
static_assert(SAMPLE_RATE_HZ >= 1 && SAMPLE_RATE_HZ <= 100 && (1000 % SAMPLE_RATE_HZ) == 0,
              "SAMPLE_RATE_HZ must divide 1000 and be 1..100");

// ---------------------------------------------------------------------------------------------
// INA219 on I2C. High-side, in series on the tile DC output after the bridge rectifier.
// ---------------------------------------------------------------------------------------------
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22
#define I2C_CLOCK_HZ 400000
#define I2C_TIMEOUT_MS 5  // a hung bus must not stall the sampler for long
#define INA219_I2C_ADDR 0x40

// ASSUMED 0.1 ohm shunt (the INA219 breakout default). CONFIRM against the board: the current
// readings are wrong by the same factor if the shunt is different. Single place to change it.
#ifndef INA219_SHUNT_MOHM
#define INA219_SHUNT_MOHM 100
#endif

// INA219 gain /8 spans +-320 mV across the shunt: 320 mV / 0.1 ohm = 3.2 A, which is also the
// INA219 rating. Reported to the dashboard in Device Info (limitMa).
#define SENSOR_LIMIT_MA (320000 / INA219_SHUNT_MOHM)
static_assert(SENSOR_LIMIT_MA > 0 && SENSOR_LIMIT_MA <= 32767, "limit must fit int16");

// ---- Serial power report (display only; the BLE packets stay raw) ----
// Readings are averaged over this interval and printed as one structured block.
#ifndef POWER_REPORT_INTERVAL_MS
#define POWER_REPORT_INTERVAL_MS 2000
#endif
// PRECAUTIONARY current level. NOT a verified safe operating limit: the R100 shunt's power
// rating is unknown. I^2 R in 0.1 ohm: 1 A = 0.1 W, 2 A = 0.4 W, 3 A = 0.9 W, 3.2 A = 1.02 W.
// 2 A was picked only as a caution. Staying below it does not prove the shunt is safe, and the
// level is not proof that more is unsafe. Confirm the shunt's rated power, then set this value.
#define HIGH_CURRENT_WARN_MA 2000

// Bus voltage below this (mV) means NO POWER INPUT (undervoltage): the INA219 may be working
// perfectly, but there is no source, so zero current is not a normal active reading. Configurable.
// ASSUMED default 1000 mV: the generator's valid output range is not yet known, and an idle
// footstep tile legitimately reads about 0 V between steps. Set it from real measurements.
#ifndef INPUT_MIN_MV
#define INPUT_MIN_MV 1000
#endif
// A negative current beyond this (mA) is reported as REVERSE CURRENT instead of offset noise.
#define REVERSE_CURRENT_MA 5

// If the INA219 stops answering, packets keep flowing with the fault flag and init is retried
// from a low-priority background task at this interval.
#define SENSOR_RETRY_INTERVAL_MS 1000

// ---------------------------------------------------------------------------------------------
// Tasks and queues (the sampler never touches BLE; BLE never touches I2C)
// ---------------------------------------------------------------------------------------------
#define SAMPLER_TASK_CORE 1
#define SAMPLER_TASK_PRIORITY 5
#define SAMPLER_TASK_STACK 3072
#define LINK_TASK_CORE 0
#define LINK_TASK_PRIORITY 3
#define LINK_TASK_STACK 4096
#define RECOVERY_TASK_PRIORITY 1
#define RECOVERY_TASK_STACK 3072
// Packets buffered between the sampler and the BLE task. Full queue: newest packet is dropped
// (the sequence gap shows the loss). 64 packets = 3.2 s at 20 Hz.
#define SAMPLE_QUEUE_DEPTH 64

// Task watchdog: reset the board if the sampler stops for this long.
#define WDT_TIMEOUT_S 5

// ---------------------------------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------------------------------
// Connection interval request after connect, in 1.25 ms units (12 = 15 ms). Best effort: the
// central (browser/OS) may pick its own.
#define BLE_CONN_INTERVAL_MIN 12
#define BLE_CONN_INTERVAL_MAX 24
#define BLE_CONN_LATENCY 0
#define BLE_CONN_TIMEOUT 400  // 10 ms units = 4 s supervision timeout
#define BLE_TX_POWER_DBM 3
// How often (ms) the firmware checks that advertising is on while nobody is connected.
#define BLE_ADV_WATCHDOG_MS 1000
#define BLE_ADV_INTERVAL_MIN 160  // 0.625 ms units = 100 ms
#define BLE_ADV_INTERVAL_MAX 320  // 200 ms

// ---------------------------------------------------------------------------------------------
// Serial / logging
// ---------------------------------------------------------------------------------------------
#define SERIAL_BAUD 115200
// Rate limit for the periodic status line.
#define LOG_INTERVAL_MS 5000

// ---------------------------------------------------------------------------------------------
// BENCH_MODE: synthetic footsteps instead of the sensor (build env esp32dev_bench).
// ---------------------------------------------------------------------------------------------
#ifdef BENCH_MODE
#define BENCH_STEPS_PER_MIN 90
#define BENCH_PULSE_MIN_MS 100
#define BENCH_PULSE_MAX_MS 200
#define BENCH_PEAK_MIN_MW 20000
#define BENCH_PEAK_MAX_MW 60000  // up to 60 W
#define BENCH_IDLE_VOLTAGE_MV 6000
#define BENCH_PEAK_VOLTAGE_MV 24000
#define BENCH_NOISE_MA 3
#define BENCH_NOISE_MV 20
#define BENCH_SEED 12345u
#endif
