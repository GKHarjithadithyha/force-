// Host-side tests for the serial power report: averaging, units, status, exact text.
#include <math.h>
#include <string.h>
#include <unity.h>

#include "ina219_math.h"
#include "power_report.h"

using namespace force;

void setUp() {}
void tearDown() {}

static const StatusLimits LIMITS{3200, 2000, 5};
static const uint32_t MIN_INPUT_MV = 1000;
static const uint32_t SHUNT_MOHM = 100;

static bool near(double a, double b, double tol) { return fabs(a - b) <= tol; }

static Measurement measure(PowerAccumulator& acc, ReportSnapshot* out = nullptr) {
  const ReportSnapshot s = acc.take();
  if (out) *out = s;
  return compute_measurement(s, SHUNT_MOHM);
}

// ---- units and averaging --------------------------------------------------------------------

void test_hand_example_12v_led() {
  // 12.3 V bus, 42.000 mV across 0.1 ohm = 420 mA; P = 12.3 V x 0.42 A = 5.166 W.
  PowerAccumulator acc;
  for (int i = 0; i < 20; i++) acc.addValid(12300, 4200, false, false);
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  TEST_ASSERT_TRUE(m.valid);
  TEST_ASSERT_TRUE(near(m.busV, 12.3, 1e-9));
  TEST_ASSERT_TRUE(near(m.shuntMv, 42.0, 1e-9));
  TEST_ASSERT_TRUE(near(m.currentMa, 420.0, 1e-9));
  TEST_ASSERT_TRUE(near(m.currentA, 0.42, 1e-12));
  TEST_ASSERT_TRUE(near(m.powerW, 5.166, 1e-9));
  TEST_ASSERT_TRUE(near(m.powerMw, 5166.0, 1e-6));
  TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Normal), static_cast<int>(classify(s, m, LIMITS)));
}

void test_averaging_uses_only_valid_samples() {
  PowerAccumulator acc;
  acc.addValid(12000, 500, false, false);
  acc.addValid(12004, 500, false, false);
  acc.addValid(12000, 500, false, false);
  acc.addValid(12004, 500, false, false);
  acc.addFault();    // not a measurement: must not pull the average down
  acc.addInvalid();  // same
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  TEST_ASSERT_EQUAL_UINT32(6, s.samples);
  TEST_ASSERT_EQUAL_UINT32(4, s.valid);
  TEST_ASSERT_TRUE(near(m.busV, 12.002, 1e-9));
  TEST_ASSERT_TRUE(near(m.shuntMv, 5.0, 1e-9));
  TEST_ASSERT_TRUE(near(m.currentMa, 50.0, 1e-9));
  TEST_ASSERT_TRUE(near(m.powerW, 12.002 * 0.05, 1e-9));
}

void test_noise_is_smoothed_by_the_interval_average() {
  PowerAccumulator acc;
  // +-2 LSB (0.02 mV) of noise around 100 mA (raw 1000)
  const int16_t raws[] = {998, 1002, 1001, 999, 1000, 1002, 998, 1000};
  for (int16_t r : raws) acc.addValid(12000, r, false, false);
  const Measurement m = measure(acc);
  TEST_ASSERT_TRUE(near(m.currentMa, 100.0, 1e-9));
}

void test_take_starts_a_new_interval() {
  PowerAccumulator acc;
  acc.addValid(12000, 1000, false, false);
  (void)acc.take();
  const ReportSnapshot again = acc.take();
  TEST_ASSERT_EQUAL_UINT32(0, again.samples);
  TEST_ASSERT_EQUAL_UINT32(0, again.valid);
}

void test_no_valid_sample_means_no_numbers() {
  PowerAccumulator acc;
  acc.addFault();
  const Measurement m = measure(acc);
  TEST_ASSERT_FALSE(m.valid);
  TEST_ASSERT_TRUE(near(m.currentMa, 0.0, 0.0));  // untouched default, never printed as a reading
  TEST_ASSERT_FALSE(compute_measurement(ReportSnapshot{}, 0).valid);  // shunt 0 is refused
}

// ---- negative current -----------------------------------------------------------------------

void test_small_negative_current_is_offset_noise() {
  PowerAccumulator acc;
  for (int i = 0; i < 10; i++) acc.addValid(12300, -20, false, false);  // -0.2 mV = -2 mA
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  TEST_ASSERT_TRUE(near(m.currentMa, -2.0, 1e-9));  // signed, as read
  TEST_ASSERT_TRUE(near(m.powerW, 0.0, 0.0));       // negative current gives zero power
  TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Normal), static_cast<int>(classify(s, m, LIMITS)));
}

void test_clear_negative_current_is_reverse() {
  PowerAccumulator acc;
  for (int i = 0; i < 10; i++) acc.addValid(12300, -100, false, false);  // -10 mA
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  TEST_ASSERT_TRUE(near(m.currentMa, -10.0, 1e-9));
  TEST_ASSERT_TRUE(near(m.powerMw, 0.0, 0.0));
  TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::ReverseCurrent),
                    static_cast<int>(classify(s, m, LIMITS)));
}

// ---- status classification ------------------------------------------------------------------

static MeterStatus status_of(PowerAccumulator& acc) {
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  return classify(s, m, LIMITS);
}

void test_status_cases() {
  {
    PowerAccumulator a;
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::NoData), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addFault();
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::SensorFault), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addValid(12300, 1000, false, false);
    a.addFault();  // intermittent: still flagged
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::SensorFault), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addInvalid();
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::InvalidReading), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addValid(12300, 32000, true, false);  // 3200 mA, at the limit
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Overrange), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addValid(12300, 20000, false, false);  // 2000 mA = continuous-current warning
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::HighCurrent), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addValid(12300, 19990, false, false);  // 1999 mA: just below the warning
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Normal), static_cast<int>(status_of(a)));
  }
  {
    PowerAccumulator a;
    a.addValid(0, 0, false, false);  // an unpowered but healthy sensor is a valid reading of zero
    TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Normal), static_cast<int>(status_of(a)));
  }
}

// ---- exact text -----------------------------------------------------------------------------

static InputStatus input_of(const ReportSnapshot& s, const Measurement& m,
                            uint32_t minMv = MIN_INPUT_MV) {
  return classify_input(s, m, minMv, INA219_BUS_RATING_MV);
}

static ReportView view_for(const ReportSnapshot& s, const Measurement& m, MeterStatus st,
                           const char* ina) {
  return ReportView{ina, 0x40, SHUNT_MOHM, 20.0, s, m, st, input_of(s, m), "advertising"};
}

void test_report_text_for_the_hand_example() {
  PowerAccumulator acc;
  for (int i = 0; i < 20; i++) acc.addValid(12300, 4200, false, false);
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  char buf[640];
  const size_t n = format_power_report(buf, sizeof buf,
                                       view_for(s, m, classify(s, m, LIMITS), "CONNECTED"));
  TEST_ASSERT_TRUE(n > 0);
  const char* expected =
      "ESP32 POWER MONITOR\n"
      "-----------------------------\n"
      "INA219 STATUS: CONNECTED\n"
      "I2C ADDRESS: 0x40\n"
      "BUS VOLTAGE: 12.30 V\n"
      "SHUNT VOLTAGE: 42.000 mV\n"
      "CURRENT: 420.00 mA (0.4200 A)\n"
      "POWER: 5.166 W (5166 mW)\n"
      "SENSOR STATUS: NORMAL\n"
      "POWER INPUT: PRESENT\n"
      "SAMPLES: 20 valid, 0 fault, 0 invalid | RATE: 20.0 Hz | SHUNT: 100 mOhm | BLE: advertising\n"
      "-----------------------------\n";
  TEST_ASSERT_EQUAL_STRING(expected, buf);
  TEST_ASSERT_EQUAL_UINT32(strlen(expected), n);
}

void test_report_text_on_sensor_fault_has_no_made_up_numbers() {
  PowerAccumulator acc;
  for (int i = 0; i < 40; i++) acc.addFault();
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  char buf[640];
  format_power_report(buf, sizeof buf,
                      view_for(s, m, classify(s, m, LIMITS), "NOT RESPONDING"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "INA219 STATUS: NOT RESPONDING"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "BUS VOLTAGE: n/a"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SHUNT VOLTAGE: n/a"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "CURRENT: n/a"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER: n/a"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SENSOR STATUS: SENSOR FAULT"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER INPUT: UNKNOWN (NO VALID READING)"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "WARNING: INA219 not answering on I2C"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SAMPLES: 0 valid, 40 fault, 0 invalid"));
}

void test_report_text_negative_current_is_signed_and_power_zero() {
  PowerAccumulator acc;
  for (int i = 0; i < 5; i++) acc.addValid(12300, -100, false, false);
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  char buf[640];
  format_power_report(buf, sizeof buf, view_for(s, m, classify(s, m, LIMITS), "CONNECTED"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SHUNT VOLTAGE: -1.000 mV"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "CURRENT: -10.00 mA (-0.0100 A)"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER: 0.000 W (0 mW)"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SENSOR STATUS: REVERSE CURRENT"));
}

void test_report_refuses_a_buffer_that_is_too_small() {
  char tiny[32];
  ReportSnapshot s;
  Measurement m;
  TEST_ASSERT_EQUAL_UINT32(0, format_power_report(tiny, sizeof tiny,
                                                  view_for(s, m, MeterStatus::NoData, "CONNECTED")));
}

// ---- power input is separate from the sensor ------------------------------------------------

void test_input_status_cases() {
  PowerAccumulator a;
  a.addValid(12300, 4200, false, false);
  ReportSnapshot s;
  Measurement m = measure(a, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::Present), static_cast<int>(input_of(s, m)));

  PowerAccumulator b;
  b.addValid(24, -14, false, false);  // the real unpowered reading: 0.024 V, -0.14 mV
  m = measure(b, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::NoInput), static_cast<int>(input_of(s, m)));

  PowerAccumulator c;  // no valid reading at all: cannot judge the input
  c.addFault();
  m = measure(c, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::Unknown), static_cast<int>(input_of(s, m)));

  PowerAccumulator d;
  d.addValid(27000, 1000, false, true);
  m = measure(d, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::OverVoltage), static_cast<int>(input_of(s, m)));
}

void test_input_thresholds_are_exact_and_configurable() {
  ReportSnapshot s;
  PowerAccumulator a;
  a.addValid(1000, 0, false, false);
  Measurement m = measure(a, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::Present), static_cast<int>(input_of(s, m)));  // at the minimum
  PowerAccumulator b;
  b.addValid(999, 0, false, false);
  m = measure(b, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::NoInput), static_cast<int>(input_of(s, m)));
  PowerAccumulator c;
  c.addValid(26000, 0, false, false);  // exactly the rating is still within it
  m = measure(c, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::Present), static_cast<int>(input_of(s, m)));
  // configurable: the same 24 mV is "present" if the threshold is 0, "no input" if it is 5 V
  PowerAccumulator d;
  d.addValid(24, 0, false, false);
  m = measure(d, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::Present), static_cast<int>(input_of(s, m, 0)));
  PowerAccumulator e;
  e.addValid(4900, 0, false, false);
  m = measure(e, &s);
  TEST_ASSERT_EQUAL(static_cast<int>(InputStatus::NoInput), static_cast<int>(input_of(s, m, 5000)));
}

void test_a_healthy_sensor_on_no_input_is_not_reported_as_an_active_source() {
  PowerAccumulator acc;
  for (int i = 0; i < 40; i++) acc.addValid(24, -14, false, false);  // 0.024 V, -0.14 mV
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  // sensor quality is fine ...
  TEST_ASSERT_EQUAL(static_cast<int>(MeterStatus::Normal), static_cast<int>(classify(s, m, LIMITS)));
  char buf[900];
  format_power_report(buf, sizeof buf, view_for(s, m, classify(s, m, LIMITS), "CONNECTED"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "INA219 STATUS: CONNECTED"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "BUS VOLTAGE: 0.02 V"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SENSOR STATUS: NORMAL"));
  // ... but the input is NOT presented as a normal source
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER INPUT: NO INPUT (UNDERVOLTAGE)"));
  TEST_ASSERT_NULL(strstr(buf, "POWER INPUT: PRESENT"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "WARNING: Bus voltage is below the input threshold"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "NOT a normal active source"));
}

void test_sensor_fault_and_no_input_are_reported_separately() {
  PowerAccumulator acc;
  acc.addValid(24, -14, false, false);
  acc.addFault();  // intermittent sensor problem on top of an unpowered input
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  char buf[1000];
  format_power_report(buf, sizeof buf, view_for(s, m, classify(s, m, LIMITS), "CONNECTED"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "SENSOR STATUS: SENSOR FAULT"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER INPUT: NO INPUT (UNDERVOLTAGE)"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "WARNING: INA219 not answering"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "WARNING: Bus voltage is below"));
}

void test_over_voltage_is_an_input_warning_with_the_rating() {
  PowerAccumulator acc;
  acc.addValid(27000, 1000, false, true);
  ReportSnapshot s;
  const Measurement m = measure(acc, &s);
  char buf[900];
  format_power_report(buf, sizeof buf, view_for(s, m, classify(s, m, LIMITS), "CONNECTED"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "POWER INPUT: OVER VOLTAGE"));
  TEST_ASSERT_NOT_NULL(strstr(buf, "26 V rating"));
}

void test_high_current_message_is_a_caution_not_a_verified_limit() {
  const char* msg = meter_status_message(MeterStatus::HighCurrent);
  TEST_ASSERT_NOT_NULL(strstr(msg, "precautionary"));
  TEST_ASSERT_NOT_NULL(strstr(msg, "unconfirmed"));
  TEST_ASSERT_NOT_NULL(strstr(msg, "not a verified safe limit"));
  TEST_ASSERT_NOT_NULL(strstr(msg, "does not prove the shunt is safe"));
}

void test_input_status_texts() {
  TEST_ASSERT_EQUAL_UINT32(0, strlen(input_status_message(InputStatus::Present)));
  const InputStatus others[] = {InputStatus::Unknown, InputStatus::NoInput, InputStatus::OverVoltage};
  for (InputStatus st : others) TEST_ASSERT_TRUE(strlen(input_status_message(st)) > 0);
  TEST_ASSERT_EQUAL_STRING("PRESENT", input_status_text(InputStatus::Present));
  TEST_ASSERT_EQUAL_STRING("NO INPUT (UNDERVOLTAGE)", input_status_text(InputStatus::NoInput));
}

void test_every_status_has_text_and_only_normal_has_no_message() {
  const MeterStatus all[] = {MeterStatus::Normal,       MeterStatus::NoData,
                             MeterStatus::SensorFault,  MeterStatus::InvalidReading,
                             MeterStatus::Overrange,    MeterStatus::HighCurrent,
                             MeterStatus::ReverseCurrent};
  for (MeterStatus st : all) {
    TEST_ASSERT_TRUE(strlen(meter_status_text(st)) > 0);
    if (st == MeterStatus::Normal) TEST_ASSERT_EQUAL_UINT32(0, strlen(meter_status_message(st)));
    else TEST_ASSERT_TRUE(strlen(meter_status_message(st)) > 0);
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_hand_example_12v_led);
  RUN_TEST(test_averaging_uses_only_valid_samples);
  RUN_TEST(test_noise_is_smoothed_by_the_interval_average);
  RUN_TEST(test_take_starts_a_new_interval);
  RUN_TEST(test_no_valid_sample_means_no_numbers);
  RUN_TEST(test_small_negative_current_is_offset_noise);
  RUN_TEST(test_clear_negative_current_is_reverse);
  RUN_TEST(test_status_cases);
  RUN_TEST(test_report_text_for_the_hand_example);
  RUN_TEST(test_report_text_on_sensor_fault_has_no_made_up_numbers);
  RUN_TEST(test_report_text_negative_current_is_signed_and_power_zero);
  RUN_TEST(test_report_refuses_a_buffer_that_is_too_small);
  RUN_TEST(test_input_status_cases);
  RUN_TEST(test_input_thresholds_are_exact_and_configurable);
  RUN_TEST(test_a_healthy_sensor_on_no_input_is_not_reported_as_an_active_source);
  RUN_TEST(test_sensor_fault_and_no_input_are_reported_separately);
  RUN_TEST(test_over_voltage_is_an_input_warning_with_the_rating);
  RUN_TEST(test_high_current_message_is_a_caution_not_a_verified_limit);
  RUN_TEST(test_input_status_texts);
  RUN_TEST(test_every_status_has_text_and_only_normal_has_no_message);
  return UNITY_END();
}
