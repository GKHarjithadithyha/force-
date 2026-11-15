#include "bench_signal.h"

#include <math.h>

namespace force {

BenchSignal::BenchSignal(const BenchParams& p) : p_(p), state_(p.seed ? p.seed : 1u) {}

uint32_t BenchSignal::rnd() {  // xorshift32
  uint32_t x = state_;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  state_ = x;
  return x;
}

uint32_t BenchSignal::hash(uint32_t step, uint32_t salt) const {
  uint32_t x = step * 2654435761u ^ (p_.seed + salt * 40503u);
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

void BenchSignal::sample(uint32_t tMs, uint16_t* voltageMv, int16_t* currentMa) {
  const uint32_t periodMs = 60000u / (p_.stepsPerMin ? p_.stepsPerMin : 1u);
  const uint32_t step = tMs / (periodMs ? periodMs : 1u);
  // Start of the current step, from integer maths so 90 spm does not accumulate rounding.
  const uint32_t stepStart = static_cast<uint32_t>((static_cast<uint64_t>(step) * 60000u) /
                                                   (p_.stepsPerMin ? p_.stepsPerMin : 1u));
  const uint32_t into = tMs - stepStart;
  const uint32_t span = p_.pulseMaxMs - p_.pulseMinMs + 1u;
  const uint32_t durationMs = p_.pulseMinMs + hash(step, 1) % span;
  const uint32_t peakSpan = p_.peakMaxMw - p_.peakMinMw + 1u;
  const uint32_t peakMw = p_.peakMinMw + hash(step, 2) % peakSpan;

  float shape = 0.0f;  // 0..1, half-sine; power follows shape squared
  if (into < durationMs) shape = sinf(3.14159265f * static_cast<float>(into) / static_cast<float>(durationMs));

  const float powerMw = static_cast<float>(peakMw) * shape * shape;
  const float vMv = static_cast<float>(p_.idleVoltageMv) +
                    static_cast<float>(p_.peakVoltageMv - p_.idleVoltageMv) * shape;
  float iMa = powerMw / vMv * 1000.0f;  // mW / mV = A... in mA: (mW / mV) * 1000

  const int32_t span2 = 2 * p_.noiseMa + 1;
  const int32_t span3 = 2 * p_.noiseMv + 1;
  const int32_t nI = p_.noiseMa ? static_cast<int32_t>(rnd() % static_cast<uint32_t>(span2)) - p_.noiseMa : 0;
  const int32_t nV = p_.noiseMv ? static_cast<int32_t>(rnd() % static_cast<uint32_t>(span3)) - p_.noiseMv : 0;

  int32_t v = static_cast<int32_t>(lroundf(vMv)) + nV;
  int32_t i = static_cast<int32_t>(lroundf(iMa)) + nI;
  if (v < 0) v = 0;
  if (v > 32764) v = 32764;
  if (i > 32767) i = 32767;
  if (i < -32768) i = -32768;
  *voltageMv = static_cast<uint16_t>(v);
  *currentMa = static_cast<int16_t>(i);
}

}  // namespace force
