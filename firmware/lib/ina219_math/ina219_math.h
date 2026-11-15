// INA219 register conversion maths. Pure C++ (host-testable); the I2C transport is in ina219/.
// Direct-register approach: the shunt register is read as-is, so no calibration register and
// no library rounding are involved.
#pragma once
#include <stdint.h>

namespace force {

// Configuration register 0x00:
//   BRNG=1 (32 V bus range), PG=11 (gain /8: +-320 mV), BADC=0011 (12-bit, 1 sample, 532 us),
//   SADC=0011 (12-bit, 1 sample), MODE=111 (shunt + bus, continuous). No averaging.
constexpr uint16_t INA219_REG_CONFIG = 0x00;
constexpr uint16_t INA219_REG_SHUNT = 0x01;
constexpr uint16_t INA219_REG_BUS = 0x02;
constexpr uint16_t INA219_CONFIG_WORD =
    (1u << 13) | (3u << 11) | (0x3u << 7) | (0x3u << 3) | 0x7u;  // = 0x399F

// Shunt register LSB is 10 uV; at gain /8 it saturates at 320 mV = raw 32000.
constexpr int16_t INA219_SHUNT_SATURATION_RAW = 32000;

// mA = shunt_uV / shunt_mohm = raw * 10 / shunt_mohm (exact unit identity: uV / mohm = mA).
// Rounded half away from zero.
int32_t ina219_shunt_to_ma(int16_t raw, uint32_t shuntMohm);

// Bus voltage register: bits 15..3 = value, LSB 4 mV. Bit 1 = CNVR, bit 0 = OVF.
uint16_t ina219_bus_to_mv(uint16_t busReg);
bool ina219_bus_overflow(uint16_t busReg);

int16_t clamp_to_i16(int32_t v);

// INA219 absolute maximum bus input (VIN+ / VIN-), mV. The 32 V range setting does not raise it.
constexpr uint32_t INA219_BUS_RATING_MV = 26000;

// False for register values no working INA219 produces: an all-ones bus register (a floating or
// stuck I2C line reads 0xFFFF) or a shunt register on either 16-bit rail (0x7FFF / 0x8000).
// A shunt reading beyond +-32000 is NOT invalid: that is ADC saturation, reported as overrange.
bool ina219_reading_valid(int16_t shuntRaw, uint16_t busReg);

// True when the reading is at or beyond the sensor limit (or the ADC is saturated).
bool ina219_at_limit(int16_t shuntRaw, int32_t currentMa, int32_t limitMa);

}  // namespace force
