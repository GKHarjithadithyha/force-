import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@force/cloud';
import { liveSnapshot } from '../../cloud/test/helpers.js';
import { RATE_LIMITS, RateLimiter } from '../src/index.js';
import { DEVICE, TOKEN, closeAll, commit, records, startAgent } from './fixtures.js';

afterEach(closeAll);

const live = (over = {}) => ({ deviceId: DEVICE, snapshot: { ...liveSnapshot(), sessionId: `${DEVICE}-x1`, ...over } });

function rawRequest(port: number, path: string, headers: Record<string, string>, method = 'GET') {
  return new Promise<number>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.end();
  });
}

describe('authentication (H1)', () => {
  it('every endpoint refuses a missing or wrong token; nothing is written', async () => {
    const a = await startAgent();
    for (const path of ['policy', 'reset', 'records', 'commit', 'live']) {
      const none = await fetch(`${a.base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(none.status, path).toBe(401);
      const wrong = await a.post(path, {}, { Authorization: `Bearer ${'z'.repeat(43)}` });
      expect(wrong.status, path).toBe(401);
    }
    expect(a.writer.stats.writes).toBe(0);
    expect(a.logs.some((l) => l.includes(TOKEN))).toBe(false); // the token is never logged
  });

  it('health without the token says only that the agent runs', async () => {
    const a = await startAgent();
    const anon = (await (await fetch(`${a.base}/health`)).json()) as Record<string, unknown>;
    expect(anon).toEqual({ ok: true, service: 'force-cloud-agent' });
    const authed = (await (await fetch(`${a.base}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as Record<string, unknown>;
    expect(authed).toHaveProperty('writes');
  });

  it('failed attempts are rate limited (429)', async () => {
    const a = await startAgent();
    const codes: number[] = [];
    for (let i = 0; i < RATE_LIMITS.authFailure.capacity + 3; i++) {
      codes.push((await a.post('policy', {}, { Authorization: 'Bearer nope' })).status);
    }
    expect(codes.slice(0, RATE_LIMITS.authFailure.capacity).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('policy answers the footstep setting and the live interval', async () => {
    const a = await startAgent({ writer: { footsteps: false, liveIntervalMs: 30_000 } });
    const r = (await (await a.post('policy', {})).json()) as { policy: unknown };
    expect(r.policy).toEqual({ footsteps: false, liveIntervalMs: 30_000 });
  });
});

describe('origin, host and request checks', () => {
  it('refuses foreign origins, foreign Host headers, non-JSON and oversized bodies', async () => {
    const a = await startAgent({ allowedOrigins: ['http://localhost:3000'] });
    expect((await a.post('policy', {}, { Origin: 'https://evil.example' })).status).toBe(403);
    const ok = await a.post('policy', {}, { Origin: 'http://localhost:3000' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect((await a.post('policy', {}, { Origin: `http://127.0.0.1:${a.port}` })).status).toBe(200);
    const plain = await fetch(`${a.base}/live`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${TOKEN}` }, body: '{}' });
    expect(plain.status).toBe(415);
    const big = await fetch(`${a.base}/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: `{"x":"${'a'.repeat(2.1 * 1024 * 1024)}"}` }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect(await rawRequest(a.port, '/api/sync/v1/health', { Host: 'attacker.example' })).toBe(403);
    expect((await a.post('nope', {})).status).toBe(404);
  });

  it('API responses carry the security headers', async () => {
    const a = await startAgent();
    const r = await a.post('policy', {});
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('rate limits (M1)', () => {
  it('token bucket: capacity, then refusal, then refill', () => {
    let t = 0;
    const r = new RateLimiter(3, 60, () => t);
    expect([r.take(), r.take(), r.take()]).toEqual([0, 0, 0]);
    expect(r.take()).toBeGreaterThan(0);
    t += 1_000; // 60 per minute: one token per second
    expect(r.take()).toBe(0);
  });

  it('live endpoint: burst limit returns 429 with Retry-After, whatever the connection state', async () => {
    const a = await startAgent();
    const codes: number[] = [];
    for (let i = 0; i < RATE_LIMITS.live.capacity + 2; i++) {
      const r = await a.post('live', live({ connection: i % 2 ? 'streaming' : 'stale' }));
      codes.push(r.status);
      if (r.status === 429) expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(RATE_LIMITS.live.capacity);
    expect(codes.at(-1)).toBe(429);
  });

  it('writer: alternating connection states cannot exceed one write per gap per device', async () => {
    let now = 0;
    const a = await startAgent({ writer: { minLiveGapMs: 2_000, liveIntervalMs: 30_000, now: () => now } });
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      now += 500;
      const r = (await (await a.post('live', live({ connection: i % 2 ? 'streaming' : 'stale' }))).json()) as { written: number };
      results.push(r.written);
    }
    expect(results.filter((w) => w === 1)).toHaveLength(2); // at 0.5 s and 2.5 s
    now += 2_000;
    expect(((await (await a.post('live', live({ connection: 'stale' }))).json()) as { written: number }).written).toBe(1);
    // same state again 5 s later: below half the 30 s interval, skipped
    now += 5_000;
    expect(((await (await a.post('live', live({ connection: 'stale' }))).json()) as { written: number }).written).toBe(0);
    expect(a.docs.col(COLLECTIONS.liveStatus).size).toBe(1);
  });

  it('write endpoints share one bucket', async () => {
    const a = await startAgent();
    let last = 0;
    for (let i = 0; i < RATE_LIMITS.write.capacity + 1; i++) {
      last = (await a.post('records', records({ sessionId: `${DEVICE}-r${i}` }))).status;
    }
    expect(last).toBe(429);
    expect((await a.post('commit', commit())).status).toBe(429);
  });
});
