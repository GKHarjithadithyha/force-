import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, contentSecurityPolicy, createStaticHandler, describeConfig, loadConfig, redact } from '../src/index.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function site() {
  const outside = mkdtempSync(join(tmpdir(), 'force-outside-'));
  writeFileSync(join(outside, 'secret.json'), '{"private_key":"x"}');
  const root = mkdtempSync(join(tmpdir(), 'force-out-'));
  writeFileSync(join(root, 'index.html'), '<html><script>self.a=1</script><script src="/x.js"></script></html>');
  writeFileSync(join(root, '404.html'), '<html>404</html>');
  writeFileSync(join(root, 'app.js'), 'console.log(1)');
  writeFileSync(join(root, '.env.cloud'), 'FORCE_SYNC_TOKEN=abc');
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'config'), '[core]');
  writeFileSync(join(root, 'notes.ts'), 'secret source');
  let linked = false;
  try {
    symlinkSync(join(outside, 'secret.json'), join(root, 'leak.json'));
    linked = true;
  } catch {
    /* Windows without symlink rights: that check is skipped */
  }
  return { root, linked };
}

async function serve(root: string) {
  const handler = createStaticHandler(root);
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const get = (path: string, method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve) => {
      const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.end();
    });
  return get;
}

describe('static dashboard (S1, S2, S3)', () => {
  it('never serves dotfiles, unknown file types, traversal or symlinks out of the folder', async () => {
    const { root, linked } = site();
    const get = await serve(root);
    expect((await get('/')).status).toBe(200);
    expect((await get('/app.js')).status).toBe(200);
    for (const p of ['/.env.cloud', '/.git/config', '/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cwindows', '/notes.ts', '/a/../.env.cloud']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain('FORCE_SYNC_TOKEN');
    }
    if (linked) expect((await get('/leak.json')).status).toBe(404);
    expect((await get('/', 'POST')).status).toBe(405);
  });

  it('pages carry the CSP with inline-script hashes and the anti-framing headers', async () => {
    const { root } = site();
    const get = await serve(root);
    const r = await get('/');
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-inline' 'sha256"); // scripts are not unsafe-inline
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect((await get('/app.js')).headers['x-content-type-options']).toBe('nosniff');
    // the hash is of the exact inline script text
    expect(contentSecurityPolicy('<script>a</script>')).toContain("'sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs='");
  });
});

describe('configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'force-agent-'));
  const key = join(dir, 'firebase-service-account.json');
  writeFileSync(key, JSON.stringify({ type: 'service_account', project_id: 'force-demo-123', client_email: 'x@force-demo-123.iam.gserviceaccount.com' }));
  const TOKEN = 'x'.repeat(43);
  const base = { FIREBASE_PROJECT_ID: 'force-demo-123', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FORCE_SYNC_TOKEN: TOKEN, FORCE_SYNC_STATIC_DIR: 'off' };

  it('needs a project id, a pairing token and a key file of that project', () => {
    expect(() => loadConfig({}, dir)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, FORCE_SYNC_TOKEN: '' }, dir)).toThrow(/FORCE_SYNC_TOKEN is missing/);
    expect(() => loadConfig({ ...base, FORCE_SYNC_TOKEN: 'short' }, dir)).toThrow(/at least 32/);
    const prod = { ...base, FIRESTORE_EMULATOR_HOST: '' };
    expect(() => loadConfig(prod, dir)).toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);
    expect(() => loadConfig({ ...prod, FIREBASE_PROJECT_ID: 'other-project-1', GOOGLE_APPLICATION_CREDENTIALS: key }, dir)).toThrow(/belongs to project/);
    const c = loadConfig({ ...prod, GOOGLE_APPLICATION_CREDENTIALS: key }, '/elsewhere');
    expect(c).toMatchObject({ projectId: 'force-demo-123', port: 8787, host: '127.0.0.1', footsteps: false, liveIntervalMs: 30_000 });
  });

  it('defaults: localhost only, footsteps off, 30 s live interval; the summary never shows secrets', () => {
    const c = loadConfig(base, dir);
    expect(c.host).toBe('127.0.0.1');
    expect(c.footsteps).toBe(false);
    expect(c.liveIntervalMs).toBe(30_000);
    expect(loadConfig({ ...base, FORCE_SYNC_FOOTSTEPS: 'on' }, dir).footsteps).toBe(true);
    expect(() => loadConfig({ ...base, FORCE_SYNC_FOOTSTEPS: 'maybe' }, dir)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, FORCE_SYNC_LIVE_INTERVAL_S: '1' }, dir)).toThrow(ConfigError);
    const text = describeConfig(loadConfig({ ...base, FORCE_SITE_ID: 'lab', FORCE_SITE_NAME: 'Secret street 1' }, dir)).join('\n');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('Secret street');
  });

  it('allowed origins must be on this computer (M2)', () => {
    expect(loadConfig({ ...base, FORCE_SYNC_ALLOWED_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3001' }, dir).allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3001',
    ]);
    for (const o of ['https://example.com', 'http://192.168.1.5:3000', 'https://localhost:3000', 'http://localhost:3000/path', 'null']) {
      expect(() => loadConfig({ ...base, FORCE_SYNC_ALLOWED_ORIGINS: o }, dir), o).toThrow(ConfigError);
    }
  });

  it('refuses a static folder that holds secrets or the whole repository (S1)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'force-repo-'));
    mkdirSync(join(repo, 'fedfront', 'out'), { recursive: true });
    writeFileSync(join(repo, '.env.cloud'), 'x');
    expect(loadConfig({ ...base, FORCE_SYNC_STATIC_DIR: '' }, repo).staticDir).toBe(join(repo, 'fedfront', 'out'));
    expect(() => loadConfig({ ...base, FORCE_SYNC_STATIC_DIR: '.' }, repo)).toThrow(/secret|repository/);
    expect(() => loadConfig({ ...base, FORCE_SYNC_STATIC_DIR: 'fedfront' }, repo, { envFile: join(repo, 'fedfront', 'my.env') })).toThrow(/secret/);
    const keyInOut = join(repo, 'fedfront', 'out', 'k-service-account.json');
    writeFileSync(keyInOut, JSON.stringify({ type: 'service_account', project_id: 'force-demo-123', client_email: 'a@b' }));
    expect(() => loadConfig({ ...base, FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: keyInOut, FORCE_SYNC_STATIC_DIR: '' }, repo)).toThrow(/secret/);
  });

  it('refuses key material in environment variables and never echoes it', () => {
    const secret = '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----';
    try {
      loadConfig({ ...base, FIREBASE_PRIVATE_KEY: secret }, dir);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('abc');
    }
    expect(redact(`oops ${secret} "private_key":"zzz" Bearer tok123`)).not.toMatch(/abc|zzz|tok123/);
  });
});
