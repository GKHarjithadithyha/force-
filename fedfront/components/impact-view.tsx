'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { Fuel, Gauge, Home, Pause, Play, RotateCcw, Zap } from 'lucide-react';
import { MetricCard } from '@/components/overview/metric-card';
import { formatAge } from '@/lib/cloud-read';
import type { DailyRow, Freshness, LiveView } from '@/lib/cloud-read';
import {
  ASSUMPTION_LIMITS, DEFAULT_ASSUMPTIONS, computeImpact, formatDistance, formatDuration, formatEnergy, formatVolume,
  parseAssumption, pickEnergy, readImpactAssumptions, roadProgress, sanitizeAssumptions, sceneState, summarize,
} from '@/lib/impact';
import type { AssumptionKey, EnergyBasis, ImpactAssumptions, ImpactState } from '@/lib/impact';

const STORE_KEY = 'force.impact.assumptions.v1';
const BASIS: Array<[EnergyBasis, string]> = [['total', 'Total'], ['today', 'Latest day'], ['session', 'Session']];
const ENV_DEFAULTS = readImpactAssumptions({
  scooterWhPerKm: process.env.NEXT_PUBLIC_IMPACT_SCOOTER_WH_PER_KM,
  petrolKmPerLitre: process.env.NEXT_PUBLIC_IMPACT_PETROL_KM_PER_L,
  houseLoadW: process.env.NEXT_PUBLIC_IMPACT_HOUSE_LOAD_W,
  ledW: process.env.NEXT_PUBLIC_IMPACT_LED_W,
});
const dash = '—';
const fixed = (v: number | null | undefined, d: number, unit: string) => (v == null || !Number.isFinite(v) ? dash : `${v.toFixed(d)} ${unit}`);

/** Scooter on a road. Position comes only from the estimated distance; wheels and road move only while energy is really being generated. */
const ScooterScene = memo(function ScooterScene({ fraction, animate, paused, label }: { fraction: number; animate: boolean; paused: boolean; label: string }) {
  return <svg className={`imp-scene${animate ? ' imp-live' : ''}${paused ? ' imp-paused' : ''}`} viewBox="0 0 600 140" role="img" aria-label={label}>
    <rect x="0" y="96" width="600" height="30" rx="4" className="imp-road"/>
    <line x1="0" y1="111" x2="600" y2="111" className="imp-dash"/>
    <line x1="24" y1="90" x2="24" y2="132" className="imp-mark"/><line x1="576" y1="90" x2="576" y2="132" className="imp-mark"/>
    <g className="imp-rider" style={{ transform: `translateX(${(24 + fraction * 480).toFixed(1)}px)` }}>
      <circle cx="12" cy="86" r="13" className="imp-wheel"/><circle cx="68" cy="86" r="13" className="imp-wheel"/>
      <path d="M12 86 H60 L52 62 M52 62 H44 M60 86 L66 66" className="imp-body" fill="none"/>
      <rect x="24" y="74" width="30" height="6" rx="3" className="imp-deck"/>
    </g>
  </svg>;
});

/** Power line into a house. The line flows and the windows light only while energy is really being generated. */
const HouseScene = memo(function HouseScene({ animate, paused, label }: { animate: boolean; paused: boolean; label: string }) {
  return <svg className={`imp-scene imp-house${animate ? ' imp-live' : ''}${paused ? ' imp-paused' : ''}`} viewBox="0 0 320 140" role="img" aria-label={label}>
    <path d="M6 100 H110" className="imp-wire"/><path d="M6 100 H110" className="imp-flow"/>
    <path d="M110 66 L190 18 L270 66 Z" className="imp-roof"/><rect x="122" y="66" width="136" height="64" className="imp-wall"/>
    <rect x="140" y="82" width="30" height="26" rx="2" className="imp-window"/><rect x="210" y="82" width="30" height="26" rx="2" className="imp-window"/>
    <rect x="178" y="94" width="24" height="36" rx="2" className="imp-door"/>
  </svg>;
});

function Assumptions({ value, onChange }: { value: ImpactAssumptions; onChange: (v: ImpactAssumptions) => void }) {
  const [text, setText] = useState<Record<AssumptionKey, string>>(() => ({ ...value }) as unknown as Record<AssumptionKey, string>);
  useEffect(() => setText({ ...value } as unknown as Record<AssumptionKey, string>), [value]);
  const keys = Object.keys(ASSUMPTION_LIMITS) as AssumptionKey[];
  return <section className="panel imp-assume" aria-label="Assumptions">
    <div className="card-head"><div><h2 className="panel-title">Assumptions</h2><p className="panel-subtitle">Every estimate is energy divided by these values. Change them to match your own scooter, bike and home.</p></div>
      <button type="button" className="secondary-action" onClick={() => onChange(ENV_DEFAULTS)}><RotateCcw size={15} aria-hidden="true"/> Reset</button></div>
    <div className="imp-fields">{keys.map((k) => {
      const lim = ASSUMPTION_LIMITS[k]; const raw = String(text[k] ?? ''); const ok = parseAssumption(k, raw) !== null;
      return <label key={k} className="field-label">{lim.label} ({lim.unit})
        <input className="text-field" type="number" inputMode="decimal" min={lim.min} max={lim.max} step={lim.step} value={raw} aria-invalid={!ok} aria-describedby={`imp-${k}-err`}
          onChange={(e) => { const t = e.target.value; setText((c) => ({ ...c, [k]: t })); const n = parseAssumption(k, t); if (n !== null) onChange({ ...value, [k]: n }); }}/>
        <span id={`imp-${k}-err`} className="field-hint" role={ok ? undefined : 'alert'}>{ok ? `Allowed ${lim.min} to ${lim.max}` : `Enter ${lim.min} to ${lim.max}; the last valid value is used`}</span>
      </label>;
    })}</div>
  </section>;
}

export function ImpactView({ view, state, age, daily, liveChecked, noData }: { view: LiveView | null; state: Freshness | null; age: number | null; daily: DailyRow[] | null; liveChecked: boolean; noData: boolean }) {
  const [basis, setBasis] = useState<EnergyBasis>('total'); const [paused, setPaused] = useState(false);
  const [assume, setAssume] = useState<ImpactAssumptions>(ENV_DEFAULTS);
  useEffect(() => { try { const s = window.localStorage.getItem(STORE_KEY); if (s) setAssume(sanitizeAssumptions(JSON.parse(s), ENV_DEFAULTS)); } catch { /* ignore */ } }, []);
  const update = (v: ImpactAssumptions) => { setAssume(v); try { window.localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* ignore */ } };

  const pick = pickEnergy(basis, view ? { totalEnergyWh: view.totalEnergyWh, sessionEnergyWh: view.sessionEnergyWh } : null, daily);
  const impact = useMemo(() => computeImpact(pick.energyWh, assume), [pick.energyWh, assume]);
  const road = roadProgress(impact?.distanceKm);
  const scene = sceneState({ hasView: view !== null, checked: liveChecked, noData, freshness: state, powerW: view?.measured?.powerW ?? null, generating: view?.generating ?? false, inputPresent: view?.inputPresent ?? false, measurementValid: view?.measurementValid ?? false });
  const animate = scene.animate && !paused;
  const stale = scene.state === 'stale' || scene.state === 'offline';
  const label = summarize(impact, assume, pick.label);
  const pill: Record<ImpactState, string> = { loading: 'muted', 'no-data': 'muted', live: 'good', idle: 'warn', stale: 'warn', offline: 'muted' };
  const when = view && age !== null ? `${formatAge(age)}${view.lastPacketAtMs ? ` · ${new Date(view.lastPacketAtMs).toLocaleTimeString()}` : ''}` : dash;
  const note = stale ? 'Last stored' : undefined;

  return <div className="imp" aria-busy={scene.state === 'loading'}>
    <p className="imp-notice" role="note"><strong>Estimated equivalents.</strong> All travel, fuel and household figures here are calculated from the energy this tile generated. No scooter is moving, no petrol was actually saved and no power is delivered to a house.</p>
    <div className="imp-status"><span className={`state-pill state-${pill[scene.state]}`}><i className="state-dot"/>{scene.title}</span><span className="imp-status-text" aria-live="polite">{scene.detail}</span>
      <button type="button" className="secondary-action imp-pause" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} aria-hidden="true"/> : <Pause size={15} aria-hidden="true"/>}{paused ? 'Resume animation' : 'Pause animation'}</button></div>
    <section className="imp-live-cards" aria-label="Live readings">
      <MetricCard icon={Zap} label="Voltage" value={fixed(view?.measured?.voltageV, 2, 'V')} note={note}/>
      <MetricCard icon={Gauge} label="Current" value={fixed(view?.measured?.currentMa, 1, 'mA')} note={note}/>
      <MetricCard icon={Zap} label="Power" value={fixed(view?.measured?.powerW, 3, 'W')} note={note}/>
      <MetricCard icon={Zap} label={`Generated (${pick.label})`} value={formatEnergy(pick.energyWh)} badge={{ text: 'Measured', tone: 'good' }}/>
      <MetricCard icon={Home} label="Device" value={view?.deviceId ?? dash}/>
      <MetricCard icon={Gauge} label="Last update" value={when}/>
    </section>
    <div className="imp-basis" role="radiogroup" aria-label="Energy to use">{BASIS.map(([b, l]) => <button key={b} type="button" role="radio" aria-checked={basis === b} className={`range-tab${basis === b ? ' selected' : ''}`} onClick={() => setBasis(b)}>{l}</button>)}</div>
    <div className="imp-grid">
      <section className="panel card imp-card" aria-label="Scooter">
        <div className="card-head"><h2 className="panel-title">Electric scooter</h2><span className="badge badge-warn">Estimated equivalent</span></div>
        <ScooterScene fraction={road.fraction} animate={animate} paused={paused} label={label}/>
        <div className="imp-road-labels"><span>{formatDistance(road.fromKm)}</span><span>next marker {formatDistance(road.toKm)}</span></div>
        <div className="imp-big" data-testid="imp-distance">{formatDistance(impact?.distanceKm)}</div>
        <p className="imp-sub">estimated distance at {assume.scooterWhPerKm} Wh/km</p>
      </section>
      <section className="panel card imp-card" aria-label="Petrol">
        <div className="card-head"><h2 className="panel-title">Petrol not burned</h2><span className="badge badge-warn">Estimated equivalent</span></div>
        <div className="imp-fuel"><Fuel size={34} aria-hidden="true"/></div>
        <div className="imp-big" data-testid="imp-petrol">{formatVolume(impact?.petrolLitres)}</div>
        <p className="imp-sub">A petrol two-wheeler at {assume.petrolKmPerLitre} km/L would use this much over the same distance.</p>
      </section>
      <section className="panel card imp-card imp-wide" aria-label="House">
        <div className="card-head"><h2 className="panel-title">Household supply</h2><span className="badge badge-warn">Estimated equivalent</span></div>
        <div className="imp-house-row"><HouseScene animate={animate} paused={paused} label={label}/>
          <dl className="imp-stats"><div><dt>{assume.houseLoadW} W household load</dt><dd data-testid="imp-house">{formatDuration(impact?.houseSeconds)}</dd></div><div><dt>{assume.ledW} W LED bulb</dt><dd data-testid="imp-led">{formatDuration(impact?.ledSeconds)}</dd></div></dl></div>
      </section>
    </div>
    <Assumptions value={assume} onChange={update}/>
    <p className="sr-only">{label}</p>
  </div>;
}

export { DEFAULT_ASSUMPTIONS };
