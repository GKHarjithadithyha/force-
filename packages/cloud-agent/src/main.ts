import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminDocStore, classifyFirestoreError } from './admin.js';
import { ConfigError, describeConfig, loadConfig } from './config.js';
import { createSyncHandler } from './http.js';
import { consoleLogger as log } from './log.js';
import { BASE_SECURITY_HEADERS, createStaticHandler } from './static.js';
import { CloudWriter } from './writer.js';

/**
 * Local sync agent. Usage (from the repository root):
 *   npm run cloud:agent            serve the dashboard + sync API on http://127.0.0.1:8787
 *   npm run cloud:check            check the configuration and the Firestore connection, then exit
 *
 * Settings come from the environment, loaded from `.env.cloud` at the repository root when that
 * file exists (FORCE_CLOUD_ENV_FILE overrides the path).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<number> {
  const envFile = process.env.FORCE_CLOUD_ENV_FILE ?? resolve(REPO_ROOT, '.env.cloud');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
    log('info', `Loaded settings from ${envFile}`);
  } else {
    log('warn', `No ${envFile}; using the process environment only`);
  }

  let cfg;
  try {
    cfg = loadConfig(process.env, REPO_ROOT, { envFile });
  } catch (e) {
    if (e instanceof ConfigError) {
      log('error', `Configuration: ${e.message}`);
      return 2;
    }
    throw e;
  }
  for (const line of describeConfig(cfg)) log('info', line);
  for (const w of cfg.warnings) log('warn', w);

  const store = AdminDocStore.create(cfg);
  let firestoreState: 'ok' | 'error' | 'unknown' = 'unknown';
  let firestoreError: string | null = null;
  try {
    await store.ping();
    firestoreState = 'ok';
    log('info', 'Firestore connection OK');
  } catch (e) {
    firestoreState = 'error';
    firestoreError = classifyFirestoreError(e).message;
    log('error', `Firestore check failed: ${firestoreError}`);
  }

  if (process.argv.includes('--check')) {
    await store.close();
    return firestoreState === 'ok' ? 0 : 1;
  }

  const writer = new CloudWriter(store, {
    site: cfg.site,
    footsteps: cfg.footsteps,
    liveIntervalMs: cfg.liveIntervalMs,
    log,
  });
  const startedAt = Date.now();
  const api = createSyncHandler({
    writer,
    port: cfg.port,
    allowedOrigins: cfg.allowedOrigins,
    token: cfg.token,
    log,
    health: () => ({
      projectId: cfg.projectId,
      emulator: cfg.emulatorHost !== null,
      firestore: writer.stats.lastError
        ? 'error'
        : writer.stats.lastWriteAt
          ? 'ok'
          : firestoreState,
      lastError: writer.stats.lastError ?? firestoreError,
      writes: writer.stats.writes,
      failures: writer.stats.failures,
      skippedFootsteps: writer.stats.skippedFootsteps,
      policy: writer.policy,
      lastWriteAt: writer.stats.lastWriteAt,
      upSince: startedAt,
    }),
  });
  const serveStatic = cfg.staticDir ? createStaticHandler(cfg.staticDir) : null;

  const server = createServer((req, res) => {
    api(req, res)
      .then(async (handled) => {
        if (handled) return;
        if (serveStatic) await serveStatic(req, res);
        else
          res
            .writeHead(404, { ...BASE_SECURITY_HEADERS, 'Content-Type': 'text/plain' })
            .end('Dashboard not served here');
      })
      .catch((e) => {
        log('error', `Request failed: ${e instanceof Error ? e.message : String(e)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(cfg.port, cfg.host, () => ok());
  });
  log('info', `Ready: http://${cfg.host}:${cfg.port}/  (sync API under /api/sync/v1/)`);

  return new Promise<number>((done) => {
    let closing = false;
    const shutdown = (signal: string) => {
      if (closing) return;
      closing = true;
      log(
        'info',
        `${signal}: finishing ${writer.stats.inFlight} write(s) in flight, then stopping`,
      );
      server.close();
      const force = setTimeout(() => {
        log('warn', 'Writes did not finish in 15 s; stopping anyway (the dashboard resends them)');
        done(1);
      }, 15_000);
      writer
        .idle()
        .then(() => store.close())
        .then(() => {
          clearTimeout(force);
          log('info', 'Stopped cleanly');
          done(0);
        })
        .catch(() => done(1));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    log('error', `Fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
