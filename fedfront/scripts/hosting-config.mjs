/**
 * Writes fedfront/firebase.json (Firebase Hosting only) for the static export in fedfront/out.
 *
 *   npm run web:build && npm run hosting:config -w fedfront
 *
 * Run it with the same environment as the build (NEXT_PUBLIC_CLOUD_SYNC_URL). The repository-root
 * firebase.json (Firestore rules and emulators) is a separate file and is not touched.
 *
 * Headers mirror the sync agent's static server (packages/cloud-agent/src/static.ts): inline
 * scripts are allowed only by their sha256 hash, so the CSP is computed from the built pages.
 * Hosting matches headers by path, and the 404 page is served on any path, so one CSP holding
 * the hashes of every page is applied to all paths.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FEDFRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'bluetooth=(self), camera=(), microphone=(), geolocation=(), usb=(), serial=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** sha256 CSP sources of every non-empty inline script in the pages, sorted. */
export function inlineScriptHashes(htmlPages) {
  const hashes = new Set();
  for (const html of htmlPages) {
    for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
      const body = m[1] ?? '';
      if (body.length > 0) {
        hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
      }
    }
  }
  return [...hashes].sort();
}

/** Origin the browser must reach for cloud sync, or null when sync is off or same-origin. */
export function syncOrigin(syncUrl) {
  const raw = (syncUrl ?? '').trim();
  if (raw === '' || raw.startsWith('/')) return null;
  return new URL(raw).origin;
}

export function contentSecurityPolicy(hashes, extraConnect = []) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    // React and ECharts set inline style attributes
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${extraConnect.join(' ')}`.trim(),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const asList = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));

/** Hosting route of an exported page ("index.html" -> "/", "a/b.html" -> "/a/b"), or null for 404. */
export function routeOf(htmlFile) {
  const p = htmlFile.split(sep).join('/').replace(/\.html$/, '');
  if (p === '404' || p === '_not-found') return null;
  if (p === 'index') return '/';
  return `/${p.replace(/\/index$/, '')}`;
}

/** Firebase Hosting config for the export. `pages` is [{ file, html }], file relative to out/. */
export function buildHostingConfig(pages, env = {}) {
  const origin = syncOrigin(env.NEXT_PUBLIC_CLOUD_SYNC_URL);
  const csp = contentSecurityPolicy(
    inlineScriptHashes(pages.map((p) => p.html)),
    origin ? [origin] : [],
  );
  const noCache = [{ key: 'Cache-Control', value: 'no-cache' }];
  const routes = pages
    .map((p) => routeOf(p.file))
    .filter((r) => r !== null)
    .sort();
  return {
    hosting: {
      public: 'out',
      cleanUrls: true,
      trailingSlash: false,
      ignore: ['**/.*', '**/*.map'],
      headers: [
        { source: '**', headers: asList({ ...SECURITY_HEADERS, 'Content-Security-Policy': csp }) },
        {
          source: '/_next/static/**',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        },
        // the service worker and the pages must be revalidated, or an update never reaches users
        { source: '/sw.js', headers: noCache },
        { source: '/manifest.webmanifest', headers: noCache },
        ...routes.map((source) => ({ source, headers: noCache })),
      ],
    },
  };
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return out;
}

async function main() {
  const outDir = join(FEDFRONT, 'out');
  let files;
  try {
    files = await htmlFiles(outDir);
  } catch {
    throw new Error('fedfront/out not found: run `npm run web:build` first.');
  }
  if (files.length === 0) throw new Error('fedfront/out has no HTML pages: rebuild first.');
  const pages = await Promise.all(
    files.map(async (f) => ({ file: relative(outDir, f), html: await readFile(f, 'utf8') })),
  );
  const origin = syncOrigin(process.env.NEXT_PUBLIC_CLOUD_SYNC_URL);
  if (origin) {
    console.warn(
      `warning: cloud sync points at ${origin}. A public deployment normally leaves ` +
        'NEXT_PUBLIC_CLOUD_SYNC_URL unset; the sync agent runs only on the bench computer.',
    );
  }
  const config = buildHostingConfig(pages, process.env);
  await writeFile(join(FEDFRONT, 'firebase.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote fedfront/firebase.json (${pages.length} pages)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
