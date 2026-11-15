#include "packet.h"

#include <stdio.h>

namespace force {

uint32_t compute_power_mw(uint16_t voltageMv, int16_t currentMa) {
  if (currentMa < 0) return 0;
  const uint64_t microwatts = static_cast<uint64_t>(voltageMv) * static_cast<uint64_t>(currentMa);
  return static_cast<uint32_t>((microwatts + 500u) / 1000u);
}

uint8_t make_flags(bool sensorFault, bool currentAtLimit) {
  return static_cast<uint8_t>((sensorFault ? FORCE_FLAG_SENSOR_FAULT : 0) |
                              (currentAtLimit ? FORCE_FLAG_CURRENT_AT_LIMIT : 0));
}

static void put_u16(uint8_t* p, uint16_t v) {
  p[0] = static_cast<uint8_t>(v & 0xFF);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
}

static void put_u32(uint8_t* p, uint32_t v) {
  p[0] = static_cast<uint8_t>(v & 0xFF);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
  p[2] = static_cast<uint8_t>((v >> 16) & 0xFF);
  p[3] = static_cast<uint8_t>((v >> 24) & 0xFF);
}

void pack_telemetry(uint8_t out[FORCE_PACKET_SIZE], const TelemetryInput& in) {
  put_u16(out + FORCE_OFF_SEQ, in.seq);
  put_u32(out + FORCE_OFF_TIME, in.deviceTimeMs);
  put_u16(out + FORCE_OFF_VOLTAGE, in.voltageMv);
  put_u16(out + FORCE_OFF_CURRENT, static_cast<uint16_t>(in.currentMa));  // two's complement
  put_u32(out + FORCE_OFF_POWER, compute_power_mw(in.voltageMv, in.currentMa));
  out[FORCE_OFF_FLAGS] = in.flags;
}

size_t format_device_info(char* buf, size_t cap, const char* id, const char* fw, int rateHz,
                          int limitMa) {
  const int n = snprintf(buf, cap,
                         "{\"proto\":%d,\"id\":\"%s\",\"fw\":\"%s\",\"rateHz\":%d,\"limitMa\":%d}",
                         FORCE_PROTO_VERSION, id, fw, rateHz, limitMa);
  if (n < 0 || static_cast<size_t>(n) >= cap) return 0;
  return static_cast<size_t>(n);
}

size_t format_device_name(char* buf, size_t cap, const uint8_t mac[6]) {
  const int n = snprintf(buf, cap, "%s%02X%02X", FORCE_NAME_PREFIX, mac[4], mac[5]);
  if (n < 0 || static_cast<size_t>(n) >= cap) return 0;
  return static_cast<size_t>(n);
}

}  // namespace force
