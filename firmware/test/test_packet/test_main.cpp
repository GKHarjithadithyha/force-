// Host-side tests for the packet packer. The vectors are generated from
// packages/protocol (hand-computed hex), the same ones the TypeScript tests use.
#include <string.h>
#include <unity.h>

#include "../vectors_generated.h"
#include "packet.h"

using namespace force;

void setUp() {}
void tearDown() {}

static_assert(FORCE_PACKET_SIZE == 15, "packet is 15 bytes");
static_assert(FORCE_OFF_SEQ == 0 && FORCE_OFF_TIME == 2 && FORCE_OFF_VOLTAGE == 6 &&
                  FORCE_OFF_CURRENT == 8 && FORCE_OFF_POWER == 10 && FORCE_OFF_FLAGS == 14,
              "offsets");

static TelemetryInput input_of(const TelemetryVector& v) {
  return TelemetryInput{v.seq, v.deviceTimeMs, v.voltageMv, v.currentMa, v.flags};
}

void test_vectors_byte_for_byte() {
  for (int i = 0; i < TELEMETRY_VECTOR_COUNT; i++) {
    const TelemetryVector& v = TELEMETRY_VECTORS[i];
    uint8_t out[FORCE_PACKET_SIZE];
    memset(out, 0xAA, sizeof out);
    pack_telemetry(out, input_of(v));
    TEST_ASSERT_EQUAL_HEX8_ARRAY_MESSAGE(v.bytes, out, FORCE_PACKET_SIZE, v.name);
  }
}

void test_power_matches_vectors() {
  for (int i = 0; i < TELEMETRY_VECTOR_COUNT; i++) {
    const TelemetryVector& v = TELEMETRY_VECTORS[i];
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(v.expectedPowerMw, compute_power_mw(v.voltageMv, v.currentMa),
                                     v.name);
  }
}

void test_little_endian_offsets() {
  uint8_t out[FORCE_PACKET_SIZE];
  pack_telemetry(out, TelemetryInput{0x0201, 0x06050403u, 0x0807, 0x0A09, 0x0B});
  TEST_ASSERT_EQUAL_HEX8(0x01, out[0]);
  TEST_ASSERT_EQUAL_HEX8(0x02, out[1]);
  TEST_ASSERT_EQUAL_HEX8(0x03, out[2]);
  TEST_ASSERT_EQUAL_HEX8(0x04, out[3]);
  TEST_ASSERT_EQUAL_HEX8(0x05, out[4]);
  TEST_ASSERT_EQUAL_HEX8(0x06, out[5]);
  TEST_ASSERT_EQUAL_HEX8(0x07, out[6]);
  TEST_ASSERT_EQUAL_HEX8(0x08, out[7]);
  TEST_ASSERT_EQUAL_HEX8(0x09, out[8]);
  TEST_ASSERT_EQUAL_HEX8(0x0A, out[9]);
  TEST_ASSERT_EQUAL_HEX8(0x0B, out[14]);
}

void test_seq_wraps() {
  uint16_t seq = 65534;
  uint8_t a[FORCE_PACKET_SIZE], b[FORCE_PACKET_SIZE], c[FORCE_PACKET_SIZE];
  pack_telemetry(a, TelemetryInput{seq++, 0, 0, 0, 0});
  pack_telemetry(b, TelemetryInput{seq++, 0, 0, 0, 0});
  pack_telemetry(c, TelemetryInput{seq++, 0, 0, 0, 0});
  TEST_ASSERT_EQUAL_HEX8(0xFE, a[0]);
  TEST_ASSERT_EQUAL_HEX8(0xFF, a[1]);
  TEST_ASSERT_EQUAL_HEX8(0xFF, b[0]);
  TEST_ASSERT_EQUAL_HEX8(0xFF, b[1]);
  TEST_ASSERT_EQUAL_HEX8(0x00, c[0]);
  TEST_ASSERT_EQUAL_HEX8(0x00, c[1]);
}

void test_flag_bits() {
  TEST_ASSERT_EQUAL_HEX8(0x00, make_flags(false, false));
  TEST_ASSERT_EQUAL_HEX8(0x01, make_flags(true, false));
  TEST_ASSERT_EQUAL_HEX8(0x02, make_flags(false, true));
  TEST_ASSERT_EQUAL_HEX8(0x03, make_flags(true, true));
}

void test_negative_current_is_signed_and_zeroes_power() {
  uint8_t out[FORCE_PACKET_SIZE];
  pack_telemetry(out, TelemetryInput{0, 0, 5000, -1, 0});
  TEST_ASSERT_EQUAL_HEX8(0xFF, out[8]);
  TEST_ASSERT_EQUAL_HEX8(0xFF, out[9]);
  for (int i = 10; i < 14; i++) TEST_ASSERT_EQUAL_HEX8(0x00, out[i]);
  pack_telemetry(out, TelemetryInput{0, 0, 5000, -32768, 0});
  TEST_ASSERT_EQUAL_HEX8(0x00, out[8]);
  TEST_ASSERT_EQUAL_HEX8(0x80, out[9]);
}

void test_power_rounding() {
  TEST_ASSERT_EQUAL_UINT32(0, compute_power_mw(499, 1));    // 0.499 mW
  TEST_ASSERT_EQUAL_UINT32(1, compute_power_mw(500, 1));    // 0.5 rounds up
  TEST_ASSERT_EQUAL_UINT32(2, compute_power_mw(1500, 1));   // 1.5 rounds up
  TEST_ASSERT_EQUAL_UINT32(10, compute_power_mw(3333, 3));  // 9.999 -> 10
  TEST_ASSERT_EQUAL_UINT32(83200, compute_power_mw(26000, 3200));  // INA219 maximum
  TEST_ASSERT_EQUAL_UINT32(0, compute_power_mw(0, 0));
  // Largest possible inputs stay inside uint32 (no overflow in the 64-bit product).
  TEST_ASSERT_EQUAL_UINT32(2147385u, compute_power_mw(65535, 32767));
}

void test_device_info_json() {
  for (int i = 0; i < DEVICE_INFO_VECTOR_COUNT; i++) {
    const DeviceInfoVector& v = DEVICE_INFO_VECTORS[i];
    char buf[96];
    const size_t n = format_device_info(buf, sizeof buf, v.id, v.fw, v.rateHz, v.limitMa);
    TEST_ASSERT_EQUAL_STRING(v.json, buf);
    TEST_ASSERT_EQUAL_UINT32(strlen(v.json), n);
  }
  char tiny[8];
  TEST_ASSERT_EQUAL_UINT32(0,
                           format_device_info(tiny, sizeof tiny, "FORCE-A1B2", "1.0.0", 20, 3200));
}

void test_device_name_from_mac() {
  for (int i = 0; i < NAME_VECTOR_COUNT; i++) {
    char buf[16];
    format_device_name(buf, sizeof buf, NAME_VECTORS[i].mac);
    TEST_ASSERT_EQUAL_STRING(NAME_VECTORS[i].name, buf);
  }
  char tiny[5];
  TEST_ASSERT_EQUAL_UINT32(0, format_device_name(tiny, sizeof tiny, NAME_VECTORS[0].mac));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_vectors_byte_for_byte);
  RUN_TEST(test_power_matches_vectors);
  RUN_TEST(test_little_endian_offsets);
  RUN_TEST(test_seq_wraps);
  RUN_TEST(test_flag_bits);
  RUN_TEST(test_negative_current_is_signed_and_zeroes_power);
  RUN_TEST(test_power_rounding);
  RUN_TEST(test_device_info_json);
  RUN_TEST(test_device_name_from_mac);
  return UNITY_END();
}
