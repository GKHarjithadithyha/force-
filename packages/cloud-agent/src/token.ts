import { randomBytes } from 'node:crypto';

/**
 * Prints a new random pairing token (256 bits). This is a LOCAL secret between the dashboard and
 * the sync agent, not a Firebase credential.
 *
 *   npm run cloud:token
 *
 * Put the printed line in .env.cloud, restart the agent, then paste the token once into the
 * dashboard (Connection > Cloud Sync > Pair). Running it again creates a different token.
 */
const token = randomBytes(32).toString('base64url');
process.stdout.write(`FORCE_SYNC_TOKEN=${token}\n`);
