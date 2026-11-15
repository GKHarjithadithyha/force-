#include "power_report.h"

#include <stdio.h>
#include <string.h>

namespace force {

const char* meter_status_text(MeterStatus s) {
  switch (s) {
    case MeterStatus::Normal: return "NORMAL";
    case MeterStatus::NoData: return "NO DATA";
    case MeterStatus::SensorFault: return "SENSOR FAULT";
    case MeterStatus::InvalidReading: return "INVALID READING";
    case MeterStatus::Overrange: return "OVERRANGE";
    case MeterStatus::HighCurrent: return "HIGH CURRENT";
    case MeterStatus::ReverseCurrent: return "REVERSE CURRENT";
  }
  return "UNKNOWN";
}

const char* meter_status_message(MeterStatus s) {
  switch (s) {
    case MeterStatus::Normal: return "";
    case MeterStatus::NoData: return "No samples in this interval.";
    case MeterStatus::SensorFault:
      return "INA219 not answering on I2C (check wiring and power); retrying in the background.";
    case MeterStatus::InvalidReading:
      return "INA219 returned impossible register values; those samples are not used.";
    case MeterStatus::Overrange:
      return "Current is at the sensor limit; readings stop rising and under-report.";
    case MeterStatus::HighCurrent:
      return "Current is above the precautionary level. The R100 shunt's power rating is "
             "unconfirmed, so this level is a caution, not a verified safe limit, and staying "
             "below it does not prove the shunt is safe.";
    case MeterStatus::ReverseCurrent:
      return "Negative current: check VIN+/VIN- orientation or a load feeding back.";
  }
  return "";
}

const char* input_status_text(InputStatus s) {
  switch (s) {
    case InputStatus::Unknown: return "UNKNOWN (NO VALID READING)";
    case InputStatus::NoInput: return "NO INPUT (UNDERVOLTAGE)";
    case InputStatus::Present: return "PRESENT";
    case InputStatus::OverVoltage: return "OVER VOLTAGE";
  }
  return "UNKNOWN";
}

const char* input_status_message(InputStatus s) {
  switch (s) {
    case InputStatus::Unknown: return "No valid reading, so the input voltage cannot be judged.";
    case InputStatus::NoInput:
      return "Bus voltage is below the input threshold: no power source detected (supply off, "
             "disconnected, ground not common, or an idle generator). The INA219 itself is "
             "answering; zero current here is NOT a normal active source.";
    case InputStatus::Present: return "";
    case InputStatus::OverVoltage:
      return "Bus voltage is above the INA219 26 V rating. Remove the supply.";
  }
  return "";
}

void PowerAccumulator::addValid(uint16_t busMv, int16_t shuntRaw, bool atLimit, bool overVoltage) {
  s_.samples++;
  s_.valid++;
  s_.sumBusMv += busMv;
  s_.sumShuntRaw += shuntRaw;
  if (atLimit) s_.overrange++;
  if (overVoltage) s_.overVoltage++;
}

void PowerAccumulator::addFault() {
  s_.samples++;
  s_.faults++;
}

void PowerAccumulator::addInvalid() {
  s_.samples++;
  s_.invalid++;
}

ReportSnapshot PowerAccumulator::take() {
  const ReportSnapshot out = s_;
  s_ = ReportSnapshot{};
  return out;
}

Measurement compute_measurement(const ReportSnapshot& s, uint32_t shuntMohm) {
  Measurement m;
  if (s.valid == 0 || shuntMohm == 0) return m;
  const double n = static_cast<double>(s.valid);
  m.valid = true;
  m.busV = (static_cast<double>(s.sumBusMv) / n) / 1000.0;
  m.shuntMv = (static_cast<double>(s.sumShuntRaw) / n) * 0.01;  // 10 uV per LSB
  m.currentMa = m.shuntMv * 1000.0 / static_cast<double>(shuntMohm);
  m.currentA = m.currentMa / 1000.0;
  m.powerW = m.currentA > 0 ? m.busV * m.currentA : 0.0;
  m.powerMw = m.powerW * 1000.0;
  return m;
}

MeterStatus classify(const ReportSnapshot& s, const Measurement& m, const StatusLimits& lim) {
  if (s.samples == 0) return MeterStatus::NoData;
  if (s.faults > 0) return MeterStatus::SensorFault;
  if (s.invalid > 0) return MeterStatus::InvalidReading;
  if (!m.valid) return MeterStatus::NoData;
  if (s.overrange > 0) return MeterStatus::Overrange;
  const double absMa = m.currentMa < 0 ? -m.currentMa : m.currentMa;
  if (m.currentMa > 0 && absMa >= static_cast<double>(lim.highWarnMa)) return MeterStatus::HighCurrent;
  if (m.currentMa < 0 && absMa >= static_cast<double>(lim.reverseMa)) return MeterStatus::ReverseCurrent;
  return MeterStatus::Normal;
}

InputStatus classify_input(const ReportSnapshot& s, const Measurement& m, uint32_t minInputMv,
                           uint32_t ratingMv) {
  if (!m.valid) return InputStatus::Unknown;
  const double busMv = m.busV * 1000.0;
  if (s.overVoltage > 0 || busMv > static_cast<double>(ratingMv)) return InputStatus::OverVoltage;
  if (busMv < static_cast<double>(minInputMv)) return InputStatus::NoInput;
  return InputStatus::Present;
}

size_t format_power_report(char* buf, size_t cap, const ReportView& v) {
  const Measurement& m = v.measurement;
  char bus[24], shunt[24], cur[40], pwr[40];
  if (m.valid) {
    snprintf(bus, sizeof bus, "%.2f V", m.busV);
    snprintf(shunt, sizeof shunt, "%.3f mV", m.shuntMv);
    snprintf(cur, sizeof cur, "%.2f mA (%.4f A)", m.currentMa, m.currentA);
    snprintf(pwr, sizeof pwr, "%.3f W (%.0f mW)", m.powerW, m.powerMw);
  } else {
    // No valid measurement in this interval: say so, never print a stand-in number.
    snprintf(bus, sizeof bus, "n/a");
    snprintf(shunt, sizeof shunt, "n/a");
    snprintf(cur, sizeof cur, "n/a");
    snprintf(pwr, sizeof pwr, "n/a");
  }

  // One WARNING line per condition that is not fine: sensor quality and power input separately.
  char warn[640];
  warn[0] = '\0';
  const char* sensorMsg = meter_status_message(v.status);
  const char* inputMsg = input_status_message(v.input);
  size_t used = 0;
  if (sensorMsg[0]) used += static_cast<size_t>(snprintf(warn + used, sizeof warn - used,
                                                         "WARNING: %s\n", sensorMsg));
  if (inputMsg[0] && used < sizeof warn) {
    snprintf(warn + used, sizeof warn - used, "WARNING: %s\n", inputMsg);
  }

  const int n = snprintf(
      buf, cap,
      "ESP32 POWER MONITOR\n"
      "-----------------------------\n"
      "INA219 STATUS: %s\n"
      "I2C ADDRESS: 0x%02X\n"
      "BUS VOLTAGE: %s\n"
      "SHUNT VOLTAGE: %s\n"
      "CURRENT: %s\n"
      "POWER: %s\n"
      "SENSOR STATUS: %s\n"
      "POWER INPUT: %s\n"
      "%s"
      "SAMPLES: %lu valid, %lu fault, %lu invalid | RATE: %.1f Hz | SHUNT: %lu mOhm | BLE: %s\n"
      "-----------------------------\n",
      v.inaStatus, static_cast<unsigned>(v.i2cAddress), bus, shunt, cur, pwr,
      meter_status_text(v.status), input_status_text(v.input), warn,
      static_cast<unsigned long>(v.snapshot.valid), static_cast<unsigned long>(v.snapshot.faults),
      static_cast<unsigned long>(v.snapshot.invalid), v.rateHz,
      static_cast<unsigned long>(v.shuntMohm), v.bleState);
  if (n < 0 || static_cast<size_t>(n) >= cap) return 0;
  return static_cast<size_t>(n);
}

}  // namespace force
