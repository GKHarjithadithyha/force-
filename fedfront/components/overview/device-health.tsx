import { Activity, Cpu, PlugZap, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ConnectionState, LiveSnapshot } from '@/contracts';
import { hasData, inputStatus, sensorStatus } from '@/lib/live';
import type { Tone } from '@/lib/live';

interface Row { icon: LucideIcon; label: string; status: string; tone: Tone }

function connectionRow(c: ConnectionState): Pick<Row, 'status' | 'tone'> {
  switch (c) {
    case 'streaming': return { status: 'Connected', tone: 'good' };
    case 'choosing': case 'connecting': case 'reconnecting': return { status: 'Initialising', tone: 'warn' };
    case 'stale': return { status: 'No data', tone: 'warn' };
    case 'error': return { status: 'Error', tone: 'bad' };
    case 'unsupported': return { status: 'Unsupported', tone: 'warn' };
    default: return { status: 'Disconnected', tone: 'muted' };
  }
}

/**
 * Device health. A value is shown as healthy only while packets are really streaming: a missing
 * or stale source reads "No data", never "OK". All statuses come from the engine's snapshot.
 */
export function DeviceHealth({ snapshot, connection }: { snapshot: LiveSnapshot | null; connection: ConnectionState }) {
  const streaming = connection === 'streaming' && hasData(snapshot);
  const noData = { status: 'No data', tone: 'muted' as Tone };
  const sensorView = sensorStatus(snapshot); const inputView = inputStatus(snapshot);
  const sensor = !streaming ? noData : sensorView.value === 'Fault' ? { status: 'Error', tone: sensorView.tone } : { status: sensorView.value, tone: sensorView.tone };
  const input = !streaming || inputView.value === '—' ? noData : { status: inputView.value, tone: inputView.tone };
  const rssi = snapshot?.metrics.rssiDbm;
  const signal = !streaming || rssi == null ? noData : { status: `${rssi} dBm`, tone: 'good' as Tone };
  const rows: Row[] = [
    { icon: Wifi, label: 'Data Connection', ...connectionRow(connection) },
    { icon: Cpu, label: 'Sensor', ...sensor },
    { icon: PlugZap, label: 'Power Input', ...input },
    { icon: Activity, label: 'Signal Strength', ...signal },
  ];
  return <section className="panel card health-panel" aria-label="Device health">
    <div className="card-head"><h2 className="panel-title">Device Health</h2></div>
    <ul className="health-list">
      {rows.map(({ icon: Icon, label, status, tone }) => <li key={label} className="health-row"><span className="health-icon"><Icon size={18} aria-hidden="true"/></span><span className="health-label">{label}</span><span className={`state-pill state-${tone}`}><i className="state-dot"/>{status}</span></li>)}
    </ul>
  </section>;
}
