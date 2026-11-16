import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Agent configuration, from environment variables (normally the git-ignored `.env.cloud` file
 * at the repository root; see `.env.cloud.example` and FIREBASE_SETUP.md).
 *
 * Secrets: the service-account JSON FILE and FORCE_SYNC_TOKEN. The key file is read once to
 * check that it is a service account of the configured project; neither is ever logged.
 */

export class ConfigError extends Error {}

export interface AgentConfig {
  projectId: string;
  databaseId: string;
  /** Absolute path of the service-account JSON; null when the emulator is used. */
  credentialsPath: string | null;
  emulatorHost: string | null;
  host: '127.0.0.1';
  port: number;
  /** Folder with the built dashboard (fedfront/out); null serves the API only. */
  staticDir: string | null;
  /** Extra loopback browser origins allowed to call the API (same origin is always allowed). */
  allowedOrigins: string[];
  /** Kept private: written only to the deviceConfigs collection. */
  site: { id: string; name: string } | null;
  /** Shared secret the dashboard must send (pairing). Never logged. */
  token: string;
  /** Individual footstep documents (off by default; per-minute step counts are always sent). */
  footsteps: boolean;
  /** Minimum interval between live-status updates per device, ms. */
  liveIntervalMs: number;
  warnings: string[];
}

export type Env = Record<string, string | undefined>;

const PROJECT_RE = /^[a-z][a-z0-9-]{4,38}[a-z0-9]$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;

function opt(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

/** True if `child` is `parent` or inside it. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function loadConfig(
  env: Env,
  repoRoot: string,
  opts: { envFile?: string | null } = {},
): AgentConfig {
  const warnings: string[] = [];
  for (const forbidden of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON']) {
    if (opt(env, forbidden)) {
      throw new ConfigError(
        `${forbidden} is set. Do not put key material in environment variables: save the ` +
          'service-account JSON file outside the repository and set GOOGLE_APPLICATION_CREDENTIALS to its path.',
      );
    }
  }

  const projectId = opt(env, 'FIREBASE_PROJECT_ID');
  if (!projectId) {
    throw new ConfigError(
      'FIREBASE_PROJECT_ID is missing. Copy .env.cloud.example to .env.cloud and fill it in (FIREBASE_SETUP.md, step 5).',
    );
  }
  if (!PROJECT_RE.test(projectId)) {
    throw new ConfigError(`FIREBASE_PROJECT_ID "${projectId}" is not a valid Firebase project id`);
  }

  const token = opt(env, 'FORCE_SYNC_TOKEN');
  if (!token) {
    throw new ConfigError(
      'FORCE_SYNC_TOKEN is missing. Run "npm run cloud:token", put the printed line in .env.cloud, and paste the token into the dashboard (Connection > Cloud Sync) once.',
    );
  }
  if (!TOKEN_RE.test(token)) {
    throw new ConfigError(
      'FORCE_SYNC_TOKEN must be at least 32 characters of letters, digits, "-" or "_" (use "npm run cloud:token")',
    );
  }

  const emulatorHost = opt(env, 'FIRESTORE_EMULATOR_HOST');
  let credentialsPath: string | null = null;
  if (!emulatorHost) {
    const raw = opt(env, 'GOOGLE_APPLICATION_CREDENTIALS');
    if (!raw) {
      throw new ConfigError(
        'GOOGLE_APPLICATION_CREDENTIALS is missing: set it to the full path of the service-account JSON file (FIREBASE_SETUP.md, step 4).',
      );
    }
    credentialsPath = isAbsolute(raw) ? raw : resolve(repoRoot, raw);
    checkCredentialsFile(credentialsPath, projectId);
    if (within(repoRoot, credentialsPath)) {
      warnings.push(
        'The service-account file is inside the repository folder. It is git-ignored only under secrets/ or when named *service-account*.json; prefer a folder outside the repository.',
      );
    }
  }

  const portRaw = opt(env, 'FORCE_SYNC_PORT') ?? '8787';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError(`FORCE_SYNC_PORT "${portRaw}" must be a whole number from 1024 to 65535`);
  }

  const staticRaw = opt(env, 'FORCE_SYNC_STATIC_DIR');
  let staticDir: string | null =
    staticRaw === 'off' ? null : resolve(repoRoot, staticRaw ?? 'fedfront/out');
  if (staticDir && !isDir(staticDir)) {
    warnings.push(
      `Dashboard build not found at ${staticDir}: serving the sync API only. Run "npm run web:build" first to serve the dashboard here.`,
    );
    staticDir = null;
  }
  if (staticDir) {
    const dir = real(staticDir);
    const secrets = [
      credentialsPath,
      opts.envFile ?? null,
      resolve(repoRoot, '.env.cloud'),
      resolve(repoRoot, 'secrets'),
    ].filter((p): p is string => p !== null);
    for (const s of secrets) {
      if (within(dir, real(s))) {
        throw new ConfigError(
          `FORCE_SYNC_STATIC_DIR (${staticDir}) contains a secret file or folder; point it at the dashboard build (fedfront/out) only`,
        );
      }
    }
    if (within(dir, real(repoRoot))) {
      throw new ConfigError(
        `FORCE_SYNC_STATIC_DIR (${staticDir}) contains the whole repository; point it at fedfront/out`,
      );
    }
  }

  const allowedOrigins = (opt(env, 'FORCE_SYNC_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new ConfigError(
          `FORCE_SYNC_ALLOWED_ORIGINS: "${o}" is not an origin like http://localhost:3000`,
        );
      }
      if (u.origin !== o.replace(/\/+$/, '')) {
        throw new ConfigError(`FORCE_SYNC_ALLOWED_ORIGINS: "${o}" must be an origin only (no path)`);
      }
      if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) {
        throw new ConfigError(
          `FORCE_SYNC_ALLOWED_ORIGINS: "${o}" is not on this computer; only http://localhost:<port> or http://127.0.0.1:<port> are allowed`,
        );
      }
      return u.origin;
    });

  const siteId = opt(env, 'FORCE_SITE_ID');
  const siteName = opt(env, 'FORCE_SITE_NAME');
  if ((siteId === null) !== (siteName === null)) {
    throw new ConfigError('Set both FORCE_SITE_ID and FORCE_SITE_NAME, or neither');
  }
  if (siteId && !/^[A-Za-z0-9._-]{1,64}$/.test(siteId)) {
    throw new ConfigError('FORCE_SITE_ID may use letters, digits, ".", "_" and "-" only');
  }

  const footRaw = (opt(env, 'FORCE_SYNC_FOOTSTEPS') ?? 'off').toLowerCase();
  if (footRaw !== 'on' && footRaw !== 'off') {
    throw new ConfigError('FORCE_SYNC_FOOTSTEPS must be "on" or "off" (default off)');
  }

  const liveRaw = opt(env, 'FORCE_SYNC_LIVE_INTERVAL_S') ?? '30';
  const liveS = Number(liveRaw);
  if (!Number.isInteger(liveS) || liveS < 10 || liveS > 600) {
    throw new ConfigError('FORCE_SYNC_LIVE_INTERVAL_S must be a whole number from 10 to 600 (default 30)');
  }

  return {
    projectId,
    databaseId: opt(env, 'FIRESTORE_DATABASE_ID') ?? '(default)',
    credentialsPath,
    emulatorHost,
    host: '127.0.0.1',
    port,
    staticDir,
    allowedOrigins,
    site: siteId && siteName ? { id: siteId, name: siteName.slice(0, 120) } : null,
    token,
    footsteps: footRaw === 'on',
    liveIntervalMs: liveS * 1000,
    warnings,
  };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function checkCredentialsFile(path: string, projectId: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(
      `Cannot read the service-account file at GOOGLE_APPLICATION_CREDENTIALS (${path})`,
    );
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConfigError('The service-account file is not valid JSON');
  }
  if (json.type !== 'service_account' || typeof json.client_email !== 'string') {
    throw new ConfigError(
      'The credentials file is not a service-account key (type must be "service_account")',
    );
  }
  if (json.project_id !== projectId) {
    throw new ConfigError(
      `The service-account file belongs to project "${String(json.project_id)}", not FIREBASE_PROJECT_ID "${projectId}"`,
    );
  }
}

/** A summary that is safe to print: no key material, no file contents, no token. */
export function describeConfig(c: AgentConfig): string[] {
  return [
    `project ${c.projectId}, database ${c.databaseId}`,
    c.emulatorHost
      ? `Firestore EMULATOR at ${c.emulatorHost}`
      : 'Firestore (production) with a service-account file',
    `listening on http://${c.host}:${c.port} (this computer only)`,
    c.staticDir ? `serving the dashboard from ${c.staticDir}` : 'dashboard not served (API only)',
    `extra allowed origins: ${c.allowedOrigins.length ? c.allowedOrigins.join(', ') : 'none'}`,
    `site: ${c.site ? `${c.site.id} (private)` : 'not set'}`,
    `individual footsteps: ${c.footsteps ? 'ON' : 'off (per-minute step counts only)'}`,
    `live status at most every ${c.liveIntervalMs / 1000} s per device`,
    'pairing token: set',
  ];
}
