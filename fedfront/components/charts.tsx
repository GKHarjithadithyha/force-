'use client';

import dynamic from 'next/dynamic';
import type { EChartsOption, LineSeriesOption } from 'echarts';
import { Activity, BarChart3, Footprints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDashboard } from '@/stores/dashboard';
import type { ChartBatch, GapRecord, HistoryPoint, StepEvent } from '@/contracts';
import { format } from 'date-fns';
import { formatEnergy } from '@/lib/format';
import { hasHistory } from '@/lib/analytics';
import { decimateMinMax } from '@/lib/decimate';
import { readChartPalette, useTheme } from '@/components/theme/theme';
import type { ChartPalette } from '@/components/theme/theme';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

/** ECharts needs literal colours, so they are read from the theme tokens (theme.css) for the active theme. */
const tooltipStyle = (c: ChartPalette) => ({ backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1, textStyle: { color: c.tooltipText, fontSize: 12 }, extraCssText: `border-radius:10px;box-shadow:0 8px 24px ${c.tooltipShadow};` });

/** Message shown instead of a chart when there is nothing real to draw. No placeholder values. */
function ChartEmpty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return <div className="chart-empty"><span className="chart-empty-icon"><Icon size={22} aria-hidden="true"/></span><strong>{title}</strong><span>{hint}</span></div>;
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
  useTheme(); const c = readChartPalette(); // re-renders on theme change
  const livePower = useDashboard((s) => s.power); const liveTimes = useDashboard((s) => s.times); const liveSteps = useDashboard((s) => s.steps); const liveGaps = useDashboard((s) => s.gaps); const profile = useDashboard((s) => s.profile);
  const times = stored?.times ?? liveTimes; const power = stored?.powerW ?? livePower;
  const steps = storedSteps ?? liveSteps; const gaps = storedGaps ?? liveGaps;
  const start = stored ? 0 : firstIndexFrom(times, (times.length ? times[times.length - 1] : 0) - (WINDOW_MS[timeWindow] ?? WINDOW_MS['1 hour']));
  const data = decimateMinMax(times, power, start);
  const fromMs = data.length ? data[0][0] : 0;
  const series: LineSeriesOption[] = [{ type: 'line', data, smooth: .3, smoothMonotone: 'x' /* the curve never overshoots a measured value */, symbol: 'circle', symbolSize: 4, showSymbol: data.length < 30, lineStyle: { color: c.line, width: 2 }, itemStyle: { color: c.dot }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.areaTop }, { offset: 1, color: c.areaBottom }] } } }];
  if (showThresholds && data.length) {
    series[0].markPoint = { symbol: 'circle', symbolSize: 8, label: { show: false }, data: steps.filter((e) => e.t >= fromMs).slice(-200).map((event) => ({ name: 'Step', coord: [event.t, event.peakW], itemStyle: { color: c.step } })) };
    series[0].markArea = { silent: true, itemStyle: { color: c.gap }, label: { color: c.gapText, fontSize: 10 }, data: gaps.filter((g) => g.endMs >= fromMs).slice(-50).map((gap) => [{ name: 'Data gap', xAxis: gap.startMs }, { xAxis: gap.endMs }]) };
    if (profile) series[0].markLine = { symbol: 'none', silent: true, lineStyle: { color: c.threshold, type: 'dashed' }, label: { color: c.thresholdText, fontSize: 10 }, data: [{ yAxis: profile.idleThresholdW, name: 'Idle' }, { yAxis: profile.stepThresholdW, name: 'Step' }] };
  }
  const option: EChartsOption = { animation: false, title: data.length ? { show: false } : { show: true, text: emptyText, left: 'center', top: 'middle', textStyle: { color: c.axis, fontSize: 13, fontWeight: 'normal' } }, tooltip: { trigger: 'axis', ...tooltipStyle(c), valueFormatter: (v) => `${Number(v).toFixed(3)} W` }, grid: { left: 52, right: 14, top: 14, bottom: 28 }, xAxis: { type: 'time', axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 12, formatter: (v: number) => format(new Date(v), 'HH:mm:ss'), hideOverlap: true }, splitLine: { show: true, lineStyle: { color: c.grid } } }, yAxis: { type: 'value', min: 0, name: 'Power (W)', nameLocation: 'middle', nameGap: 38, nameTextStyle: { color: c.axis, fontSize: 12 }, axisLabel: { color: c.axis, fontSize: 12 }, splitLine: { lineStyle: { color: c.grid } } }, series };
  return <ReactECharts option={option} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}

/** The large Overview chart: the live power plot, or a clear waiting state until data arrives. */
export function PowerOutputChart({ timeWindow }: { timeWindow: string }) {
  const hasLive = useDashboard((s) => s.power.length > 0);
  if (!hasLive) return <ChartEmpty icon={Activity} title="Waiting for live data" hint="Power appears here as soon as the sensor streams. Connect it, or start the demo."/>;
  return <PowerChart timeWindow={timeWindow}/>;
}

function historyOption(c: ChartPalette, kind: 'bar' | 'line', data: number[], labels: string[], axisName: string, unit: string, integer: boolean): EChartsOption {
  return { animation: false, tooltip: { trigger: 'axis', axisPointer: { type: kind === 'bar' ? 'shadow' : 'line' }, ...tooltipStyle(c), valueFormatter: (v) => `${v} ${unit}` }, grid: { left: 50, right: 12, top: 14, bottom: 28 }, xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 12, interval: 'auto', hideOverlap: true }, splitLine: { show: false } }, yAxis: { type: 'value', min: 0, minInterval: integer ? 1 : undefined, name: axisName, nameLocation: 'middle', nameGap: 36, nameTextStyle: { color: c.axis, fontSize: 12 }, axisLabel: { color: c.axis, fontSize: 12 }, splitLine: { lineStyle: { color: c.grid } } }, series: [{ type: kind, data, smooth: kind === 'line' ? .24 : undefined, smoothMonotone: kind === 'line' ? 'x' : undefined, symbol: kind === 'line' ? 'circle' : 'none', symbolSize: 5, barMaxWidth: 22, lineStyle: { color: c.line, width: 2 }, itemStyle: kind === 'bar' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.barTop }, { offset: 1, color: c.barBottom }] }, borderRadius: [4, 4, 0, 0] } : { color: c.dot }, areaStyle: kind === 'line' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.areaTop }, { offset: 1, color: c.areaBottom }] } } : undefined }] };
}
const bucketLabel = (t: number, range: string) => format(new Date(t), range === 'Today' ? 'H:mm' : range === 'Week' ? 'EEE' : 'd MMM');
const EMPTY_HINT = 'Totals count real-device sessions only. Demo and replay data is excluded.';

export function EnergyChart({ history, range }: { history: HistoryPoint[]; range: string }) {
  useTheme(); const c = readChartPalette();
  if (!hasHistory(history)) return <ChartEmpty icon={BarChart3} title="No recorded device data for this range" hint={EMPTY_HINT}/>;
  const maxEnergy = history.reduce((max, point) => Math.max(max, point.energyWh), 0);
  const unit = formatEnergy(maxEnergy).unit || 'mWh'; const scale = unit === 'mWh' ? 1000 : unit === 'kWh' ? .001 : 1;
  const values = history.map((point) => Number((point.energyWh * scale).toPrecision(4)));
  const labels = history.map((point) => bucketLabel(point.t, range));
  return <ReactECharts option={historyOption(c, 'bar', values, labels, `Energy (${unit})`, unit, false)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}

export function TrafficChart({ history, range }: { history: HistoryPoint[]; range: string }) {
  useTheme(); const c = readChartPalette();
  if (!hasHistory(history)) return <ChartEmpty icon={Footprints} title="No recorded device data for this range" hint={EMPTY_HINT}/>;
  const values = history.map((point) => point.steps);
  const labels = history.map((point) => bucketLabel(point.t, range));
  return <ReactECharts option={historyOption(c, 'line', values, labels, range === 'Today' ? 'Steps per hour' : 'Steps per day', 'steps', true)} notMerge lazyUpdate style={{ height: '100%', width: '100%' }} />;
}
export { TrafficChart as FootTrafficChart };
