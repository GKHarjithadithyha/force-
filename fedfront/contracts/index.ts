/**
 * The frontend's types come from the backend seam, @force/contracts (../packages/contracts).
 * This file only re-exports them and adds view-model types that exist purely for display.
 * Never redefine a contract type here: change it in @force/contracts and docs/INTEGRATION.md.
 */
export type * from '@force/contracts';

/** Overview chart ranges (view model). */
export type Range = 'today' | 'week' | 'month';
export type Bucket = 'hour' | 'day';

/**
 * Multi-tile floor map (view model only). The backend has no multi-tile API yet: the system has
 * one sensor, so the Overview renders the single-tile view.
 */
export interface TileInfo { deviceId: string; name: string; x: number; y: number }

/** One bar/point on the Overview history charts, built from `DashboardEngine.getTotals`. */
export interface HistoryPoint {
  /** Bucket start, epoch ms. */
  t: number;
  energyWh: number;
  steps: number;
  recordedMs: number;
}
