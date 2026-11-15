'use client';

import dynamic from 'next/dynamic';
import type { EChartsOption, LineSeriesOption } from 'echarts';
import { useDashboard } from '@/stores/dashboard';
import type { ChartBatch, GapRecord, HistoryPoint, StepEvent } from '@/contracts';
import { format } from 'date-fns';
import { formatEnergy } from '@/lib/format';
import { hasHistory } from '@/lib/analytics';
import { decimateMinMax } from '@/lib/decimate';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const gridColor = 'rgba(132, 148, 169, .16)';
const axisColor = '#a0a2b4';

/** Centered message shown instead of data. Charts never draw placeholder values. */
function emptyTitle(text: string): EChartsOption['title'] {
  return { show: true, text, left: 'center', top: 'middle', textStyle: { color: axisColor, fontSize: 13, fontWeight: 'normal' } };
}

const WINDOW_MS: Record<string, number> = { '30 seconds': 30_000, '5 minutes': 300_000, '1 hour': 3_600_000 };

/** First index whose time is at or after `fromMs` (times are ascending). */
function firstIndexFrom(times: ArrayLike<number>, fromMs: number): number {
  let lo = 0; let hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < fromMs) lo = mid + 1; else hi = mid; }
  return lo;
}

export interface PowerSeries { times: ArrayLike<number>; powerW: ArrayLike<number> }

/**
 * Power over time. By default it plots the live buffer from the store; pass `series` (with
 * `steps`/`gaps`) to plot a stored session instead.
 */
export function PowerChart({ showThresholds = false, timeWindow = '1 hour', series: stored, steps: storedSteps, gaps: storedGaps, emptyText = 'No live data · Connect the sensor or start the demo' }: { showThresholds?: boolean; timeWindow?: string; series?: ChartBatch | PowerSeries; steps?: StepEvent[]; gaps?: GapRecord[]; emptyText?: string }) {
  const livePower = useDashboard((s) => s.power); const liveTimes = useDashboard((s) => s.times); const liveSteps = useDashboard((s) => s.steps); const liveGaps = useDashboard((s) => s.gaps); const profile = useDashboard((s) => s.profile);
  const times = stored?.times ?? liveTimes; const power = stored?.powerW ?? livePower;
  const steps = storedSteps ?? liveSteps; const gaps = storedGaps ?? liveGaps;
  const start = stored ? 0 : firstIndexFrom(times, (times.length ? times[times.length - 1] : 0) - (WINDOW_MS[timeWindow] ?? WINDOW_MS['1 hour']));
  const data = decimateMinMax(times, power, start);
  const fromMs = data.length ? data[0][0] : 0;
  const series: LineSeriesOption[] = [{ type: 'line', data, smooth: .3, smoothMonotone: 'x' /* the curve never overshoots a measured value */, symbol: 'circle', symbolSize: 4, showSymbol: data.length < 30, lineStyle: { color: '#c078ff', width: 2 }, itemStyle: { color: '#db9bff' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(168, 63, 248, .52)' }, { offset: 1, color: 'rgba(94, 32, 156, .04)' }] } } }];
  if (showThresholds && data.length) {
    series[0].markPoint = { symbol: 'circle', symbolSize: 8, label: { show: false }, data: steps.filter((e) => e.t >= fromMs).slice(-200).map((event) => ({ name: 'Step', coord: [event.t, event.peakW], itemStyle: { color: '#31ddb0' } })) };
    series[0].markArea = { silent: true, itemStyle: { color: 'rgba(245, 158, 11, .12)' }, label: { color: '#f5c773', fontSize: 10 }, data: gaps.filter((g) => g.endMs >= fromMs).slice(-50).map((gap) => [{ name: 'Data gap', xAxis: gap.startMs }, { xAxis: gap.endMs }]) };
    if (profile) series[0].markLine = { symbol: 'none', silent: true, lineStyle: { color: 'rgba(245, 158, 11, .38)', type: 'dashed' }, label: { color: '#d2ae71', fontSize: 10 }, data: [{ yAxis: profile.idleThresholdW, name: 'Idle' }, { yAxis: profile.stepThresholdW, name: 'Step' }] };
  }
  const option: EChartsOption = { animation: false, title: data.length ? { show: false } : emptyTitle(emptyText), tooltip: { trigger: 'axis', valueFormatter: (v) => `${Number(v).toFixed(3)} W` }, grid: { left: 47, right: 10, top: 10, bottom: 27 }, xAxis: { type: 'time', axisLine: { lineStyle: { color: gridColor } }, axisTick: { show: false }, axisLabel: { color: axisColor, fontSize: 12, formatter: (v: number) => format(new Date(v), 'HH:mm:ss'), hideOverlap: true }, splitLine: { show: true, lineStyle: { color: gridColor } } }, yAxis: { type: 'value', min: 0, name: 'Power (W)', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: '#ddd', fontSize: 13 }, axisLabel: { color: axisColor, fontSize: 12 }, splitLine: { lineStyle: { color: gridColor } } }, series };
  return <ReactECharts option={option} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}

function chartOption(type: 'bar' | 'line', data: number[], labels: string[], label: string, empty: string | null): EChartsOption {
  const base = chartOptionFull(type, data, labels, label, empty);
  if (!empty) return base;
  /* empty state: only the message, no axes (axis numbers 0 to 1 would collide with it and imply data) */
  return { ...base, xAxis: { ...(base.xAxis as object), axisLabel: { show: false }, axisLine: { show: false } }, yAxis: { type: 'value', show: false, min: 0, max: 1 }, series: [] };
}
function chartOptionFull(type: 'bar' | 'line', data: number[], labels: string[], label: string, empty: string | null): EChartsOption {
  return { animation: false, title: empty ? emptyTitle(empty) : { show: false }, tooltip: { trigger: 'axis' }, grid: { left: 45, right: 8, top: 10, bottom: 25 }, xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: gridColor } }, axisTick: { show: false }, axisLabel: { color: axisColor, fontSize: 12, interval: 'auto' }, splitLine: { show: false } }, yAxis: { type: 'value', name: label, nameLocation: 'middle', nameGap: 31, nameTextStyle: { color: '#ddd', fontSize: 13 }, axisLabel: { color: axisColor, fontSize: 12 }, splitLine: { lineStyle: { color: gridColor } } }, series: [{ type, data, smooth: type === 'line' ? .24 : undefined, symbol: type === 'line' ? 'circle' : 'none', symbolSize: 4, barWidth: 15, lineStyle: { color: '#c078ff', width: 2 }, itemStyle: type === 'bar' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#be53ff' }, { offset: 1, color: '#713be0' }] }, borderRadius: [2, 2, 0, 0] } : { color: '#d595ff' }, areaStyle: type === 'line' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(160,55,235,.36)' }, { offset: 1, color: 'rgba(94,32,156,.03)' }] } } : undefined }] };
}
const EMPTY_HISTORY = 'No recorded device data for this range';
const bucketLabel = (t: number, range: string) => format(new Date(t), range === 'Today' ? 'H:mm' : range === 'Week' ? 'EEE' : 'd MMM');
export function EnergyChart({ history, range }: { history: HistoryPoint[]; range: string }) {
  const empty = !hasHistory(history);
  const maxEnergy = history.reduce((max, point) => Math.max(max, point.energyWh), 0);
  const unit = formatEnergy(maxEnergy).unit || 'mWh'; const scale = unit === 'mWh' ? 1000 : unit === 'kWh' ? .001 : 1;
  const values = history.map((point) => point.energyWh * scale);
  const labels = history.map((point) => bucketLabel(point.t, range));
  return <ReactECharts option={chartOption('bar', values, labels, `Energy (${unit})`, empty ? EMPTY_HISTORY : null)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}
export function TrafficChart({ history, range }: { history: HistoryPoint[]; range: string }) {
  const empty = !hasHistory(history);
  const values = history.map((point) => point.steps);
  const labels = history.map((point) => bucketLabel(point.t, range));
  return <ReactECharts option={chartOption('line', values, labels, range === 'Today' ? 'Steps / hour' : 'Steps / day', empty ? EMPTY_HISTORY : null)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}
