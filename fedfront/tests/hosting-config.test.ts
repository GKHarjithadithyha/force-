import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildHostingConfig,
  inlineScriptHashes,
  routeOf,
  syncOrigin,
} from '../scripts/hosting-config.mjs';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

function rules(env: Record<string, string> = {}): Rule[] {
  const pages = [
    { file: 'index.html', html: '<script>a()</script><script src="/x.js"></script>' },
    { file: 'offline.html', html: '<script>b()</script><script></script>' },
    { file: '404.html', html: '<script>a()</script>' },
  ];
  return buildHostingConfig(pages, env).hosting.headers as Rule[];
}

const header = (rule: Rule | undefined, key: string) =>
  rule?.headers.find((h) => h.key === key)?.value;

describe('hosting config', () => {
  it('hashes each distinct inline script once and skips external and empty scripts', () => {
    expect(inlineScriptHashes(['<script>a()</script>', '<script>a()</script><script src="s"></script><script></script>'])).toEqual([sha('a()')]);
  });

  it('applies security headers and a hash-only CSP to every path', () => {
    const all = rules().find((r) => r.source === '**');
    const csp = header(all, 'Content-Security-Policy') ?? '';
    expect(csp).toContain(`script-src 'self' ${[sha('a()'), sha('b()')].sort().join(' ')}`);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("connect-src 'self';");
    expect(header(all, 'Permissions-Policy')).toContain('bluetooth=(self)');
    expect(header(all, 'X-Frame-Options')).toBe('DENY');
  });

  it('caches hashed assets forever and revalidates pages and the service worker', () => {
    const r = rules();
    expect(header(r.find((x) => x.source === '/_next/static/**'), 'Cache-Control')).toContain('immutable');
    for (const source of ['/sw.js', '/', '/offline']) {
      expect(header(r.find((x) => x.source === source), 'Cache-Control')).toBe('no-cache');
    }
  });

  it('allows the sync agent origin only when cloud sync is an absolute URL', () => {
    expect(syncOrigin(undefined)).toBeNull();
    expect(syncOrigin('/api/sync/v1')).toBeNull();
    expect(syncOrigin('http://127.0.0.1:8787/api/sync/v1')).toBe('http://127.0.0.1:8787');
    const csp = header(rules({ NEXT_PUBLIC_CLOUD_SYNC_URL: 'http://127.0.0.1:8787/api/sync/v1' }).find((x) => x.source === '**'), 'Content-Security-Policy');
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:8787;");
  });

  it('maps exported files to clean routes', () => {
    expect(routeOf('index.html')).toBe('/');
    expect(routeOf('offline.html')).toBe('/offline');
    expect(routeOf('404.html')).toBeNull();
  });
});
