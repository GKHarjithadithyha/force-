'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Footprints, Info, LayoutDashboard, Leaf, PanelTop, Settings, ShieldCheck, SlidersHorizontal, Sprout, Upload, Zap, Search } from 'lucide-react';
import { PowerOutputChart, EnergyChart, TrafficChart } from '@/components/charts';
import { ConnectionBanner } from '@/components/overview/connection-banner';
import { DashboardHeader } from '@/components/overview/dashboard-header';
import { DeviceHealth } from '@/components/overview/device-health';
import { MetricCard } from '@/components/overview/metric-card';
import { RealTimePowerCard } from '@/components/overview/real-time-power-card';
import { Sidebar } from '@/components/overview/sidebar';
import { createAppEngine } from '@/engine';
import { getHistory, getTodayVsYesterday } from '@/lib/analytics';
import type { DayTotals } from '@/lib/analytics';
import { formatCo2, formatEnergy, formatPower, formatQuality, formatRecorded } from '@/lib/format';
import { hasData, readingsUsable, sourceBanner } from '@/lib/live';
import { loadBrandExpansion } from '@/lib/preferences';
import { useShallow } from 'zustand/react/shallow';
import { useDashboard } from '@/stores/dashboard';
import type { HistoryPoint, Range } from '@/contracts';
import { OtherScreen } from '@/components/other-screen';

const items = [
  { name: 'Overview', icon: LayoutDashboard }, { name: 'Live', icon: Search }, { name: 'Sessions', icon: PanelTop }, { name: 'Connection', icon: ShieldCheck }, { name: 'Export Data', icon: Upload }, { name: 'Calibration', icon: SlidersHorizontal }, { name: 'Settings', icon: Settings },
];
/** Simulated faults the mock engine can inject (mock mode only, for testing every UI state). */
const FAULTS = ['drop', 'stale', 'duplicate', 'reorder', 'restart', 'clip', 'sensor_fault', 'malformed', 'bad_voltage'] as const;
const TOTALS_REFRESH_MS = 5000;
const POWER_WINDOWS = [{ value: '30 seconds', label: '30 s' }, { value: '5 minutes', label: '5 min' }, { value: '1 hour', label: '1 h' }];

export function Dashboard() {
  // explicit selection: the live chart buffers are NOT selected, so chart data never re-renders the shell
  const { snapshot, engine, app, profile, setApp, setSnapshot, setProfile, pushChart, pushStep, pushGap, clearLive, page, setPage, range, setRange, brandExpansion, setBrandExpansion } = useDashboard(useShallow((s) => ({ snapshot: s.snapshot, engine: s.engine, app: s.app, profile: s.profile, setApp: s.setApp, setSnapshot: s.setSnapshot, setProfile: s.setProfile, pushChart: s.pushChart, pushStep: s.pushStep, pushGap: s.pushGap, clearLive: s.clearLive, page: s.page, setPage: s.setPage, range: s.range, setRange: s.setRange, brandExpansion: s.brandExpansion, setBrandExpansion: s.setBrandExpansion })));
  const [now, setNow] = useState(new Date()); const [kiosk, setKiosk] = useState(false); const [navOpen, setNavOpen] = useState(false);
  const [powerWindow, setPowerWindow] = useState('5 minutes');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [days, setDays] = useState<DayTotals | null>(null);
  const [fault, setFault] = useState('');
  const [totalsError, setTotalsError] = useState<string | null>(null);
  const lastSession = useRef<string | null>(null);
  useEffect(() => { const interval = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const created = createAppEngine(); setApp(created); setBrandExpansion(loadBrandExpansion());
    const e = created.engine;
    const unsubSnapshot = e.subscribeSnapshot((s) => {
      // a new session starts a new live chart; the previous one stays in storage
      if (s.sessionId !== null && s.sessionId !== lastSession.current) { lastSession.current = s.sessionId; clearLive(); }
      setSnapshot(s);
    });
    const unsubChart = e.subscribeChart(pushChart);
    const unsubSteps = e.subscribeSteps(pushStep); const unsubGaps = e.subscribeGaps(pushGap);
    void e.getProfile().then(setProfile).catch(() => undefined);
    return () => { unsubSnapshot(); unsubChart(); unsubSteps(); unsubGaps(); created.dispose(); setApp(null); };
  }, [setApp, setSnapshot, setProfile, pushChart, pushStep, pushGap, clearLive, setBrandExpansion]);
  useEffect(() => {
    if (!engine || !profile) return;
    let alive = true;
    const fail = (e: unknown) => { if (alive) setTotalsError(e instanceof Error ? e.message : String(e)); };
    const load = () => {
      void getHistory(engine, range.toLowerCase() as Range).then((h) => { if (alive) { setHistory(h); setTotalsError(null); } }).catch(fail);
      void getTodayVsYesterday(engine, profile).then((d) => { if (alive) setDays(d); }).catch(fail);
    };
    load(); const timer = setInterval(load, TOTALS_REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [engine, range, profile]);
  const connection = snapshot?.connection ?? 'idle'; const metrics = snapshot?.metrics;
  const live = hasData(snapshot); const usable = readingsUsable(snapshot, connection);
  // Device (or nothing running): today's stored device totals. Demo/replay: that session only, clearly labelled.
  const simulated = live && snapshot.source !== 'device';
  const periodLabel = simulated ? (snapshot.source === 'demo' ? 'Demo session' : 'Replay session') : 'Today';
  const energyWh = simulated ? metrics?.sessionEnergyWh : days?.today.energyWh;
  const stepsValue = simulated ? metrics?.steps : days?.today.steps;
  const co2Kg = simulated ? metrics?.co2AvoidedKg : days?.co2TodayKg;
  const energy = formatEnergy(energyWh); const power = formatPower(usable ? metrics?.powerW : null); const co2 = formatCo2(co2Kg);
  const quality = live ? formatQuality(snapshot.quality.recordedMs, snapshot.quality.excludedGapMs) : days ? `${formatRecorded(days.today.recordedMs)} (stored)` : 'Recorded — · Gaps —';
  const showYesterday = !simulated && days !== null;
  const stale = connection === 'stale';
  const tabs = useMemo(() => ['Today', 'Week', 'Month'], []);
  const activeNav = (name: string) => { setPage(name === 'Export Data' ? 'Sessions' : name); setNavOpen(false); };
  const banner = sourceBanner(snapshot);
  const glowing = usable && (metrics?.powerW ?? 0) > (profile?.idleThresholdW ?? 0);
  const stepsText = stale ? 'No data' : stepsValue?.toLocaleString() ?? '—';
  const title = page === 'Overview' ? 'Intelligent Dashboard' : page;
  const subtitle = page === 'Overview' ? 'Real-time monitoring of energy generation and system performance' : page === 'Live' ? 'Real-time power, voltage and footstep activity' : 'Florix Energy device and session management';
  return <div className={`app-shell${kiosk ? ' kiosk' : ''}${stale ? ' stale' : ''}${navOpen ? ' nav-open' : ''}`}>
    <Sidebar items={items} page={page} brandExpansion={brandExpansion} onNavigate={activeNav}/>
    <button type="button" className="nav-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setNavOpen(false)}/>
    <main className="main-area">
      <DashboardHeader title={title} subtitle={subtitle} now={now} connection={connection} menuOpen={navOpen} onOpenMenu={() => setNavOpen(true)} onToggleKiosk={() => setKiosk(!kiosk)}/>
      <div className="banners">
        {app?.mode === 'mock' && <ConnectionBanner>Mock engine · Simulated hardware (NEXT_PUBLIC_ENGINE=mock). Stored separately from real device data.</ConnectionBanner>}
        {banner && app?.mode !== 'mock' && <ConnectionBanner>{banner}</ConnectionBanner>}
        {!live && app?.mode === 'device' && <ConnectionBanner>Not connected · Open Connection to pair the FORCE sensor over Bluetooth, or start the demo.</ConnectionBanner>}
        {totalsError && <ConnectionBanner tone="warn" alert>Stored totals are unavailable ({totalsError}). Live readings are not affected.</ConnectionBanner>}
        {snapshot?.alerts.map((alert) => <ConnectionBanner key={alert.id} tone={alert.severity === 'error' ? 'bad' : alert.severity === 'warning' ? 'warn' : 'info'} alert={alert.severity === 'error'}>{alert.message}</ConnectionBanner>)}
      </div>
      {page === 'Overview' ? <div className="ov">
        <div className="ov-top">
          <section className="panel card ov-power" aria-label="Power output">
            <div className="card-head"><div><h2 className="panel-title">Power Output <span className="subdued">(Real-time)</span></h2><p className="panel-subtitle">Measured power over time, in watts</p></div>
              <div className="head-actions">{connection === 'streaming' && <span className="live-badge"><i className="connection-dot"/>Live</span>}<RangeTabs label="Power chart time window" options={POWER_WINDOWS} value={powerWindow} onChange={setPowerWindow}/></div></div>
            <div className="chart-wrap"><PowerOutputChart timeWindow={powerWindow}/></div>
          </section>
          <section className="panel card kpi-panel" aria-label="Key metrics">
            <div className="card-head"><h2 className="panel-title">Key Metrics <span className="subdued">({periodLabel})</span></h2><Info size={18} color="var(--text-muted)" role="img" aria-label={simulated ? 'Values for the running simulated session only.' : 'Stored real-device totals since local midnight.'}/></div>
            <div className="kpi-grid">
              <MetricCard icon={Zap} label="Total Energy Generated" value={`${energy.value} ${energy.unit}`.trim()} comparison={showYesterday ? `Yesterday ${formatEnergy(days.yesterday.energyWh).value} ${formatEnergy(days.yesterday.energyWh).unit}`.trim() : undefined} badge={simulated ? { text: 'Simulated', tone: 'info' } : { text: 'Measured', tone: 'good' }} note={quality}/>
              <MetricCard icon={Footprints} label="Total Footsteps" value={stepsValue?.toLocaleString() ?? '—'} comparison={showYesterday ? `Yesterday ${days.yesterday.steps.toLocaleString()} steps` : undefined} badge={simulated ? { text: 'Simulated', tone: 'info' } : { text: 'Detected', tone: 'good' }} note={quality}/>
              <MetricCard icon={Leaf} label="CO₂ Offset (Estimated)" value={`${co2.value} ${co2.unit}`.trim()} comparison={showYesterday ? `Yesterday ${formatCo2(days.co2YesterdayKg).value} ${formatCo2(days.co2YesterdayKg).unit}`.trim() : undefined} badge={{ text: 'Estimate', tone: 'warn' }} note="Placeholder emission factor"/>
              <MetricCard icon={Sprout} label="Sustainability Score" value={!live || metrics?.sustainabilityScore == null ? '—' : `${metrics.sustainabilityScore}`} badge={{ text: 'Placeholder', tone: 'warn' }} note="Formula not agreed" green/>
            </div>
          </section>
        </div>
        <div className="ov-bottom">
          <RealTimePowerCard snapshot={snapshot} connection={connection} power={power} steps={stepsText} stepsLabel={simulated ? 'Steps (session)' : 'Steps today'} usable={usable} glowing={glowing}/>
          <ChartCard title="Energy Generated" range={range} tabs={tabs} onRange={setRange}><EnergyChart history={history} range={range}/></ChartCard>
          <ChartCard title="Foot Traffic" range={range} tabs={tabs} onRange={setRange}><TrafficChart history={history} range={range}/></ChartCard>
          <DeviceHealth snapshot={snapshot} connection={connection}/>
        </div>
      </div> : <OtherScreen name={page} engine={engine} connection={connection} snapshot={snapshot} />}
    </main>
    {app?.injectFault && <div className="dev-panel"><strong>MOCK</strong><label htmlFor="inject-fault">Inject fault</label><select id="inject-fault" value={fault} onChange={(e) => { const kind = e.target.value; setFault(''); if (kind) { try { app.injectFault?.({ kind, durationMs: kind === 'stale' ? 8000 : 3000 } as Parameters<NonNullable<typeof app.injectFault>>[0], 0); } catch { /* not streaming */ } } }}><option value="">Choose…</option>{FAULTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>}
  </div>;
}

function RangeTabs({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return <div className="range-tabs" role="tablist" aria-label={label}>{options.map((o) => <button key={o.value} type="button" className={`range-tab${value === o.value ? ' selected' : ''}`} onClick={() => onChange(o.value)} role="tab" aria-selected={value === o.value} aria-label={o.value}>{o.label}</button>)}</div>;
}
function ChartCard({ title, children, range, tabs, onRange }: { title: string; children: React.ReactNode; range: string; tabs: string[]; onRange: (range: string) => void }) {
  return <section className="panel card chart-card" aria-label={title}><div className="card-head"><h2 className="panel-title">{title}</h2><RangeTabs label={`${title} range`} options={tabs.map((t) => ({ value: t, label: t }))} value={range} onChange={onRange}/></div><div className="chart-wrap">{children}</div></section>;
}
