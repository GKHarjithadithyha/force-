import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Serves the static dashboard build (fedfront/out) safely:
 * - only GET/HEAD, only known web file types, never dotfiles or dot-folders;
 * - no path traversal, and no symlink that leads outside the folder (checked on the real path);
 * - security headers on every response, and a Content-Security-Policy for HTML pages whose
 *   script-src lists the SHA-256 of each inline script in that page (no 'unsafe-inline').
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** Headers for every agent response (pages and API). */
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'bluetooth=(self), camera=(), microphone=(), geolocation=(), usb=(), serial=()',
};

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** CSP for one HTML page: inline scripts allowed only by hash. */
export function contentSecurityPolicy(html: string): string {
  const hashes = new Set<string>();
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    const body = m[1] ?? '';
    if (body.length > 0) {
      hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`.trim(),
    // React and ECharts set inline style attributes
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createStaticHandler(dir: string) {
  const root = resolve(dir);
  let realRoot: string | null = null;
  const cspCache = new Map<string, { mtimeMs: number; csp: string }>();

  async function resolveFile(urlPath: string): Promise<string | null> {
    let clean: string;
    try {
      clean = normalize(decodeURIComponent(urlPath.split('?')[0]!.split('#')[0]!)).replace(
        /^([/\\])+/,
        '',
      );
    } catch {
      return null;
    }
    if (clean.includes('\0')) return null;
    // no dotfiles or dot-folders (.env, .git, ...)
    if (clean.split(/[/\\]+/).some((seg) => seg.startsWith('.') && seg.length > 0)) return null;
    const base = join(root, clean);
    if (base !== root && !base.startsWith(root + sep)) return null; // no path traversal
    realRoot ??= await realpath(root);
    for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
      try {
        if (!(await stat(candidate)).isFile()) continue;
        const real = await realpath(candidate);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) return null; // symlink escape
        if (!(extname(real).toLowerCase() in TYPES)) return null; // known web types only
        return real;
      } catch {
        /* try the next form */
      }
    }
    return null;
  }

  async function cspFor(file: string, body: Buffer): Promise<string> {
    const { mtimeMs } = await stat(file);
    const hit = cspCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.csp;
    const csp = contentSecurityPolicy(body.toString('utf8'));
    cspCache.set(file, { mtimeMs, csp });
    return csp;
  }

  return async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...BASE_SECURITY_HEADERS, Allow: 'GET, HEAD' }).end();
      return;
    }
    const found = await resolveFile(req.url ?? '/');
    const file = found ?? join(root, '404.html');
    try {
      const body = await readFile(file);
      const ext = extname(file).toLowerCase();
      const headers: Record<string, string> = {
        ...BASE_SECURITY_HEADERS,
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      };
      if (ext === '.html') {
        headers['Content-Security-Policy'] = await cspFor(file, body);
        headers['Cache-Control'] = 'no-cache';
      }
      res.writeHead(found ? 200 : 404, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res
        .writeHead(404, { ...BASE_SECURITY_HEADERS, 'Content-Type': 'text/plain' })
        .end('Not found');
    }
  };
}
