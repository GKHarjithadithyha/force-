/**
 * Pairing token for the local sync agent (FORCE_SYNC_TOKEN in .env.cloud). Pasted once by the
 * user and kept in this browser profile only. It authorises uploads through the agent on this
 * computer; it is not a Firebase credential and is never sent anywhere else.
 */
const KEY = 'force.syncToken';
const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;

export function readSyncToken(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && TOKEN_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Saves a token; returns false if it does not look like one. */
export function saveSyncToken(value: string): boolean {
  const v = value.trim().replace(/^FORCE_SYNC_TOKEN=/, '');
  if (!TOKEN_RE.test(v)) return false;
  try {
    localStorage.setItem(KEY, v);
    return true;
  } catch {
    return false;
  }
}

export function clearSyncToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
