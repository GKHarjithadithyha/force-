'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Footprints, LayoutDashboard, Leaf, Zap } from 'lucide-react';
import { ImpactView } from '@/components/impact-view';
import { EnergyChart, TrafficChart } from '@/components/charts';
import { ConnectionBanner } from '@/components/overview/connection-banner';
import { DashboardHeader } from '@/components/overview/dashboard-header';
import { MetricCard } from '@/components/overview/metric-card';
import { Sidebar } from '@/components/overview/sidebar';
import { BRAND_EXPANSION } from '@/lib/brand';
import { DAILY_POLL_MS, LIVE_POLL_MS, dataAgeMs, fetchDaily, fetchDeviceId, fetchLive, formatAge, freshness, nextBackoff, readCloudConfig, rowTimeMs } from '@/lib/cloud-read';
import type { CloudConfig, DailyRow, FetchResult, Freshness, LiveView } from '@/lib/cloud-read';
import type { ConnectionState, HistoryPoint } from '@/contracts';
import type { Tone } from '@/lib/live';

const IMPACT = 'Real-World Impact'; const IMPACT_HASH = '#real-world-impact';
const ITEMS = [{ name: 'Overview', icon: LayoutDashboard }, { name: IMPACT, icon: Bike }];
const FRESH_LABEL: Record<Freshness, string> = { live: 'Live', stale: 'Stale', offline: 'Offline' };
const FRESH_CONNECTION: Record<Freshness, ConnectionState> = { live: 'streaming', stale: 'stale', offline: 'idle' };
const FRESH_TONE: Record<Freshness, Tone> = { live: 'good', stale: 'warn', offline: 'muted' };

/** Messages for the load states of one feed. */
type Problem = 'none' | 'missing' | 'forbidden' | 'error';
interface Feed<T> { value: T | null; problem: Problem; checked: boolean }
const EMPTY = { value: null, problem: 'none', checked: false } as const;

/**
 * Polls `load` forever: `okMs` after a success, then 5 s doubling to 60 s after a network or 5xx
 * error. The last good value is kept through errors. A 404 or 403 is a state, not a retry storm,
 * so it keeps the normal interval.
 */
function usePoll<T>(load: (() => Promise<FetchResult<T>>) | null, okMs: number): Feed<T> {
  const [feed, setFeed] = useState<Feed<T>>(EMPTY);
  const loadRef = useRef(load); loadRef.current = load;
  const enabled = load !== null;
  useEffect(() => {
    if (!enabled) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined; let backoff: number | null = null;
    const tick = async () => {
      const run = loadRef.current; if (!run) return;
      const r = await run();
      if (!alive) return;
      let delay = okMs;
      if (r.kind === 'ok') { backoff = null; setFeed({ value: r.value, problem: 'none', checked: true }); }
      else if (r.kind === 'missing') { backoff = null; setFeed({ value: null, problem: 'missing', checked: true }); }
      else if (r.kind === 'forbidden') { backoff = null; setFeed((f) => ({ value: f.value, problem: 'forbidden', checked: true })); }
      else { backoff = nextBackoff(backoff); delay = backoff; setFeed((f) => ({ value: f.value, problem: 'error', checked: true })); }
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [enabled, okMs]);
  return feed;
}

const fixed = (v: number | null | undefined, digits: number) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }));
const withUnit = (v: number | null | undefined, digits: number, unit: string) => (v == null ? '—' : `${fixed(v, digits)} ${unit}`);

/**
 * Public hosted dashboard (NEXT_PUBLIC_DATA_SOURCE=cloud). Reads the stored cloud values over
 * REST; there is no Bluetooth, engine or local database here, and nothing is calculated.
 */
export function CloudDashboard() {
  const cfg = useMemo(() => readCloudConfig({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, deviceId: process.env.NEXT_PUBLIC_PUBLIC_DEVICE_ID }), []);
  const [now, setNow] = useState(() => Date.now()); const [kiosk, setKiosk] = useState(false); const [navOpen, setNavOpen] = useState(false);
  const [page, setPage] = useState('Overview');
  useEffect(() => { const sync = () => setPage(window.location.hash === IMPACT_HASH ? IMPACT : 'Overview'); sync(); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const navigate = useCallback((name: string) => { setPage(name); setNavOpen(false); window.history.replaceState(null, '', name === IMPACT ? IMPACT_HASH : window.location.pathname); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const config: CloudConfig | null = cfg.ok ? cfg.config : null;

  // device: configured, or the first public device
  const devices = usePoll(useMemo(() => (config && config.deviceId === null ? () => fetchDeviceId(config) : null), [config]), 30_000);
  const deviceId = config?.deviceId ?? (devices.value ?? null);
  // the device stays known once found, so a later list error does not blank the page
  const live = usePoll(useMemo(() => (config && deviceId ? () => fetchLive(config, deviceId) : null), [config, deviceId]), LIVE_POLL_MS);
  const daily = usePoll(useMemo(() => (config && deviceId ? () => fetchDaily(config, deviceId) : null), [config, deviceId]), DAILY_POLL_MS);

  const view: LiveView | null = live.value;
  const state: Freshness | null = view ? freshness(view, now) : null;
  const age = view ? dataAgeMs(view, now) : null;
  const history = useMemo<HistoryPoint[]>(() => (daily.value ?? []).map((r) => ({ t: rowTimeMs(r), energyWh: r.energyWh, steps: r.steps, recordedMs: 0 })).sort((a, b) => a.t - b.t), [daily.value]);
  const usable = view !== null && state !== 'offline' && view.measured !== null && view.inputPresent;
  const noDevice = devices.problem === 'missing' && deviceId === null;
  const problems = [live, daily, devices].some((f) => f.problem === 'error');
  const forbidden = [live, daily, devices].some((f) => f.problem === 'forbidden');
  const noData = (live.problem === 'missing' && live.value === null) || noDevice;
  const open = useCallback(() => setNavOpen(true), []);

  const tone = state ? FRESH_TONE[state] : 'muted';
  const power = view?.measured?.powerW ?? null;
  const headline = view === null ? (noData ? 'No data yet' : '—') : state === 'offline' ? 'Offline' : view.measured === null ? '—' : withUnit(power, power !== null && power < 10 ? 2 : 1, 'W');
  const hint = view === null ? (noData ? 'The device has not uploaded anything yet.' : 'Waiting for the first reading from the cloud.')
    : state === 'offline' ? 'The device has not reported for more than 10 minutes. Values below are the last stored ones.'
    : view.measured === null ? 'The newest sample is not a valid measurement.'
    : !view.inputPresent ? 'No power input detected at the sensor.'
    : state === 'stale' ? 'Updates are late. Values are the last stored ones.' : `Sensor ${view.measurementValid ? 'normal' : 'fault'}`;
  const glowing = usable && state === 'live' && view.generating;

  return <div className={`app-shell${kiosk ? ' kiosk' : ''}${state === 'stale' ? ' stale' : ''}${navOpen ? ' nav-open' : ''}`}>
    <Sidebar items={ITEMS} page={page} brandExpansion={BRAND_EXPANSION} onNavigate={navigate}/>
    <button type="button" className="nav-scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setNavOpen(false)}/>
    <main className="main-area">
      <DashboardHeader title={page === IMPACT ? IMPACT : 'Intelligent Dashboard'} subtitle={page === IMPACT ? 'Estimated equivalents of the energy this tile generated' : 'Stored energy and footstep data from the F.O.R.C.E. tile'} now={new Date(now)} connection={state ? FRESH_CONNECTION[state] : 'idle'} statusLabel={state ? `${FRESH_LABEL[state]} · ${formatAge(age)}` : cfg.ok ? (live.checked || devices.checked ? 'No data yet' : 'Loading') : 'Not configured'} menuOpen={navOpen} onOpenMenu={open} onToggleKiosk={() => setKiosk(!kiosk)}/>
      <div className="banners">
        {!cfg.ok && <ConnectionBanner tone="bad" alert>{cfg.message}</ConnectionBanner>}
        {forbidden && <ConnectionBanner tone="bad" alert>Cloud access not permitted (rules not deployed?)</ConnectionBanner>}
        {problems && !forbidden && <ConnectionBanner tone="warn" alert>Connection problem, retrying{view ? ' · showing the last values received' : ''}</ConnectionBanner>}
        {noData && !forbidden && !problems && <ConnectionBanner>No data yet · the device has not uploaded anything to the cloud.</ConnectionBanner>}
        {view && state !== 'live' && <ConnectionBanner tone="warn">{state === 'stale' ? 'Stale' : 'Offline'} · last data {formatAge(age)}. The device may be out of range or idle.</ConnectionBanner>}
        {view?.alerts.map((a, i) => <ConnectionBanner key={`${a.kind}-${i}`} tone={a.severity === 'error' ? 'bad' : a.severity === 'warning' ? 'warn' : 'info'}>{ALERT_TEXT[a.kind] ?? `Device alert: ${a.kind.replaceAll('_', ' ')}`}</ConnectionBanner>)}
      </div>
      {page === IMPACT ? <ImpactView view={view} state={state} age={age} daily={daily.value} liveChecked={live.checked} noData={noData}/> : <div className="ov">
        <div className="ov-top">
          <section className="panel card ov-power" aria-label="Daily energy">
            <div className="card-head"><div><h2 className="panel-title">Energy Generated <span className="subdued">(Daily)</span></h2><p className="panel-subtitle">Stored daily totals, last 30 days{view ? ` · ${view.deviceId}` : ''}</p></div></div>
            <div className="chart-wrap"><EnergyChart history={history} range="Month"/></div>
          </section>
          <section className="panel card kpi-panel" aria-label="Key metrics">
            <div className="card-head"><h2 className="panel-title">Key Metrics <span className="subdued">(Session)</span></h2></div>
            <div className="kpi-grid">
              <MetricCard icon={Zap} label="Total Energy Generated" value={withUnit(view?.totalEnergyWh, 2, 'Wh')} badge={{ text: 'Measured', tone: 'good' }} note="All stored sessions"/>
              <MetricCard icon={Zap} label="Session Energy" value={withUnit(view?.sessionEnergyWh, 2, 'Wh')} badge={{ text: 'Measured', tone: 'good' }} note={view?.sessionEnergyWh == null ? undefined : 'Current session'}/>
              <MetricCard icon={Footprints} label="Footsteps (Session)" value={fixed(view?.steps, 0)} badge={{ text: 'Detected', tone: 'good' }} note={view?.cadenceSpm == null ? undefined : `Cadence ${fixed(view.cadenceSpm, 0)} steps/min`}/>
              <MetricCard icon={Leaf} label="CO₂ Avoided" value={withUnit(view?.co2AvoidedKg, 3, 'kg')} badge={{ text: 'Estimate', tone: 'warn' }} note="Placeholder emission factor"/>
            </div>
          </section>
        </div>
        <div className="ov-bottom">
          <section className="panel card rt-card" aria-label="Live power">
            <div className="card-head"><h2 className="panel-title">Live <span className="subdued">Power Output</span></h2>{state === 'live' && usable && <span className="live-badge"><i className="connection-dot"/>Live</span>}</div>
            <div className="rt-body">
              <svg className={`rt-hex${glowing ? ' rt-hex-on' : ''}`} viewBox="0 0 360 310" role="img" aria-label="Tile power output"><defs><linearGradient id="cdFace" x2="0" y2="1"><stop style={{ stopColor: glowing ? 'var(--tile-on-top)' : 'var(--tile-off-top)' }}/><stop offset="1" style={{ stopColor: glowing ? 'var(--tile-on-bottom)' : 'var(--tile-off-bottom)' }}/></linearGradient></defs><polygon points="90,65 180,13 270,65 270,170 180,222 90,170" fill="url(#cdFace)" style={{ stroke: glowing ? 'var(--tile-on-edge)' : 'var(--tile-off-edge)' }} strokeWidth="5"/><circle cx="180" cy="117" r="7" style={{ fill: 'var(--tile-dot)' }} opacity={glowing ? 1 : .5}/></svg>
              <div className="rt-value" data-empty={!usable} data-testid="live-power">{headline}</div>
              <p className="rt-hint">{hint}</p>
            </div>
            <dl className="rt-stats">
              <div><dt>Voltage</dt><dd>{withUnit(view?.measured?.voltageV, 2, 'V')}</dd></div>
              <div><dt>Current</dt><dd>{withUnit(view?.measured?.currentMa, 1, 'mA')}</dd></div>
            </dl>
          </section>
          <section className="panel card chart-card" aria-label="Foot traffic">
            <div className="card-head"><h2 className="panel-title">Foot Traffic <span className="subdued">(Daily)</span></h2></div>
            <div className="chart-wrap"><TrafficChart history={history} range="Month"/></div>
          </section>
          <section className="panel card health-panel" aria-label="Device health">
            <div className="card-head"><h2 className="panel-title">Device Health</h2></div>
            <ul className="health-list">
              {([
                ['Data Connection', state ? FRESH_LABEL[state] : 'No data', tone],
                ['Sensor', view && state !== 'offline' ? (view.measurementValid ? 'Normal' : 'Error') : 'No data', view && state !== 'offline' ? (view.measurementValid ? 'good' : 'bad') : 'muted'],
                ['Power Input', view && state !== 'offline' ? (view.inputPresent ? 'Present' : 'No input') : 'No data', view && state !== 'offline' ? (view.inputPresent ? 'good' : 'warn') : 'muted'],
                ['Signal Strength', view && state !== 'offline' && view.rssiDbm !== null ? `${view.rssiDbm} dBm` : 'No data', view && state !== 'offline' && view.rssiDbm !== null ? 'good' : 'muted'],
              ] as Array<[string, string, Tone]>).map(([label, status, t]) => <li key={label} className="health-row"><span className="health-label">{label}</span><span className={`state-pill state-${t}`}><i className="state-dot"/>{status}</span></li>)}
            </ul>
          </section>
          <section className="panel card chart-card" aria-label="Daily summaries">
            <div className="card-head"><h2 className="panel-title">Daily Summaries</h2></div>
            <DailyTable rows={daily.value} loaded={daily.checked}/>
          </section>
        </div>
      </div>}
    </main>
  </div>;
}

/** Alert kinds are published without free text; map the kind to a message here. */
const ALERT_TEXT: Record<string, string> = {
  sensor_fault: 'Sensor fault · the device reports an invalid measurement.',
  over_voltage: 'Over voltage · the input is above the safe limit.',
  stale: 'Data is stale · packets stopped arriving.',
};

function DailyTable({ rows, loaded }: { rows: DailyRow[] | null; loaded: boolean }) {
  if (rows === null || rows.length === 0) return <div className="chart-wrap"><div className="chart-empty"><strong>{loaded ? 'No daily summaries yet' : 'Loading daily summaries…'}</strong></div></div>;
  return <div className="table-scroll"><table className="session-table"><thead><tr><th>Date</th><th>Steps</th><th>Energy (Wh)</th><th>Peak power (W)</th><th>Sessions</th></tr></thead><tbody>{rows.map((r) => <tr key={r.date}><td>{r.date}</td><td>{fixed(r.steps, 0)}</td><td>{fixed(r.energyWh, 3)}</td><td>{fixed(r.peakPowerW, 3)}</td><td>{r.sessions}</td></tr>)}</tbody></table></div>;
}
