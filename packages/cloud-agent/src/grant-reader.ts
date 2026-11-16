import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ConfigError, loadConfig } from './config.js';
import { consoleLogger as log } from './log.js';

/**
 * Grants or revokes read access to the detailed history (sessions, footsteps, energy minutes,
 * data gaps). Firestore rules require the custom claim `forceReader: true`, so simply creating an
 * account is not enough to read history.
 *
 *   npm run cloud:grant-reader -- someone@example.com
 *   npm run cloud:grant-reader -- someone@example.com --revoke
 *
 * The user must already exist in Firebase Authentication. They must sign in again (or refresh
 * their ID token) before the change takes effect.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'));
  const revoke = args.includes('--revoke');
  if (!email || !email.includes('@')) {
    log('error', 'Usage: npm run cloud:grant-reader -- <email> [--revoke]');
    return 2;
  }
  const envFile = process.env.FORCE_CLOUD_ENV_FILE ?? resolve(REPO_ROOT, '.env.cloud');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
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
  if (cfg.emulatorHost && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    log(
      'error',
      'Using the Firestore emulator: set FIREBASE_AUTH_EMULATOR_HOST to grant readers there',
    );
    return 2;
  }
  const app = cfg.credentialsPath
    ? initializeApp(
        { projectId: cfg.projectId, credential: cert(cfg.credentialsPath) },
        'grant-reader',
      )
    : initializeApp({ projectId: cfg.projectId }, 'grant-reader');
  try {
    const auth = getAuth(app);
    const user = await auth.getUserByEmail(email);
    const claims = { ...(user.customClaims ?? {}) };
    if (revoke) delete claims.forceReader;
    else claims.forceReader = true;
    await auth.setCustomUserClaims(user.uid, claims);
    log(
      'info',
      `${revoke ? 'Revoked' : 'Granted'} history read access for ${email} (uid ${user.uid})`,
    );
    return 0;
  } catch (e) {
    log('error', e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await deleteApp(app);
  }
}

main().then((c) => process.exit(c));
