/**
 * Display-only downsampling for the power chart. One hour at 20 Hz is 72 000 samples, which is far
 * more than a chart is wide. Each bucket keeps its minimum and maximum sample in time order, so
 * step peaks and idle troughs stay visible. Values are never changed or averaged.
 */
export const MAX_CHART_POINTS = 2000;

export function decimateMinMax(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  start = 0,
  maxPoints = MAX_CHART_POINTS,
): Array<[number, number]> {
  const n = times.length - start;
  const out: Array<[number, number]> = [];
  if (n <= 0) return out;
  if (n <= maxPoints) {
    for (let i = start; i < times.length; i++) out.push([times[i], values[i]]);
    return out;
  }
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = start + Math.floor(b * size);
    const to = Math.min(times.length, start + Math.floor((b + 1) * size));
    if (from >= to) continue;
    let lo = from; let hi = from;
    for (let i = from + 1; i < to; i++) {
      if (values[i] < values[lo]) lo = i;
      if (values[i] > values[hi]) hi = i;
    }
    if (lo === hi) out.push([times[lo], values[lo]]);
    else if (lo < hi) out.push([times[lo], values[lo]], [times[hi], values[hi]]);
    else out.push([times[hi], values[hi]], [times[lo], values[lo]]);
  }
  return out;
}
