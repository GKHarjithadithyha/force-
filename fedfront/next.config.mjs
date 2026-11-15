import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import withSerwistInit from '@serwist/next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { resolveEngineMode } from './config/engine-mode.mjs';

/** Monorepo root (fedfront consumes ../packages/*). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

/**
 * The data layer lives in the monorepo packages (../packages/*) and is consumed from TypeScript
 * source through the root node_modules/@force/* workspace links. Next transpiles them, and the
 * `.js` import specifiers inside them (ESM style) resolve to their `.ts` files.
 */
const FORCE_PACKAGES = [
  '@force/contracts',
  '@force/protocol',
  '@force/engine',
  '@force/simulator',
  '@force/device',
  '@force/storage',
  '@force/worker',
];

/** @type {import('next').NextConfig} */
const baseConfig = {
  output: 'export',
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: false },
  devIndicators: false,
  outputFileTracingRoot: ROOT,
  transpilePackages: FORCE_PACKAGES,
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default function nextConfig(phase) {
  // fails fast on a bad NEXT_PUBLIC_ENGINE, and never builds mock mode for production
  resolveEngineMode(process.env, { production: phase === PHASE_PRODUCTION_BUILD });
  return withSerwist(baseConfig);
}
