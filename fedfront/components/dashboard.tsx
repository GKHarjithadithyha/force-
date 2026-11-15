'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Activity, Cpu, Footprints, Info, Layers3, LayoutDashboard, Leaf, PanelTop, PlugZap, Settings, ShieldCheck, SlidersHorizontal, Sprout, Upload, Wifi, Zap, Search, Maximize2 } from 'lucide-react';
import { PowerChart, EnergyChart, TrafficChart } from '@/components/charts';
import { HexHeatmap } from '@/components/hex-heatmap';
import { createAppEngine } from '@/engine';
import { getHistory, getTodayVsYesterday } from '@/lib/analytics';
import type { DayTotals } from '@/lib/analytics';
import { formatCo2, formatEnergy, formatPower, formatQuality, formatRecorded } from '@/lib/format';
import { connectionTone, hasData, inputStatus, readingsUsable, sensorStatus, sourceBanner, tileState } from '@/lib/live';
import type { StatusView, Tone } from '@/lib/live';
import { loadBrandExpansion } from '@/lib/preferences';
import { useShallow } from 'zustand/react/shallow';
import { useDashboard } from '@/stores/dashboard';
import type { ConnectionState, HistoryPoint, Range } from '@/contracts';
import { OtherScreen } from '@/components/other-screen';

const items = [
  { name: 'Overview', icon: LayoutDashboard }, { name: 'Live', icon: Search }, { name: 'Sessions', icon: PanelTop }, { name: 'Connection', icon: ShieldCheck }, { name: 'Export Data', icon: Upload }, { name: 'Calibration', icon: SlidersHorizontal }, { name: 'Settings', icon: Settings },
];
const descriptors: Record<ConnectionState, string> = { unsupported:'Unsupported',idle:'Idle',choosing:'Choosing device',connecting:'Connecting',streaming:'Streaming',stale:'Stale',reconnecting:'Reconnecting',error:'Error' };
const toneColor: Record<Tone, string> = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--text-muted)' };
/** Simulated faults the mock engine can inject (mock mode only, for testing every UI state). */
const FAULTS = ['drop', 'stale', 'duplicate', 'reorder', 'restart', 'clip', 'sensor_fault', 'malformed', 'bad_voltage'] as const;
const TOTALS_REFRESH_MS = 5000;

export function Dashboard() {
  // explicit selection: the live chart buffers are NOT selected, so chart data never re-renders the shell
  const { snapshot, engine, app, profile, setApp, setSnapshot, setProfile, pushChart, pushStep, pushGap, clearLive, page, setPage, range, setRange, brandExpansion, setBrandExpansion } = useDashboard(useShallow((s) => ({ snapshot: s.snapshot, engine: s.engine, app: s.app, profile: s.profile, setApp: s.setApp, setSnapshot: s.setSnapshot, setProfile: s.setProfile, pushChart: s.pushChart, pushStep: s.pushStep, pushGap: s.pushGap, clearLive: s.clearLive, page: s.page, setPage: s.setPage, range: s.range, setRange: s.setRange, brandExpansion: s.brandExpansion, setBrandExpansion: s.setBrandExpansion })));
  const [now, setNow] = useState(new Date()); const [multiTile] = useState(false); const [kiosk, setKiosk] = useState(false);
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
  const tabs = useMemo(() => ['Today','Week','Month'], []);
  const activeNav = (name: string) => { setPage(name === 'Export Data' ? 'Sessions' : name); };
  const banner = sourceBanner(snapshot);
  const sensor = sensorStatus(snapshot); const input = inputStatus(snapshot);
  const glowing = usable && (metrics?.powerW ?? 0) > (profile?.idleThresholdW ?? 0);
  return <div className={`app-shell${kiosk ? ' kiosk' : ''}${stale ? ' stale' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-name">F.O.R.C.E.</div><div className="brand-expansion">{brandExpansion}</div></div>
      <nav className="nav-list" aria-label="Main navigation">{items.map(({ name, icon: Icon }) => <button key={name} onClick={() => activeNav(name)} className={`nav-item${page === name || (name === 'Export Data' && page === 'Sessions') ? ' active' : ''}`} aria-current={page === name ? 'page' : undefined} title={name}><Icon aria-hidden="true"/><span className="nav-label">{name}</span></button>)}</nav>
      <svg className="hex-art" viewBox="0 0 230 340" aria-hidden="true"><g fill="none" stroke="#6147bc" strokeWidth="1.5"><path d="M97 6 148 35v59l-51 29-51-29V35Z"/><path d="m97 123 51 29v59l-51 29-51-29v-59Z"/><path d="m97 241 51 29v59l-51 29-51-29v-59Z"/><path d="m-4 65 51 29v59l-51 29-51-29V94Z"/></g></svg>
      <div className="side-footer"><div className="footer-mark">FLORIX ENERGY</div><div className="footer-tagline">Empower The World</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><h1 className="page-title">{page === 'Overview' ? 'Intelligent Dashboard' : page}</h1><p className="page-subtitle">{page === 'Overview' ? 'Real-time monitoring of energy generation and system performance' : page === 'Live' ? 'Real-time power, voltage and footstep activity' : 'Florix Energy device and session management'}</p></div>
        <div className="topbar-right"><div className="clock"><div className="clock-date" suppressHydrationWarning>{format(now,'EEE, d MMM yyyy')}</div><div className="clock-time" suppressHydrationWarning>{format(now,'hh:mm:ss a')}</div></div><div className="connection-pill" style={{ color: toneColor[connectionTone(connection)] }} role="status"><span className="connection-dot"/>{descriptors[connection]}</div><button className="select-like" style={{padding:10}} title="Toggle kiosk mode" aria-label="Toggle kiosk mode" onClick={() => setKiosk(!kiosk)}><Maximize2 size={19}/></button></div>
      </header>
      {app?.mode === 'mock' && <div className="mode-banner">Mock engine · Simulated hardware (NEXT_PUBLIC_ENGINE=mock). Stored separately from real device data.</div>}
      {banner && app?.mode !== 'mock' && <div className="mode-banner">{banner}</div>}
      {!live && app?.mode === 'device' && <div className="mode-banner">Not connected · Open Connection to pair the FORCE sensor over Bluetooth, or start the demo.</div>}
      {totalsError && <div className="mode-banner alert-warning" role="alert">Stored totals are unavailable ({totalsError}). Live readings are not affected.</div>}
      {snapshot?.alerts.map((alert) => <div className={`mode-banner alert-${alert.severity}`} role={alert.severity === 'error' ? 'alert' : undefined} key={alert.id}>{alert.message}</div>)}
      {page === 'Overview' ? <div className="dashboard-grid"><div className="overview-upper">
        <section className="panel tile-panel"><div className="panel-heading"><div><h2 className="panel-title">{multiTile ? 'Live Floor Map' : 'Tile'}</h2><p className="panel-subtitle">{multiTile ? 'Real-time energy output per tile (W)' : 'Real-time energy output (W)'}</p></div><span className="select-like">Power Output (W)</span></div>
          <div className="single-tile-scene">{multiTile ? <HexHeatmap tiles={[]} multiTile/> : <svg className="single-hex" viewBox="0 0 360 310" role="img" aria-label="Tile power output"><defs><linearGradient id="tileFace" x2="0" y2="1"><stop stopColor={glowing ? 'var(--accent-soft)' : 'var(--heat-face-top)'}/><stop offset="1" stopColor={glowing ? 'var(--sidebar-active-end)' : 'var(--heat-face-bottom)'}/></linearGradient><filter id="tileGlow"><feGaussianBlur stdDeviation="17" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polygon points="90,65 180,13 270,65 270,170 180,222 90,170" transform="translate(0 23)" fill="#17111f" stroke="var(--accent)" strokeWidth="9" opacity=".3"/><polygon points="90,65 180,13 270,65 270,170 180,222 90,170" fill="url(#tileFace)" stroke="var(--accent-soft)" strokeWidth="4" filter="url(#tileGlow)"/><circle cx="180" cy="117" r="7" fill="var(--text)"/></svg>}
            <div className="tile-value"><span>Power Output <strong>{stale ? 'No data' : `${power.value} ${power.unit}`.trim()}</strong></span><span>{simulated ? 'Steps (session)' : 'Steps Today'} <strong>{stale ? 'No data' : stepsValue?.toLocaleString() ?? '—'}</strong></span><span>Status <strong className="tile-state">{tileState(snapshot, connection)}</strong></span></div>
          </div></section>
        <div className="right-stack"><section className="panel metrics-panel"><div className="section-head"><h2 className="panel-title">Key Metrics <span className="subdued">({periodLabel})</span></h2><Info size={20} color="var(--text-muted)" role="img" aria-label={simulated ? 'Values for the running simulated session only.' : 'Stored real-device totals since local midnight.'}/></div>
          <div className="metric-grid">
            <Metric icon={Zap} label="Total Energy Generated" value={`${energy.value} ${energy.unit}`.trim()} comparison={showYesterday ? `Yesterday ${formatEnergy(days.yesterday.energyWh).value} ${formatEnergy(days.yesterday.energyWh).unit}` : undefined} extra={simulated ? 'Simulated' : 'Measured'} quality={quality}/>
            <Metric icon={Footprints} label="Total Footsteps" value={stepsValue?.toLocaleString() ?? '—'} comparison={showYesterday ? `Yesterday ${days.yesterday.steps.toLocaleString()} steps` : undefined} extra={simulated ? 'Simulated' : 'Detected'} quality={quality}/>
            <Metric icon={Leaf} label="CO₂ Offset (Est.)" value={`${co2.value} ${co2.unit}`.trim()} comparison={showYesterday ? `Yesterday ${formatCo2(days.co2YesterdayKg).value} ${formatCo2(days.co2YesterdayKg).unit}` : undefined} extra="Placeholder factor" quality={quality}/>
            <Metric icon={Sprout} label="Sustainability Score" value={metrics?.sustainabilityScore == null ? '—' : `${metrics.sustainabilityScore}`} extra="Placeholder formula" green/>
          </div>
        </section>
        <section className="panel status-panel"><div className="section-head"><h2 className="panel-title">System Status</h2></div>
          <Status icon={Layers3} label="Tiles" view={{ value: live ? '1 / 1' : '0 / 1', tone: live ? 'good' : 'muted' }}/>
          <Status icon={Wifi} label="Data Connection" view={{ value: descriptors[connection], tone: connectionTone(connection) }}/>
          <Status icon={Cpu} label="Sensor" view={sensor}/>
          <Status icon={PlugZap} label="Power Input" view={input}/>
          <Status icon={Activity} label="Signal Strength" view={{ value: metrics?.rssiDbm == null ? '—' : `${metrics.rssiDbm} dBm`, tone: metrics?.rssiDbm == null ? 'muted' : 'good' }}/>
        </section></div>
        </div><div className="chart-row">
        <ChartCard title={<>Power Output <span className="chart-title-muted">(Real-time)</span></>} live={connection === 'streaming'}><PowerChart/></ChartCard>
        <ChartCard title="Energy Generated" range={range} tabs={tabs} onRange={setRange}><EnergyChart history={history} range={range}/></ChartCard>
        <ChartCard title="Foot Traffic" range={range} tabs={tabs} onRange={setRange}><TrafficChart history={history} range={range}/></ChartCard>
      </div></div> : <OtherScreen name={page} engine={engine} connection={connection} snapshot={snapshot} />}
    </main>
    {app?.injectFault && <div className="dev-panel"><strong>MOCK</strong><label htmlFor="inject-fault">Inject fault</label><select id="inject-fault" value={fault} onChange={(e) => { const kind = e.target.value; setFault(''); if (kind) { try { app.injectFault?.({ kind, durationMs: kind === 'stale' ? 8000 : 3000 } as Parameters<NonNullable<typeof app.injectFault>>[0], 0); } catch { /* not streaming */ } } }}><option value="">Choose…</option>{FAULTS.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>}
  </div>;
}

function Metric({ icon: Icon, label, value, quality, comparison, extra, green }: { icon: typeof Zap; label: string; value: string; quality?: string; comparison?: string; extra?: string; green?: boolean }) {
  return <div className={`metric-card${green ? ' metric-green' : ''}`}><Icon className="metric-icon" aria-hidden="true"/><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{comparison && <div className="metric-change" style={{color:'var(--text-secondary)'}}>{comparison}</div>}{extra && <div className="metric-change" style={{color:'var(--text-muted)'}}>{extra}</div>}{quality && <div className="quality-line">{quality}</div>}</div></div>;
}
const indicatorText: Record<Tone, string> = { good: 'OK', warn: 'Check', bad: 'Alert', muted: 'No data' };
function Status({ icon: Icon, label, view }: { icon: typeof Zap; label: string; view: StatusView }) {
  return <div className="status-row"><Icon aria-hidden="true"/><span>{label}</span><strong>{view.value}</strong><span className="status-indicator" style={{ color: toneColor[view.tone] }}><i className="connection-dot"/>{indicatorText[view.tone]}</span></div>;
}
function ChartCard({ title, children, live, range, tabs, onRange }: { title: React.ReactNode; children: React.ReactNode; live?: boolean; range?: string; tabs?: string[]; onRange?: (range: string) => void }) {
  return <section className="panel chart-panel"><div className="chart-heading"><h2 className="panel-title">{title}</h2>{live !== undefined ? live && <span className="live-badge"><i className="connection-dot"/>Live</span> : tabs && <div className="range-tabs" role="tablist">{tabs.map((tab) => <button key={tab} className={`range-tab${range === tab ? ' selected' : ''}`} onClick={() => onRange?.(tab)} role="tab" aria-selected={range === tab}>{tab}</button>)}</div>}</div><div className="chart-wrap">{children}</div></section>;
}

