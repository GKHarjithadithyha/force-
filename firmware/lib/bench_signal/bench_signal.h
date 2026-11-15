// Synthetic footstep signal for BENCH_MODE: 100-200 ms pulses at about 90 steps/min, noise,
// up to 60 W. Pure C++ (host-testable). Time driven: output depends only on the time passed in
// and the call-order-dependent noise generator, so the schedule never drifts.
#pragma once
#include <stdint.h>

namespace force {

struct BenchParams {
  uint32_t stepsPerMin;
  uint32_t pulseMinMs;
  uint32_t pulseMaxMs;
  uint32_t peakMinMw;
  uint32_t peakMaxMw;
  uint32_t idleVoltageMv;
  uint32_t peakVoltageMv;
  int32_t noiseMa;  // +-noise added to current
  int32_t noiseMv;  // +-noise added to voltage
  uint32_t seed;
};

class BenchSignal {
 public:
  explicit BenchSignal(const BenchParams& p);
  // tMs: milliseconds since boot (monotonic). Produces one raw sample.
  void sample(uint32_t tMs, uint16_t* voltageMv, int16_t* currentMa);

 private:
  uint32_t rnd();
  uint32_t hash(uint32_t step, uint32_t salt) const;
  BenchParams p_;
  uint32_t state_;
};

}  // namespace force
