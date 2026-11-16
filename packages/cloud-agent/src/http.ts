import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SYNC_API_VERSION } from '@force/cloud';
import { classifyFirestoreError } from './admin.js';
import type { Logger } from './log.js';
import { BASE_SECURITY_HEADERS } from './static.js';
import { ValidationError, parseCommit, parseLive, parseRecords, parseReset } from './validate.js';
import { ConflictError } from './writer.js';
import type { CloudWriter } from './writer.js';

export const API_PREFIX = `/api/sync/${SYNC_API_VERSION}/`;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Token bucket: `capacity` requests at once, refilled at `perMinute`. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  /** Takes one token; returns 0 when allowed, else the seconds to wait. */
  take(): number {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.perMinute) / 60_000);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil(((1 - this.tokens) * 60) / this.perMinute);
  }
}

/** Default limits, per agent process (the agent serves one laptop). */
export const RATE_LIMITS = {
  /** reset, records and commit together. */
  write: { capacity: 60, perMinute: 120 },
  live: { capacity: 10, perMinute: 30 },
  policy: { capacity: 20, perMinute: 60 },
  /** Failed authentication attempts. */
  authFailure: { capacity: 10, perMinute: 10 },
} as const;

export interface HandlerOptions {
  writer: CloudWriter;
  port: number;
  allowedOrigins: string[];
  /** Pairing token the dashboard must send as `Authorization: Bearer`. */
  token: string;
  log: Logger;
  /** Details for an authenticated health check (never secrets). */
  health: () => Record<string, unknown>;
  now?: () => number;
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * The sync API on 127.0.0.1. Any web page, and any program on this computer, can try to reach a
 * local port, so:
 * - Host header must be 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding).
 * - A browser request must come from an allowed Origin (same origin, or loopback origins in
 *   FORCE_SYNC_ALLOWED_ORIGINS).
 * - Every endpoint except a minimal health check needs `Authorization: Bearer <FORCE_SYNC_TOKEN>`,
 *   compared in constant time. Failed attempts are rate limited.
 * - POST bodies must be application/json, at most 2 MB, and are fully validated before any write.
 * - Requests are rate limited per endpoint group (429 with Retry-After).
 * Returns false for paths that are not the API, so the caller can serve the dashboard.
 */
export function createSyncHandler(o: HandlerOptions) {
  const now = o.now ?? Date.now;
  const hosts = new Set([`127.0.0.1:${o.port}`, `localhost:${o.port}`]);
  const origins = new Set([
    `http://127.0.0.1:${o.port}`,
    `http://localhost:${o.port}`,
    ...o.allowedOrigins,
  ]);
  const tokenDigest = digest(o.token);
  const limits = {
    write: new RateLimiter(RATE_LIMITS.write.capacity, RATE_LIMITS.write.perMinute, now),
    live: new RateLimiter(RATE_LIMITS.live.capacity, RATE_LIMITS.live.perMinute, now),
    policy: new RateLimiter(RATE_LIMITS.policy.capacity, RATE_LIMITS.policy.perMinute, now),
    authFailure: new RateLimiter(
      RATE_LIMITS.authFailure.capacity,
      RATE_LIMITS.authFailure.perMinute,
      now,
    ),
  };

  const authorized = (req: IncomingMessage): boolean => {
    const h = req.headers.authorization;
    if (typeof h !== 'string' || !h.startsWith('Bearer ')) return false;
    return timingSafeEqual(digest(h.slice(7).trim()), tokenDigest);
  };

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '/';
    if (!url.startsWith('/api/sync/')) return false;

    const origin = req.headers.origin;
    const corsOk = origin !== undefined && origins.has(origin);
    const send = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) => {
      res
        .writeHead(status, {
          ...BASE_SECURITY_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(corsOk ? { 'Access-Control-Allow-Origin': origin!, Vary: 'Origin' } : {}),
          ...extra,
        })
        .end(JSON.stringify(body));
    };

    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
      send(403, { ok: false, error: 'Wrong Host header' });
      return true;
    }
    if (origin !== undefined && !corsOk) {
      o.log('warn', `Refused a request from origin ${origin.slice(0, 100)}`);
      send(403, { ok: false, error: 'Origin not allowed' });
      return true;
    }

    if (req.method === 'OPTIONS') {
      res
        .writeHead(204, {
          ...BASE_SECURITY_HEADERS,
          ...(corsOk ? { 'Access-Control-Allow-Origin': origin!, Vary: 'Origin' } : {}),
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '600',
        })
        .end();
      return true;
    }

    const path = url.split('?')[0]!;
    if (!path.startsWith(API_PREFIX)) {
      send(404, { ok: false, error: 'Unknown API version' });
      return true;
    }
    const action = path.slice(API_PREFIX.length);
    const isAuthed = authorized(req);

    if (action === 'health' && req.method === 'GET') {
      // without the token: only "the agent is running"; with it: details (never secrets)
      send(200, isAuthed ? { ok: true, ...o.health() } : { ok: true, service: 'force-cloud-agent' });
      return true;
    }

    const actions: Record<string, { group: 'write' | 'live' | 'policy'; run: (b: unknown) => Promise<number> }> = {
      policy: { group: 'policy', run: async () => 0 },
      reset: { group: 'write', run: (b) => o.writer.reset(parseReset(b)) },
      records: { group: 'write', run: (b) => o.writer.records(parseRecords(b, now())) },
      commit: { group: 'write', run: (b) => o.writer.commit(parseCommit(b, now())) },
      live: { group: 'live', run: (b) => o.writer.live(parseLive(b, now())) },
    };
    const endpoint = actions[action];
    if (!endpoint || req.method !== 'POST') {
      send(404, { ok: false, error: 'Unknown endpoint' });
      return true;
    }

    if (!isAuthed) {
      const wait = limits.authFailure.take();
      if (wait > 0) {
        send(429, { ok: false, error: 'Too many failed attempts' }, { 'Retry-After': String(wait) });
        return true;
      }
      o.log('warn', `Refused ${action}: missing or wrong sync token`);
      send(401, { ok: false, error: 'Not paired: missing or wrong sync token' }, {
        'WWW-Authenticate': 'Bearer',
      });
      return true;
    }

    const wait = limits[endpoint.group].take();
    if (wait > 0) {
      o.log('warn', `Rate limit: ${action} refused, retry in ${wait} s`);
      send(429, { ok: false, error: 'Too many requests' }, { 'Retry-After': String(wait) });
      return true;
    }

    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(415, { ok: false, error: 'Content-Type must be application/json' });
      return true;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      send(e instanceof BodyTooLarge ? 413 : 400, {
        ok: false,
        error: e instanceof Error ? e.message : 'Bad body',
      });
      return true;
    }

    try {
      const written = await endpoint.run(body);
      send(200, { ok: true, written, policy: o.writer.policy });
    } catch (e) {
      if (e instanceof ValidationError) {
        o.log('warn', `Rejected ${action}: ${e.message}`);
        send(400, { ok: false, error: e.message });
      } else if (e instanceof ConflictError) {
        send(409, { ok: false, error: e.message, conflict: true });
      } else {
        const c = classifyFirestoreError(e);
        o.log('error', `${action} failed: ${c.message}`);
        send(c.retryable ? 503 : 400, { ok: false, error: c.message });
      }
    }
    return true;
  };
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge('Request body is larger than 2 MB'));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
