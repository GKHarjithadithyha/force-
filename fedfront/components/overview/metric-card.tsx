import type { LucideIcon } from 'lucide-react';

export type BadgeTone = 'good' | 'info' | 'warn';

/**
 * KPI card. Layout is a vertical stack (icon and title, value, comparison, classification), so a
 * narrow card never squeezes text next to the icon. `badge` classifies the number: measured,
 * simulated, estimate, placeholder.
 */
export function MetricCard({ icon: Icon, label, value, comparison, badge, note, green }: { icon: LucideIcon; label: string; value: string; comparison?: string; badge?: { text: string; tone: BadgeTone }; note?: string; green?: boolean }) {
  return <div className={`kpi${green ? ' kpi-green' : ''}`}>
    <div className="kpi-top"><span className="kpi-icon"><Icon size={19} aria-hidden="true"/></span><span className="kpi-label">{label}</span></div>
    <div className="kpi-value" title={value}>{value}</div>
    {comparison && <div className="kpi-compare">{comparison}</div>}
    <div className="kpi-foot">{badge && <span className={`badge badge-${badge.tone}`}>{badge.text}</span>}{note && <span className="kpi-note">{note}</span>}</div>
  </div>;
}
