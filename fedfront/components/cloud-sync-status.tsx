'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Cloud } from 'lucide-react';
import type { SyncStatus } from '@force/cloud';
import { useDashboard } from '@/stores/dashboard';
import { clearSyncToken, readSyncToken, saveSyncToken } from '@/lib/sync-token';

const dash = '—';
const LABEL: Record<SyncStatus['state'], string> = {
  idle: 'Up to date',
  syncing: 'Syncing',
  offline: 'Agent unreachable, retrying',
  error: 'Needs attention',
  unpaired: 'Not paired',
  stopped: 'Stopped',
};

function time(ms: number | null): string {
  return ms === null ? dash : new Date(ms).toLocaleTimeString();
}

/**
 * Cloud sync visibility and pairing (Connection screen). Renders nothing when cloud sync is off,
 * so the dashboard looks exactly as before unless NEXT_PUBLIC_CLOUD_SYNC_URL is set.
 */
export function CloudSyncStatus() {
  const sync = useDashboard((s) => s.app?.sync ?? null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [paired, setPaired] = useState(false);
  const [token, setToken] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => (sync ? sync.subscribe(setStatus) : undefined), [sync]);
  useEffect(() => setPaired(readSyncToken() !== null), []);
  if (!sync || !status) return null;

  const pair = (e: FormEvent) => {
    e.preventDefault();
    if (!saveSyncToken(token)) {
      setNote('That is not a sync token. Copy the value after FORCE_SYNC_TOKEN= from .env.cloud.');
      return;
    }
    setToken('');
    setPaired(true);
    setNote('Paired. Checking with the sync agent…');
    void sync.retryNow();
  };
  const unpair = () => {
    clearSyncToken();
    setPaired(false);
    setNote('Token removed from this browser.');
    void sync.retryNow();
  };

  const tone =
    status.state === 'idle' ? 'state-good' : status.state === 'syncing' ? 'state-muted' : 'state-warn';
  const footsteps =
    status.policy === null ? dash : status.policy.footsteps ? 'Each footstep' : 'Per-minute counts only';
  return (
    <section className="panel utility-screen cloud-sync" aria-label="Cloud sync">
      <div className="utility-heading">
        <div>
          <h2>Cloud Sync</h2>
          <p>Finished real-device sessions are copied to Firestore through the local sync agent.</p>
        </div>
        <Cloud size={20} />
      </div>
      <div className="info-line"><span>Status</span><strong className={`state-pill ${tone}`}>{LABEL[status.state]}</strong></div>
      <div className="info-line"><span>Sessions synced</span><strong>{status.syncedSessions}</strong></div>
      <div className="info-line"><span>Sessions pending</span><strong>{status.pendingSessions}</strong></div>
      {status.parkedSessions > 0 && <div className="info-line"><span>Sessions refused</span><strong>{status.parkedSessions}</strong></div>}
      <div className="info-line"><span>Footsteps uploaded</span><strong>{footsteps}</strong></div>
      <div className="info-line"><span>Last upload</span><strong>{time(status.lastSuccessAt)}</strong></div>
      <div className="info-line"><span>Next retry</span><strong>{time(status.nextRetryAt)}</strong></div>
      <div className="info-line"><span>Live status sent</span><strong>{time(status.live.lastSentAt)}</strong></div>
      {status.lastError && <p className="inline-warning" role="status">{status.lastError}</p>}
      {!paired || status.state === 'unpaired' ? (
        <form className="settings-form" onSubmit={pair}>
          <label className="field-label">
            Sync token (from .env.cloud)
            <input
              className="text-field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label="Sync token"
            />
          </label>
          <button className="primary-action" type="submit" disabled={token.trim().length === 0}>Pair</button>
        </form>
      ) : (
        <button className="secondary-action" type="button" onClick={unpair}>Forget sync token</button>
      )}
      {note && <span className="field-hint" role="status">{note}</span>}
      <span className="field-hint">Recording never waits for the cloud: data stays on this computer and is sent when the agent is reachable.</span>
    </section>
  );
}
