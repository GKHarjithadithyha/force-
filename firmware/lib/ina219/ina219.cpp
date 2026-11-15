#include "ina219.h"

#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "ina219_math.h"

namespace force {

bool Ina219::write16(uint8_t reg, uint16_t value) {
  Wire.beginTransmission(static_cast<uint8_t>(INA219_I2C_ADDR));
  Wire.write(reg);
  Wire.write(static_cast<uint8_t>(value >> 8));
  Wire.write(static_cast<uint8_t>(value & 0xFF));
  return Wire.endTransmission() == 0;
}

bool Ina219::read16(uint8_t reg, uint16_t* value) {
  Wire.beginTransmission(static_cast<uint8_t>(INA219_I2C_ADDR));
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(static_cast<uint8_t>(INA219_I2C_ADDR), static_cast<uint8_t>(2)) != 2) {
    return false;
  }
  const uint8_t hi = Wire.read();
  const uint8_t lo = Wire.read();
  *value = static_cast<uint16_t>((hi << 8) | lo);
  return true;
}

bool Ina219::begin() {
  Wire.end();  // releases a possibly wedged bus before re-initialising
  if (!Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_CLOCK_HZ)) return false;
  Wire.setTimeOut(I2C_TIMEOUT_MS);
  if (!write16(INA219_REG_CONFIG, INA219_CONFIG_WORD)) return false;
  uint16_t back = 0;
  if (!read16(INA219_REG_CONFIG, &back)) return false;
  return back == INA219_CONFIG_WORD;
}

bool Ina219::read(int16_t* shuntRaw, uint16_t* busReg) {
  uint16_t shunt = 0;
  if (!read16(INA219_REG_SHUNT, &shunt)) return false;
  if (!read16(INA219_REG_BUS, busReg)) return false;
  *shuntRaw = static_cast<int16_t>(shunt);
  return true;
}

}  // namespace force
