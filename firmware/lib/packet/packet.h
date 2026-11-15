// Telemetry packet packer, Device Info and name formatting.
// Pure C++: no Arduino or ESP-IDF dependency, so it runs in host-side unit tests.
// Layout comes from protocol_generated.h (generated from packages/protocol).
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "protocol_generated.h"

namespace force {

struct TelemetryInput {
  uint16_t seq;
  uint32_t deviceTimeMs;
  uint16_t voltageMv;
  int16_t currentMa;
  uint8_t flags;
};

// 0 if current < 0, else round-half-up(mV * mA / 1000). mV * mA is exactly microwatts.
uint32_t compute_power_mw(uint16_t voltageMv, int16_t currentMa);

uint8_t make_flags(bool sensorFault, bool currentAtLimit);

// Writes exactly FORCE_PACKET_SIZE bytes, little-endian, regardless of host byte order.
void pack_telemetry(uint8_t out[FORCE_PACKET_SIZE], const TelemetryInput& in);

// {"proto":1,"id":"FORCE-A1B2","fw":"1.0.0","rateHz":20,"limitMa":3200}
// Returns the length written (excluding NUL), or 0 if cap is too small.
size_t format_device_info(char* buf, size_t cap, const char* id, const char* fw, int rateHz,
                          int limitMa);

// "FORCE-" + last two bytes of the MAC as upper-case hex. cap must be >= 11.
// Returns the length written (excluding NUL), or 0 if cap is too small.
size_t format_device_name(char* buf, size_t cap, const uint8_t mac[6]);

}  // namespace force
