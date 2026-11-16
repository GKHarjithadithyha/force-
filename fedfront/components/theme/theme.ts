'use client';

import { useSyncExternalStore } from 'react';
import { THEME_KEY } from '@/components/theme/theme-script';

/**
 * Theme state. The source of truth is the `data-theme` attribute on <html>: CSS reads it
 * (app/theme.css), the inline script in app/layout.tsx sets it before first paint from
 * localStorage, and this module changes it and saves the choice. Dark is the default.
 */
export type Theme = 'dark' | 'light';

const listeners = new Set<() => void>();
const current = (): Theme => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
const emit = () => listeners.forEach((l) => l());

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked: the choice lasts for this visit */ }
  emit();
}
export const toggleTheme = (): void => setTheme(current() === 'light' ? 'dark' : 'light');

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // another tab changed the preference: follow it
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    document.documentElement.setAttribute('data-theme', e.newValue === 'light' ? 'light' : 'dark');
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** The active theme. Server and first client render report 'dark' (the default), then it syncs. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => 'dark');
}

export interface ChartPalette { grid: string; axis: string; line: string; dot: string; areaTop: string; areaBottom: string; barTop: string; barBottom: string; step: string; gap: string; gapText: string; threshold: string; thresholdText: string; tooltipBg: string; tooltipBorder: string; tooltipText: string; tooltipShadow: string }

// Used on the server render (no document); identical to the dark tokens in app/theme.css.
const DARK_FALLBACK: ChartPalette = { grid: 'rgba(161, 161, 181, .14)', axis: '#A1A1B5', line: '#C084FC', dot: '#E9D5FF', areaTop: 'rgba(168, 85, 247, .42)', areaBottom: 'rgba(168, 85, 247, .02)', barTop: '#C084FC', barBottom: '#7C3AED', step: '#2DD4A5', gap: 'rgba(245, 158, 11, .12)', gapText: '#f5c773', threshold: 'rgba(245, 158, 11, .38)', thresholdText: '#d2ae71', tooltipBg: '#101722', tooltipBorder: '#263244', tooltipText: '#F5F5FA', tooltipShadow: 'rgba(0, 0, 0, .4)' };
const VARS: Record<keyof ChartPalette, string> = { grid: '--chart-grid', axis: '--chart-axis', line: '--chart-line', dot: '--chart-dot', areaTop: '--chart-area-top', areaBottom: '--chart-area-bottom', barTop: '--chart-bar-top', barBottom: '--chart-bar-bottom', step: '--chart-step', gap: '--chart-gap', gapText: '--chart-gap-text', threshold: '--chart-threshold', thresholdText: '--chart-threshold-text', tooltipBg: '--tooltip-bg', tooltipBorder: '--tooltip-border', tooltipText: '--tooltip-text', tooltipShadow: '--tooltip-shadow' };

/** Chart colours for the active theme, read from the CSS tokens (ECharts needs literal colours). */
export function readChartPalette(): ChartPalette {
  if (typeof document === 'undefined') return DARK_FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const out = { ...DARK_FALLBACK };
  for (const key of Object.keys(VARS) as Array<keyof ChartPalette>) {
    const v = style.getPropertyValue(VARS[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}
