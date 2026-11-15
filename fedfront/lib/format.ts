export function formatEnergy(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return { value: '—', unit: '' };
  if (value < 1) return { value: (value * 1000).toFixed(0), unit: 'mWh' };
  if (value < 1000) return { value: value.toFixed(value < 10 ? 2 : 1).replace(/\.0$/, ''), unit: 'Wh' };
  return { value: (value / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''), unit: 'kWh' };
}
export function formatPower(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return { value: '—', unit: '' };
  if (value > 0 && value < 1) return { value: (value * 1000).toFixed(0), unit: 'mW' };
  return { value: value.toFixed(value < 10 ? 1 : 0), unit: 'W' };
}
export function formatCo2(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return { value: '—', unit: '' };
  if (value < 1) return { value: (value * 1000).toFixed(1), unit: 'g' };
  return { value: value.toFixed(2), unit: 'kg' };
}
export function formatRecorded(recordedMs: number) {
  return `Recorded ${Math.floor(recordedMs / 3600000)}h ${Math.floor((recordedMs % 3600000) / 60000)}m`;
}
export function formatQuality(recordedMs: number, gapMs: number) {
  const hours = (ms: number) => `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  return `Recorded ${hours(recordedMs)} · Gaps ${hours(gapMs)}`;
}
