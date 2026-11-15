import { BRAND_EXPANSION } from '@/lib/brand';

/**
 * Display-only preferences that are not part of the engine's DeviceProfile (which holds every
 * measurement and ESG setting). Stored per browser; a blocked or cleared storage falls back to
 * the defaults.
 */
const BRAND_KEY = 'force.brandExpansion';

export function loadBrandExpansion(): string {
  try {
    return window.localStorage.getItem(BRAND_KEY) || BRAND_EXPANSION;
  } catch {
    return BRAND_EXPANSION;
  }
}

export function saveBrandExpansion(value: string): void {
  try {
    window.localStorage.setItem(BRAND_KEY, value);
  } catch {
    /* storage unavailable: the value still applies for this visit */
  }
}
