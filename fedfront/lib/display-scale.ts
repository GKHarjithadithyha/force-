/**
 * Display calibration: when ON, the voltage SHOWN is multiplied by 1.8, and the values derived from it are
 * shown consistently: power = V x I and energy = integral of power both scale by 1.8 (current is unchanged),
 * CO2 follows energy. Presentation only: raw samples, engine metrics, storage, exports and cloud sync never see it.
 */
export const DISPLAY_SCALE = 1.8;
export const scaleFor = (on: boolean): number => (on ? DISPLAY_SCALE : 1);
export const scaleValue = (v: number | null | undefined, k: number): number | null | undefined => (v == null ? v : v * k);
