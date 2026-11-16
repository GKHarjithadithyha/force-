import type { ConnectionState, LiveSnapshot } from '@/contracts';
import { hasData, sensorStatus, tileState } from '@/lib/live';

/**
 * Current power at a glance: a status indicator (the tile hexagon), the live value, the sensor
 * status, and an explicit message when there is no live data. The value is shown only when the
 * engine says the reading is usable; otherwise a dash and the reason.
 */
export function RealTimePowerCard({ snapshot, connection, power, steps, stepsLabel, usable, glowing }: { snapshot: LiveSnapshot | null; connection: ConnectionState; power: { value: string; unit: string }; steps: string; stepsLabel: string; usable: boolean; glowing: boolean }) {
  const live = hasData(snapshot); const stale = connection === 'stale';
  const status = tileState(snapshot, connection);
  const headline = !live ? 'No live data' : stale ? 'No data' : usable ? `${power.value} ${power.unit}`.trim() : '—';
  const hint = !live ? 'Connect the sensor to start real-time monitoring.'
    : stale ? 'Packets stopped arriving. Waiting for the sensor.'
    : usable ? `Sensor ${sensorStatus(snapshot).value.toLowerCase()}`
    : status === 'No input' ? 'No power input detected at the sensor.'
    : status === 'Sensor fault' ? 'The sensor reading is not valid.'
    : 'Not streaming.';
  return <section className="panel card rt-card" aria-label="Real-time power output">
    <div className="card-head"><h2 className="panel-title">Real-time <span className="subdued">Power Output</span></h2>{usable && connection === 'streaming' && <span className="live-badge"><i className="connection-dot"/>Live</span>}</div>
    <div className="rt-body">
      <svg className={`rt-hex${glowing ? ' rt-hex-on' : ''}`} viewBox="0 0 360 310" role="img" aria-label="Tile power output"><defs><linearGradient id="rtFace" x2="0" y2="1"><stop style={{ stopColor: glowing ? 'var(--tile-on-top)' : 'var(--tile-off-top)' }}/><stop offset="1" style={{ stopColor: glowing ? 'var(--tile-on-bottom)' : 'var(--tile-off-bottom)' }}/></linearGradient><filter id="rtGlow"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polygon points="90,65 180,13 270,65 270,170 180,222 90,170" fill="url(#rtFace)" style={{ stroke: glowing ? 'var(--tile-on-edge)' : 'var(--tile-off-edge)' }} strokeWidth="5" filter={glowing ? 'url(#rtGlow)' : undefined}/><circle cx="180" cy="117" r="7" style={{ fill: 'var(--tile-dot)' }} opacity={glowing ? 1 : .5}/></svg>
      <div className="rt-value" data-empty={!usable}>{headline}</div>
      <p className="rt-hint">{hint}</p>
    </div>
    <dl className="rt-stats">
      <div><dt>{stepsLabel}</dt><dd>{live ? steps : '—'}</dd></div>
      <div><dt>Status</dt><dd className={status === 'Active' ? 'rt-active' : undefined}>{status}</dd></div>
    </dl>
  </section>;
}
