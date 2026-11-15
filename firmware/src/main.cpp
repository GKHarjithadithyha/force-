// F.O.R.C.E firmware: INA219 -> 15-byte packets -> BLE notifications.
//
// Task layout (the sampler never touches BLE; the BLE task never touches I2C):
//
//   sampler task (core 1, prio 5)   fixed schedule via vTaskDelayUntil, reads the sensor,
//        |                          stamps device time, increments seq for EVERY sample, packs,
//        v                          queues without blocking (queue full -> drop, seq gap shows it)
//   static queue (no heap)
//        |
//        v
//   link task (core 0, prio 3)      non-blocking notify when a client is subscribed,
//                                   otherwise discards. Drop and move on if the stack is full.
//
//   recovery task (prio 1)          only while the INA219 is not answering: retries init.
//                                   Bus ownership: sampler owns I2C while g_sensorOk, recovery
//                                   task owns it while !g_sensorOk. Never both.
//
// Compile with -DBENCH_MODE=1 (env esp32dev_bench) for a synthetic footstep signal.

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>

#if __has_include(<esp_mac.h>)
#include <esp_mac.h>
#endif

#include <atomic>

#include "config.h"
#include "packet.h"

#ifdef BENCH_MODE
#include "bench_signal.h"
#else
#include "ina219.h"
#endif
#include "ina219_math.h"
#include "power_report.h"

namespace {

struct Stats {
  std::atomic<uint32_t> samples{0};      // samples produced by the sampler
  std::atomic<uint32_t> queueDrops{0};   // sampler found the queue full
  std::atomic<uint32_t> notifyOk{0};     // notifications handed to the BLE stack
  std::atomic<uint32_t> notifyDrops{0};  // BLE stack refused (buffers full): dropped
  std::atomic<uint32_t> overruns{0};     // sampler missed its schedule
  std::atomic<uint32_t> sensorErrors{0}; // failed sensor reads
  std::atomic<uint32_t> invalidReads{0}; // answered with impossible register values
  std::atomic<uint32_t> advRestarts{0};  // advertising found stopped with no client, restarted
};

Stats g_stats;
std::atomic<bool> g_connected{false};
std::atomic<bool> g_subscribed{false};
std::atomic<bool> g_sensorOk{true};

// Per-interval totals for the serial report (display averaging only; BLE packets stay raw).
// A spinlock guards it: the sampler adds one sample per tick, loop() takes the totals.
force::PowerAccumulator g_acc;
portMUX_TYPE g_accMux = portMUX_INITIALIZER_UNLOCKED;

uint8_t g_queueStorage[SAMPLE_QUEUE_DEPTH * FORCE_PACKET_SIZE];
StaticQueue_t g_queueControl;
QueueHandle_t g_queue = nullptr;

char g_name[16];
char g_info[96];
size_t g_infoLen = 0;
NimBLECharacteristic* g_telemetry = nullptr;

#ifdef BENCH_MODE
force::BenchSignal g_bench(force::BenchParams{
    BENCH_STEPS_PER_MIN, BENCH_PULSE_MIN_MS, BENCH_PULSE_MAX_MS, BENCH_PEAK_MIN_MW,
    BENCH_PEAK_MAX_MW, BENCH_IDLE_VOLTAGE_MV, BENCH_PEAK_VOLTAGE_MV, BENCH_NOISE_MA,
    BENCH_NOISE_MV, BENCH_SEED});
#else
force::Ina219 g_ina;
#endif

// ----------------------------------------------------------------------------------------------
// BLE callbacks
// ----------------------------------------------------------------------------------------------
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    g_connected = true;
    Serial.printf("[ble] connected: %s\n", info.getAddress().toString().c_str());
    // Best effort: ask for a short connection interval so 20-50 notifications/s flow smoothly.
    server->updateConnParams(info.getConnHandle(), BLE_CONN_INTERVAL_MIN, BLE_CONN_INTERVAL_MAX,
                             BLE_CONN_LATENCY, BLE_CONN_TIMEOUT);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    g_connected = false;
    g_subscribed = false;
    Serial.printf("[ble] disconnected (reason %d), advertising again\n", reason);
    NimBLEDevice::startAdvertising();  // single connection: advertise again as soon as it drops
  }
};

class TelemetryCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t subValue) override {
    g_subscribed = (subValue & 0x1) != 0;
    Serial.printf("[ble] telemetry notifications %s\n", g_subscribed ? "ON" : "OFF");
  }
};

ServerCallbacks g_serverCallbacks;
TelemetryCallbacks g_telemetryCallbacks;

// ----------------------------------------------------------------------------------------------
// Tasks
// ----------------------------------------------------------------------------------------------
void accValid(uint16_t mv, int16_t shuntRaw, bool atLimit) {
  const bool overVoltage = mv > force::INA219_BUS_RATING_MV;
  portENTER_CRITICAL(&g_accMux);
  g_acc.addValid(mv, shuntRaw, atLimit, overVoltage);
  portEXIT_CRITICAL(&g_accMux);
}
#ifndef BENCH_MODE  // the simulated signal never faults
void accFault() {
  portENTER_CRITICAL(&g_accMux);
  g_acc.addFault();
  portEXIT_CRITICAL(&g_accMux);
}
void accInvalid() {
  portENTER_CRITICAL(&g_accMux);
  g_acc.addInvalid();
  portEXIT_CRITICAL(&g_accMux);
}
#endif

void readSample(uint32_t tMs, uint16_t* mv, int16_t* ma, bool* fault, bool* atLimit) {
  *mv = 0;
  *ma = 0;
  *fault = false;
  *atLimit = false;
#ifdef BENCH_MODE
  g_bench.sample(tMs, mv, ma);
  *atLimit = (*ma >= SENSOR_LIMIT_MA) || (*ma <= -SENSOR_LIMIT_MA);
  accValid(*mv, force::clamp_to_i16(static_cast<int32_t>(*ma) * INA219_SHUNT_MOHM / 10), *atLimit);
#else
  (void)tMs;
  if (!g_sensorOk.load()) {
    accFault();
    *fault = true;
    return;
  }
  int16_t shuntRaw = 0;
  uint16_t busReg = 0;
  if (!g_ina.read(&shuntRaw, &busReg)) {
    g_sensorOk = false;  // hand the bus to the recovery task
    g_stats.sensorErrors++;
    accFault();
    *fault = true;
    return;
  }
  if (!force::ina219_reading_valid(shuntRaw, busReg)) {
    // The chip answered but the values are impossible: not a measurement. Flag it, count it,
    // never pass it on as data. (The sensor still answers, so no recovery task is needed.)
    g_stats.invalidReads++;
    accInvalid();
    *fault = true;
    return;
  }
  const int32_t currentMa = force::ina219_shunt_to_ma(shuntRaw, INA219_SHUNT_MOHM);
  *mv = force::ina219_bus_to_mv(busReg);
  *ma = force::clamp_to_i16(currentMa);
  *atLimit = force::ina219_at_limit(shuntRaw, currentMa, SENSOR_LIMIT_MA);
  accValid(*mv, shuntRaw, *atLimit);
#endif
}

void samplerTask(void*) {
  esp_task_wdt_add(nullptr);
  const TickType_t period = pdMS_TO_TICKS(SAMPLE_PERIOD_MS);
  TickType_t lastWake = xTaskGetTickCount();
  uint16_t seq = 0;
  uint8_t packet[FORCE_PACKET_SIZE];

  for (;;) {
    // Fixed schedule. pdFALSE means the deadline had already passed (we ran late).
    if (xTaskDelayUntil(&lastWake, period) == pdFALSE) g_stats.overruns++;
    esp_task_wdt_reset();

    // Device time is taken at the moment of the reading: ms since boot, wraps at 2^32.
    const uint32_t tMs = static_cast<uint32_t>(esp_timer_get_time() / 1000);
    uint16_t mv;
    int16_t ma;
    bool fault, atLimit;
    readSample(tMs, &mv, &ma, &fault, &atLimit);

    force::pack_telemetry(packet, force::TelemetryInput{seq, tMs, mv, ma,
                                                        force::make_flags(fault, atLimit)});
    seq++;  // EVERY sample, subscriber or not
    g_stats.samples++;
    if (xQueueSend(g_queue, packet, 0) != pdTRUE) g_stats.queueDrops++;
  }
}

void linkTask(void*) {
  uint8_t packet[FORCE_PACKET_SIZE];
  for (;;) {
    if (xQueueReceive(g_queue, packet, pdMS_TO_TICKS(200)) != pdTRUE) continue;
    if (!g_subscribed.load()) continue;  // nobody listening: discard, seq keeps counting
    // notify() hands the packet to the BLE stack and returns; it does not wait for the radio.
    if (g_telemetry->notify(packet, FORCE_PACKET_SIZE)) {
      g_stats.notifyOk++;
    } else {
      g_stats.notifyDrops++;  // drop and move on; the sequence gap shows the loss
    }
  }
}

#ifndef BENCH_MODE
void recoveryTask(void*) {
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(SENSOR_RETRY_INTERVAL_MS));
    if (g_sensorOk.load()) continue;
    if (g_ina.begin()) {
      g_sensorOk = true;
      Serial.println("[sensor] INA219 is answering again");
    }
  }
}
#endif

void initWatchdog() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = WDT_TIMEOUT_S * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  if (esp_task_wdt_reconfigure(&cfg) != ESP_OK) esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
}

void startBle() {
  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_BT);  // the BLE public address NimBLE advertises with
  force::format_device_name(g_name, sizeof g_name, mac);
  g_infoLen = force::format_device_info(g_info, sizeof g_info, g_name, FW_VERSION, SAMPLE_RATE_HZ,
                                        SENSOR_LIMIT_MA);

  NimBLEDevice::init(g_name);
  NimBLEDevice::setPower(BLE_TX_POWER_DBM);

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&g_serverCallbacks, false);

  NimBLEService* service = server->createService(FORCE_SERVICE_UUID);
  g_telemetry = service->createCharacteristic(FORCE_TELEMETRY_UUID, NIMBLE_PROPERTY::NOTIFY);
  g_telemetry->setCallbacks(&g_telemetryCallbacks);
  NimBLECharacteristic* info =
      service->createCharacteristic(FORCE_DEVICE_INFO_UUID, NIMBLE_PROPERTY::READ);
  info->setValue(reinterpret_cast<const uint8_t*>(g_info), g_infoLen);
  // NimBLE-Arduino 2.x: each service must be started to register it with the stack BEFORE the
  // server is started. Calling only server->start() leaves the GATT table with just the standard
  // services (while advertising still carries our UUID), so a client connects but finds nothing.
  if (!service->start()) Serial.println("[ble] ERROR: GATT service failed to start");
  server->start();
  if (!service->isStarted()) Serial.println("[ble] ERROR: GATT service is not registered");

  // Advertising data: flags + 128-bit service UUID (21 bytes). The name goes in the scan
  // response because both together exceed 31 bytes. Browsers merge the two for filtering.
  NimBLEAdvertisementData advData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.addServiceUUID(NimBLEUUID(FORCE_SERVICE_UUID));
  NimBLEAdvertisementData scanData;
  scanData.setName(g_name);

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->setMinInterval(BLE_ADV_INTERVAL_MIN);
  adv->setMaxInterval(BLE_ADV_INTERVAL_MAX);
  adv->start();
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);  // let the USB-UART settle; setup() only, never in the sampling path
  Serial.println();
  Serial.printf("[boot] F.O.R.C.E firmware %s, proto %d, %d Hz%s\n", FW_VERSION, FORCE_PROTO_VERSION,
                SAMPLE_RATE_HZ,
#ifdef BENCH_MODE
                ", BENCH_MODE (synthetic signal, no sensor)"
#else
                ""
#endif
  );

  g_queue = xQueueCreateStatic(SAMPLE_QUEUE_DEPTH, FORCE_PACKET_SIZE, g_queueStorage,
                               &g_queueControl);

#ifndef BENCH_MODE
  Serial.printf("[sensor] INA219 addr 0x%02X, SDA %d SCL %d, shunt %d mOhm (ASSUMED), limit %d mA\n",
                INA219_I2C_ADDR, I2C_SDA_PIN, I2C_SCL_PIN, INA219_SHUNT_MOHM, SENSOR_LIMIT_MA);
  if (g_ina.begin()) {
    Serial.println("[sensor] INA219 found and configured (32 V, gain /8, 12-bit, no averaging)");
  } else {
    g_sensorOk = false;
    Serial.println("[sensor] INA219 NOT FOUND: streaming with the fault flag, retrying in background");
  }
#endif

  startBle();
  Serial.printf("[ble] advertising as %s\n", g_name);
  Serial.printf("[ble] device info: %s\n", g_info);

  initWatchdog();
  xTaskCreatePinnedToCore(linkTask, "link", LINK_TASK_STACK, nullptr, LINK_TASK_PRIORITY, nullptr,
                          LINK_TASK_CORE);
#ifndef BENCH_MODE
  xTaskCreatePinnedToCore(recoveryTask, "ina-retry", RECOVERY_TASK_STACK, nullptr,
                          RECOVERY_TASK_PRIORITY, nullptr, SAMPLER_TASK_CORE);
#endif
  xTaskCreatePinnedToCore(samplerTask, "sampler", SAMPLER_TASK_STACK, nullptr,
                          SAMPLER_TASK_PRIORITY, nullptr, SAMPLER_TASK_CORE);
}

// loop() only reports, at a limited rate. Sampling is entirely in samplerTask.
void loop() {
  static uint32_t lastReportMs = 0;
  static uint32_t lastSamples = 0;
  static uint32_t lastAdvCheckMs = 0;
  vTaskDelay(pdMS_TO_TICKS(100));
  const uint32_t now = millis();

  // Advertising watchdog. Found on hardware: after an aborted connection attempt the stack can
  // leave advertising OFF, so the unit stays invisible until reset. If nobody is connected and
  // advertising is not active, start it again.
  if (now - lastAdvCheckMs >= BLE_ADV_WATCHDOG_MS) {
    lastAdvCheckMs = now;
    NimBLEServer* server = NimBLEDevice::getServer();
    if (server != nullptr && server->getConnectedCount() == 0 &&
        !NimBLEDevice::getAdvertising()->isAdvertising()) {
      NimBLEDevice::startAdvertising();
      g_stats.advRestarts++;
      Serial.println("[ble] advertising had stopped with no client connected: restarted");
    }
  }

  if (now - lastReportMs < POWER_REPORT_INTERVAL_MS) return;

  const uint32_t samples = g_stats.samples.load();
  const float dt = static_cast<float>(now - lastReportMs) / 1000.0f;
  const float rate = lastReportMs == 0 ? 0.0f : static_cast<float>(samples - lastSamples) / dt;

  force::ReportSnapshot snap;
  portENTER_CRITICAL(&g_accMux);
  snap = g_acc.take();
  portEXIT_CRITICAL(&g_accMux);

  const force::Measurement m = force::compute_measurement(snap, INA219_SHUNT_MOHM);
  const force::StatusLimits limits{SENSOR_LIMIT_MA, HIGH_CURRENT_WARN_MA, REVERSE_CURRENT_MA};
  const force::MeterStatus status = force::classify(snap, m, limits);
  // Power input is judged on its own: a working INA219 on an unpowered input is NO INPUT.
  const force::InputStatus input =
      force::classify_input(snap, m, INPUT_MIN_MV, force::INA219_BUS_RATING_MV);

#ifdef BENCH_MODE
  const char* inaStatus = "SIMULATED (BENCH_MODE)";
#else
  const char* inaStatus = (g_sensorOk.load() && snap.faults == 0) ? "CONNECTED" : "NOT RESPONDING";
#endif
  const char* ble = g_subscribed.load() ? "streaming" : (g_connected.load() ? "connected" : "advertising");

  const force::ReportView view{inaStatus, static_cast<uint8_t>(INA219_I2C_ADDR),
                               static_cast<uint32_t>(INA219_SHUNT_MOHM), rate, snap, m, status, input, ble};
  char text[640];
  if (force::format_power_report(text, sizeof text, view) > 0) Serial.print(text);
  Serial.printf(
      "[diag] notified %u | notify drops %u | queue drops %u | overruns %u | sensor errors %u | "
      "invalid reads %u | adv restarts %u\n",
      g_stats.notifyOk.load(), g_stats.notifyDrops.load(), g_stats.queueDrops.load(),
      g_stats.overruns.load(), g_stats.sensorErrors.load(), g_stats.invalidReads.load(),
      g_stats.advRestarts.load());
  lastReportMs = now;
  lastSamples = samples;
}
