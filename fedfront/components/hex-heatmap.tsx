import type { TileInfo } from '@/contracts';

type Props = { tiles: TileInfo[]; values?: Record<string, number>; multiTile?: boolean };
export function HexHeatmap({ tiles, values = {}, multiTile = true }: Props) {
  const shown = multiTile ? tiles : tiles.slice(0, 1);
  const coords = shown.map((tile) => ({ tile, coord: [tile.x, tile.y] }));
  return <svg viewBox="0 0 660 360" role="img" aria-label="Tile power heatmap" className="hex-heatmap">
    <defs><linearGradient id="hexFace" x2="0" y2="1"><stop stopColor="var(--heat-face-top)"/><stop offset="1" stopColor="var(--heat-face-bottom)"/></linearGradient><linearGradient id="heatLegend" x2="0" y2="1"><stop stopColor="var(--heat-4)"/><stop offset=".38" stopColor="var(--heat-3)"/><stop offset=".7" stopColor="var(--heat-2)"/><stop offset="1" stopColor="var(--heat-1)"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    {coords.map(({ tile, coord }) => { const size = multiTile ? 42 : 90; const x = multiTile ? 260 + coord[0] * 80 : 330; const y = multiTile ? 32 + coord[1] * 56 : 180; const value = values[tile.deviceId] ?? 0; const hot = value > 0; const color = value > 2 ? 'var(--heat-4)' : value > 1 ? 'var(--heat-3)' : value > .5 ? 'var(--heat-2)' : value > .1 ? 'var(--heat-1)' : 'var(--heat-low)'; const pts = Array.from({ length: 6 }, (_, a) => `${x + size * Math.cos((Math.PI / 3) * a - Math.PI / 2)},${y + size * Math.sin((Math.PI / 3) * a - Math.PI / 2)}`).join(' '); return <g key={tile.deviceId} style={{ filter: hot ? 'url(#glow)' : undefined }}><polygon points={pts} transform="translate(0 7)" fill="#11151c" stroke="#59606c" strokeWidth="3"/><polygon points={pts} fill={hot ? color : 'url(#hexFace)'} stroke={hot ? 'var(--heat-edge-hot)' : 'var(--heat-edge)'} strokeWidth="2"/><circle cx={x} cy={y} r="2.5" fill="#eee1ff"/></g>; })}
    {multiTile && <g fontFamily="Inter, sans-serif" fontSize="12" fill="#bfc0ce"><text x="534" y="74" fill="var(--text)" fontSize="13">Power (W)</text><rect x="534" y="88" width="19" height="150" rx="2" fill="url(#heatLegend)"/>{['> 2.0','1.0 – 2.0','0.5 – 1.0','0.1 – 0.5','0'].map((label, i) => <text key={label} x="561" y={101 + i * 31}>{label}</text>)}</g>}
  </svg>;
}
