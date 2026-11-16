'use client';

import { format } from 'date-fns';
import { Maximize2, Menu } from 'lucide-react';
import type { ConnectionState } from '@/contracts';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { connectionTone } from '@/lib/live';
import type { Tone } from '@/lib/live';

const descriptors: Record<ConnectionState, string> = { unsupported: 'Unsupported', idle: 'Idle', choosing: 'Choosing device', connecting: 'Connecting', streaming: 'Streaming', stale: 'Stale', reconnecting: 'Reconnecting', error: 'Error' };
const toneColor: Record<Tone, string> = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--text-muted)' };

/** Title, subtitle, clock, connection status and the fullscreen (kiosk) toggle. */
export function DashboardHeader({ title, subtitle, now, connection, onToggleKiosk, onOpenMenu, menuOpen, statusLabel }: { title: string; subtitle: string; now: Date; connection: ConnectionState; onToggleKiosk: () => void; onOpenMenu: () => void; menuOpen: boolean; statusLabel?: string }) {
  return <header className="topbar">
    <button type="button" className="icon-btn menu-btn" aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded={menuOpen} onClick={onOpenMenu}><Menu size={20}/></button>
    <div className="topbar-title"><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>
    <div className="topbar-right">
      <div className="clock"><div className="clock-date" suppressHydrationWarning>{format(now, 'EEE, d MMM yyyy')}</div><div className="clock-time" suppressHydrationWarning>{format(now, 'hh:mm:ss a')}</div></div>
      <div className="connection-pill" style={{ color: toneColor[connectionTone(connection)] }} role="status"><span className="connection-dot"/>{statusLabel ?? descriptors[connection]}</div>
      <ThemeToggle/>
      <button type="button" className="icon-btn" title="Toggle kiosk mode" aria-label="Toggle kiosk mode" onClick={onToggleKiosk}><Maximize2 size={18}/></button>
    </div>
  </header>;
}
