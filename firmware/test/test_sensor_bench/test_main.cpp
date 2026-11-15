// Host-side tests for the INA219 conversion maths and the BENCH_MODE signal generator.
#include <math.h>
#include <unity.h>

#include "bench_signal.h"
#include "ina219_math.h"

using namespace force;

void setUp() {}
void tearDown() {}

// ---- INA219 maths -----------------------------------------------------------------------------

void test_config_word_is_the_documented_value() {
  // 32 V range, gain /8, 12-bit bus and shunt, no averaging, continuous: the chip's power-on
  // default 0x399F, written explicitly so a reset or a different library cannot change it.
  TEST_ASSERT_EQUAL_HEX16(0x399F, INA219_CONFIG_WORD);
}

void test_shunt_to_ma_with_100_milliohm() {
  // 10 uV per LSB / 0.1 ohm = 0.1 mA per LSB.
  TEST_ASSERT_EQUAL_INT32(0, ina219_shunt_to_ma(0, 100));
  TEST_ASSERT_EQUAL_INT32(1, ina219_shunt_to_ma(10, 100));
  TEST_ASSERT_EQUAL_INT32(250, ina219_shunt_to_ma(2500, 100));
  TEST_ASSERT_EQUAL_INT32(3200, ina219_shunt_to_ma(32000, 100));  // full scale = 3.2 A
  TEST_ASSERT_EQUAL_INT32(-1, ina219_shunt_to_ma(-10, 100));
  TEST_ASSERT_EQUAL_INT32(-3200, ina219_shunt_to_ma(-32000, 100));
}

void test_shunt_to_ma_rounds_half_away_from_zero() {
  TEST_ASSERT_EQUAL_INT32(1, ina219_shunt_to_ma(5, 100));    // 0.5 mA -> 1
  TEST_ASSERT_EQUAL_INT32(0, ina219_shunt_to_ma(4, 100));    // 0.4 mA -> 0
  TEST_ASSERT_EQUAL_INT32(-1, ina219_shunt_to_ma(-5, 100));  // -0.5 -> -1
  TEST_ASSERT_EQUAL_INT32(0, ina219_shunt_to_ma(-4, 100));
}

void test_shunt_to_ma_other_shunt_values() {
  TEST_ASSERT_EQUAL_INT32(6400, ina219_shunt_to_ma(32000, 50));  // 0.05 ohm doubles the range
  TEST_ASSERT_EQUAL_INT32(320, ina219_shunt_to_ma(32000, 1000));
  TEST_ASSERT_EQUAL_INT32(0, ina219_shunt_to_ma(1234, 0));  // guard against divide by zero
}

void test_bus_voltage_conversion() {
  // bits 15..3 value, LSB 4 mV; low three bits are flags
  TEST_ASSERT_EQUAL_UINT16(0, ina219_bus_to_mv(0x0000));
  TEST_ASSERT_EQUAL_UINT16(4, ina219_bus_to_mv(0x0008));
  TEST_ASSERT_EQUAL_UINT16(12000, ina219_bus_to_mv(3000u << 3));
  TEST_ASSERT_EQUAL_UINT16(12000, ina219_bus_to_mv((3000u << 3) | 0x3));  // flag bits ignored
  TEST_ASSERT_EQUAL_UINT16(32764, ina219_bus_to_mv(0xFFF8));              // maximum 13-bit value
  TEST_ASSERT_TRUE(ina219_bus_overflow(0x0001));
  TEST_ASSERT_FALSE(ina219_bus_overflow(0x0002));
}

void test_limit_detection() {
  TEST_ASSERT_FALSE(ina219_at_limit(0, 0, 3200));
  TEST_ASSERT_FALSE(ina219_at_limit(31990, 3199, 3200));
  TEST_ASSERT_TRUE(ina219_at_limit(31999, 3200, 3200));   // at the limit
  TEST_ASSERT_TRUE(ina219_at_limit(32000, 3200, 3200));   // ADC saturated
  TEST_ASSERT_TRUE(ina219_at_limit(-32000, -3200, 3200)); // negative direction too
  TEST_ASSERT_TRUE(ina219_at_limit(100, 5000, 3200));     // limit smaller than ADC range
}

// The datasheet's calibration-register method: Current_LSB = Imax / 2^15,
// CAL = trunc(0.04096 / (Current_LSB x R)), Current = ShuntReg x CAL / 4096 x Current_LSB.
// This firmware skips CAL and computes raw x 10 uV / R. Both must agree. (Formula check only:
// the datasheet examples are not used as measurements of our hardware.)
static double datasheet_ma(int16_t raw, uint32_t cal, double currentLsbUa) {
  return static_cast<double>(raw) * static_cast<double>(cal) / 4096.0 * currentLsbUa / 1000.0;
}
static uint32_t datasheet_cal(double currentLsbA, double rOhm) {
  return static_cast<uint32_t>(0.04096 / (currentLsbA * rOhm));
}

void test_matches_the_datasheet_calibration_formula() {
  // Example 1 of the datasheet: 0.5 ohm, Current_LSB 20 uA, CAL 4096
  TEST_ASSERT_EQUAL_UINT32(4096, datasheet_cal(20e-6, 0.5));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, static_cast<float>(datasheet_ma(1000, 4096, 20.0)),
                           static_cast<float>(ina219_shunt_to_ma(1000, 500)));
  // Example 2: 5 ohm, Current_LSB 1.9 uA, CAL 4311 (CAL is truncated, so about 0.01% apart)
  TEST_ASSERT_EQUAL_UINT32(4311, datasheet_cal(1.9e-6, 5.0));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, static_cast<float>(datasheet_ma(10000, 4311, 1.9)),
                           static_cast<float>(ina219_shunt_to_ma(10000, 5000)));
  // Our hardware: 0.1 ohm, Current_LSB 100 uA gives CAL 4096, so the register equals the shunt
  // reading and one LSB is 0.1 mA, exactly what raw x 10 uV / 100 mohm gives.
  TEST_ASSERT_EQUAL_UINT32(4096, datasheet_cal(100e-6, 0.1));
  // The firmware returns whole mA (the packet field is an integer), so allow half a mA of rounding.
  const int16_t raws[] = {0, 1, 4200, 20000, 32000};
  for (int16_t raw : raws) {
    TEST_ASSERT_FLOAT_WITHIN(0.51f, static_cast<float>(datasheet_ma(raw, 4096, 100.0)),
                             static_cast<float>(ina219_shunt_to_ma(raw, 100)));
  }
}

void test_reading_validity() {
  TEST_ASSERT_TRUE(ina219_reading_valid(0, 0));        // unpowered but healthy
  TEST_ASSERT_TRUE(ina219_reading_valid(-14, 24 << 3));
  TEST_ASSERT_TRUE(ina219_reading_valid(32000, 3000u << 3));  // saturated ADC is overrange, not invalid
  TEST_ASSERT_FALSE(ina219_reading_valid(0, 0xFFFF));   // floating or stuck bus
  TEST_ASSERT_FALSE(ina219_reading_valid(32767, 0x0100));
  TEST_ASSERT_FALSE(ina219_reading_valid(-32768, 0x0100));
  TEST_ASSERT_EQUAL_UINT32(26000, INA219_BUS_RATING_MV);
}

void test_clamp() {
  TEST_ASSERT_EQUAL_INT16(32767, clamp_to_i16(100000));
  TEST_ASSERT_EQUAL_INT16(-32768, clamp_to_i16(-100000));
  TEST_ASSERT_EQUAL_INT16(-5, clamp_to_i16(-5));
}

// ---- Bench signal -----------------------------------------------------------------------------

static BenchParams bench_params() {
  // Mirrors the defaults in include/config.h
  return BenchParams{90, 100, 200, 20000, 60000, 6000, 24000, 3, 20, 12345u};
}

void test_bench_stays_inside_hardware_limits() {
  BenchSignal s(bench_params());
  uint32_t maxPowerMw = 0;
  for (uint32_t t = 0; t < 120000; t += 50) {  // 20 Hz for 2 minutes
    uint16_t mv;
    int16_t ma;
    s.sample(t, &mv, &ma);
    TEST_ASSERT_TRUE(mv <= 32764);
    TEST_ASSERT_TRUE(ma <= 3200);  // never above the INA219 limit
    if (ma > 0) {
      const uint32_t p = (static_cast<uint32_t>(mv) * static_cast<uint32_t>(ma)) / 1000u;
      if (p > maxPowerMw) maxPowerMw = p;
    }
  }
  TEST_ASSERT_TRUE_MESSAGE(maxPowerMw <= 62000, "peak power must stay near or under 60 W");
  TEST_ASSERT_TRUE_MESSAGE(maxPowerMw >= 20000, "pulses must actually reach at least 20 W");
}

void test_bench_step_rate_is_about_90_per_minute() {
  BenchSignal s(bench_params());
  int steps = 0;
  bool inPulse = false;
  for (uint32_t t = 0; t < 60000; t += 10) {  // 100 Hz so a pulse is never missed
    uint16_t mv;
    int16_t ma;
    s.sample(t, &mv, &ma);
    const uint32_t p = (static_cast<uint32_t>(mv) * static_cast<uint32_t>(ma < 0 ? 0 : ma)) / 1000u;
    if (!inPulse && p > 5000) {
      inPulse = true;
      steps++;
    } else if (inPulse && p < 2000) {
      inPulse = false;
    }
  }
  TEST_ASSERT_INT_WITHIN(3, 90, steps);
}

void test_bench_pulse_duration_is_100_to_200_ms() {
  BenchSignal s(bench_params());
  // Measure the above-5% extent of each pulse at 1 kHz; the half-sine shape means the visible
  // width is a bit narrower than the full window, so allow for that.
  uint32_t longest = 0, current = 0;
  uint32_t seen = 0;
  for (uint32_t t = 0; t < 30000; t++) {
    uint16_t mv;
    int16_t ma;
    s.sample(t, &mv, &ma);
    const int32_t p = (static_cast<int32_t>(mv) * (ma < 0 ? 0 : ma)) / 1000;
    if (p > 1000) {
      current++;
    } else if (current > 0) {
      seen++;
      if (current > longest) longest = current;
      current = 0;
    }
  }
  TEST_ASSERT_TRUE(seen >= 40);
  TEST_ASSERT_TRUE_MESSAGE(longest <= 200, "no pulse is longer than 200 ms");
  TEST_ASSERT_TRUE_MESSAGE(longest >= 100, "the longest pulse is at least 100 ms");
}

void test_bench_noise_produces_negative_current_at_idle() {
  BenchSignal s(bench_params());
  int negatives = 0;
  for (uint32_t t = 300; t < 600; t++) {  // between pulses (first pulse ends by 200 ms)
    uint16_t mv;
    int16_t ma;
    s.sample(t, &mv, &ma);
    if (ma < 0) negatives++;
  }
  TEST_ASSERT_TRUE_MESSAGE(negatives > 20, "idle noise must exercise the negative-current path");
}

void test_bench_is_deterministic_for_a_seed() {
  BenchSignal a(bench_params()), b(bench_params());
  for (uint32_t t = 0; t < 5000; t += 50) {
    uint16_t va, vb;
    int16_t ia, ib;
    a.sample(t, &va, &ia);
    b.sample(t, &vb, &ib);
    TEST_ASSERT_EQUAL_UINT16(va, vb);
    TEST_ASSERT_EQUAL_INT16(ia, ib);
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_config_word_is_the_documented_value);
  RUN_TEST(test_shunt_to_ma_with_100_milliohm);
  RUN_TEST(test_shunt_to_ma_rounds_half_away_from_zero);
  RUN_TEST(test_shunt_to_ma_other_shunt_values);
  RUN_TEST(test_bus_voltage_conversion);
  RUN_TEST(test_limit_detection);
  RUN_TEST(test_matches_the_datasheet_calibration_formula);
  RUN_TEST(test_reading_validity);
  RUN_TEST(test_clamp);
  RUN_TEST(test_bench_stays_inside_hardware_limits);
  RUN_TEST(test_bench_step_rate_is_about_90_per_minute);
  RUN_TEST(test_bench_pulse_duration_is_100_to_200_ms);
  RUN_TEST(test_bench_noise_produces_negative_current_at_idle);
  RUN_TEST(test_bench_is_deterministic_for_a_seed);
  return UNITY_END();
}
