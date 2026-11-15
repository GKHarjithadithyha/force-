// INA219 I2C transport (Arduino Wire). Conversion maths is in ina219_math (host-tested).
// Not thread safe: exactly one task may use it at a time (see ownership note in main.cpp).
#pragma once
#include <stdint.h>

namespace force {

class Ina219 {
 public:
  // (Re)initialises the I2C bus and the INA219: writes the configuration register and reads it
  // back. Returns true only if the chip answered and holds the expected configuration.
  bool begin();

  // Reads the shunt and bus registers (two short I2C transactions). Returns false on any I2C
  // error. Does not allocate memory.
  bool read(int16_t* shuntRaw, uint16_t* busReg);

 private:
  bool write16(uint8_t reg, uint16_t value);
  bool read16(uint8_t reg, uint16_t* value);
};

}  // namespace force
