import type { ReactNode } from 'react';
import { CircleAlert, Info, PlugZap } from 'lucide-react';

export type BannerTone = 'info' | 'warn' | 'bad';
const icons = { info: PlugZap, warn: Info, bad: CircleAlert } as const;

/** One compact status line under the header. The message text is passed in unchanged. */
export function ConnectionBanner({ tone = 'info', alert = false, children }: { tone?: BannerTone; alert?: boolean; children: ReactNode }) {
  const Icon = icons[tone];
  return <div className={`banner banner-${tone}`} role={alert ? 'alert' : undefined}><Icon size={16} aria-hidden="true"/><span>{children}</span></div>;
}
