// Serial power report: per-interval averaging, status classification and the structured text
// block. Pure C++ (no Arduino), host-tested.
//
// Three separate questions, three separate answers (they must never be mixed up):
//   INA219 STATUS   is the chip answering on I2C?            (connection)
//   SENSOR STATUS   are the readings valid and in range?     (measurement quality)
//   POWER INPUT     is there actually a source on VIN?       (input voltage)
// A healthy INA219 on an unpowered input reads ~0 V and ~0 A: that is a working sensor with NO
// power input, not a normal active source.
//
// Averaging here is for DISPLAY ONLY. The BLE packets stay raw and unfiltered (protocol rule:
// "no filtering or clipping"); the dashboard decides what to smooth.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace force {

// Measurement quality (not connection, not input).
enum class MeterStatus : uint8_t {
  Normal,
  NoData,          // nothing sampled in the interval
  SensorFault,     // INA219 not answering (I2C error) in the interval
  InvalidReading,  // INA219 answered with impossible register values
  Overrange,       // current at/over the sensor limit, or the shunt ADC saturated
  HighCurrent,     // above the PRECAUTIONARY current level (shunt power rating unconfirmed)
  ReverseCurrent,  // current clearly negative (reversed wiring, or load feeding back)
};

// Is there a power source at the sensor input?
enum class InputStatus : uint8_t {
  Unknown,      // no valid reading, so the input cannot be judged
  NoInput,      // bus voltage below the configured minimum (undervoltage / nothing connected)
  Present,      // bus voltage within [minimum, INA219 rating]
  OverVoltage,  // bus voltage above the INA219 rating
};

const char* meter_status_text(MeterStatus s);     // "NORMAL", "SENSOR FAULT", ...
const char* meter_status_message(MeterStatus s);  // one plain-language line, "" for Normal
const char* input_status_text(InputStatus s);     // "PRESENT", "NO INPUT (UNDERVOLTAGE)", ...
const char* input_status_message(InputStatus s);  // one plain-language line, "" for Present

// Totals over one reporting interval.
struct ReportSnapshot {
  uint32_t samples = 0;      // sampler ticks
  uint32_t valid = 0;        // valid measurements (the only ones averaged)
  uint32_t faults = 0;       // I2C failures / sensor not answering
  uint32_t invalid = 0;      // answered but impossible values
  uint32_t overrange = 0;    // valid but at/over the limit
  uint32_t overVoltage = 0;  // valid but bus above rating
  int64_t sumBusMv = 0;
  int64_t sumShuntRaw = 0;   // 10 uV per LSB
};

class PowerAccumulator {
 public:
  void addValid(uint16_t busMv, int16_t shuntRaw, bool atLimit, bool overVoltage);
  void addFault();
  void addInvalid();
  // Returns the totals and starts a new interval.
  ReportSnapshot take();

 private:
  ReportSnapshot s_;
};

// Averages converted to units. valid == false when there was no valid sample: nothing is invented.
struct Measurement {
  bool valid = false;
  double busV = 0;
  double shuntMv = 0;
  double currentMa = 0;  // signed
  double currentA = 0;   // signed
  double powerMw = 0;    // 0 when current is not positive (matches the packet rule)
  double powerW = 0;
};

// mA = shunt_mV / shunt_ohm = shunt_mV * 1000 / shunt_mohm
Measurement compute_measurement(const ReportSnapshot& s, uint32_t shuntMohm);

struct StatusLimits {
  int32_t limitMa;     // sensor limit (overrange)
  int32_t highWarnMa;  // PRECAUTIONARY current level; NOT a verified safe operating limit
  int32_t reverseMa;   // |negative current| above this is "reverse"
};

MeterStatus classify(const ReportSnapshot& s, const Measurement& m, const StatusLimits& lim);

// minInputMv: configured undervoltage threshold; ratingMv: INA219 bus input rating.
InputStatus classify_input(const ReportSnapshot& s, const Measurement& m, uint32_t minInputMv,
                           uint32_t ratingMv);

struct ReportView {
  const char* inaStatus;   // "CONNECTED", "NOT RESPONDING", "SIMULATED (BENCH_MODE)"
  uint8_t i2cAddress;
  uint32_t shuntMohm;
  double rateHz;
  ReportSnapshot snapshot;
  Measurement measurement;
  MeterStatus status;
  InputStatus input;
  const char* bleState;    // "advertising", "connected", ...
};

// Writes the report block. Returns the length (excluding NUL) or 0 if cap is too small.
size_t format_power_report(char* buf, size_t cap, const ReportView& v);

}  // namespace force
