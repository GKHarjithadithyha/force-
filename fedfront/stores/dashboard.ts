import { create } from 'zustand';
import type { ChartBatch, DashboardEngine, DeviceProfile, GapRecord, LiveSnapshot, SourceKind, StepEvent } from '@/contracts';
import type { AppEngine } from '@/engine';
import { BRAND_EXPANSION } from '@/lib/brand';

/** Live chart buffer: one hour at 20 Hz. */
export const MAX_POINTS = 72_000;

interface DashboardState {
  app: AppEngine | null;
  engine: DashboardEngine | null;
  snapshot: LiveSnapshot | null;
  profile: DeviceProfile | null;
  /** Live power samples (W) and their epoch-ms times, straight from the engine's chart batches. */
  power: number[];
  times: number[];
  steps: StepEvent[];
  gaps: GapRecord[];
  page: string;
  range: string;
  brandExpansion: string;
  setApp: (app: AppEngine | null) => void;
  setSnapshot: (snapshot: LiveSnapshot) => void;
  setProfile: (profile: DeviceProfile) => void;
  pushChart: (batch: ChartBatch) => void;
  pushStep: (step: StepEvent) => void;
  pushGap: (gap: GapRecord) => void;
  clearLive: () => void;
  setPage: (page: string) => void;
  setRange: (range: string) => void;
  setBrandExpansion: (value: string) => void;
}

/** Chart samples are collected and applied at most this often, so charts redraw at ~4 Hz. */
export const CHART_FLUSH_MS = 250;

export const useDashboard = create<DashboardState>((set, get) => {
  let pendingPower: number[] = []; let pendingTimes: number[] = []; let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    if (pendingTimes.length === 0) return;
    const state = get();
    const power = state.power.concat(pendingPower); const times = state.times.concat(pendingTimes);
    pendingPower = []; pendingTimes = [];
    const over = power.length - MAX_POINTS;
    set(over > 0 ? { power: power.slice(over), times: times.slice(over) } : { power, times });
  };
  return {
  app: null, engine: null, snapshot: null, profile: null, power: [], times: [], steps: [], gaps: [], page: 'Overview', range: 'Today', brandExpansion: BRAND_EXPANSION,
  setApp: (app) => set({ app, engine: app?.engine ?? null }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setProfile: (profile) => set({ profile }),
  pushChart: (batch) => {
    if (batch.times.length === 0) return;
    for (let i = 0; i < batch.times.length; i++) { pendingTimes.push(batch.times[i]); pendingPower.push(batch.powerW[i]); }
    if (flushTimer === null) flushTimer = setTimeout(flush, CHART_FLUSH_MS);
  },
  pushStep: (step) => set((state) => ({ steps: [...state.steps.slice(-999), step] })),
  pushGap: (gap) => set((state) => ({ gaps: [...state.gaps.slice(-99), gap] })),
  clearLive: () => { pendingPower = []; pendingTimes = []; set({ power: [], times: [], steps: [], gaps: [] }); },
  setPage: (page) => set({ page }),
  setRange: (range) => set({ range }),
  setBrandExpansion: (brandExpansion) => set({ brandExpansion }),
  };
});

export function sourceLabel(source: SourceKind) { return source === 'device' ? 'Device' : source === 'demo' ? 'Demo' : 'Replay'; }
