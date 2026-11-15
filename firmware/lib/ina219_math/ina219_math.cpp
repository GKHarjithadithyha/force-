#include "ina219_math.h"

namespace force {

int32_t ina219_shunt_to_ma(int16_t raw, uint32_t shuntMohm) {
  if (shuntMohm == 0) return 0;
  const int64_t num = static_cast<int64_t>(raw) * 10;  // microvolts
  const int64_t den = static_cast<int64_t>(shuntMohm);
  const int64_t half = den / 2;
  const int64_t q = (num >= 0) ? (num + half) / den : -((-num + half) / den);
  return static_cast<int32_t>(q);
}

uint16_t ina219_bus_to_mv(uint16_t busReg) {
  return static_cast<uint16_t>((busReg >> 3) * 4u);
}

bool ina219_bus_overflow(uint16_t busReg) { return (busReg & 0x1u) != 0; }

int16_t clamp_to_i16(int32_t v) {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return static_cast<int16_t>(v);
}

bool ina219_reading_valid(int16_t shuntRaw, uint16_t busReg) {
  if (busReg == 0xFFFFu) return false;
  if (shuntRaw == 32767 || shuntRaw == -32768) return false;
  return true;
}

bool ina219_at_limit(int16_t shuntRaw, int32_t currentMa, int32_t limitMa) {
  const int32_t absRaw = shuntRaw < 0 ? -static_cast<int32_t>(shuntRaw) : shuntRaw;
  const int32_t absMa = currentMa < 0 ? -currentMa : currentMa;
  return absRaw >= INA219_SHUNT_SATURATION_RAW || absMa >= limitMa;
}

}  // namespace force
