/**
 * Engine-mode configuration check, shared by next.config.mjs and the tests.
 *
 * NEXT_PUBLIC_ENGINE:
 *   unset, '' or 'device'  real engine (default; the only mode for production builds)
 *   'mock'                 simulated hardware; development and tests only
 *
 * A production build in mock mode is refused, so simulated data can never ship as the app.
 * FORCE_ALLOW_MOCK_BUILD=1 overrides that for an explicitly labelled demo build.
 */
export const ENGINE_MODES = ['device', 'mock'];

/** Returns 'device' or 'mock'; throws on an unknown value or a mock production build. */
export function resolveEngineMode(env, { production }) {
  const raw = (env.NEXT_PUBLIC_ENGINE ?? '').trim();
  const mode = raw === '' ? 'device' : raw;
  if (!ENGINE_MODES.includes(mode)) {
    throw new Error(
      `NEXT_PUBLIC_ENGINE="${raw}" is not valid. Use "device" (or leave it unset) or "mock".`,
    );
  }
  if (mode === 'mock' && production && env.FORCE_ALLOW_MOCK_BUILD !== '1') {
    throw new Error(
      'Refusing a production build with NEXT_PUBLIC_ENGINE=mock: it would ship simulated data. ' +
        'Unset NEXT_PUBLIC_ENGINE, or set FORCE_ALLOW_MOCK_BUILD=1 for a labelled demo build.',
    );
  }
  return mode;
}
