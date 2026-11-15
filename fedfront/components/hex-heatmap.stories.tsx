import type { Meta, StoryObj } from '@storybook/react';
import { HexHeatmap } from './hex-heatmap';

const tiles = [3, 4, 5, 5, 5, 5].flatMap((count, row) => Array.from({ length: count }, (_, column) => {
  const centeredColumn = column - (count - 1) / 2;
  const x = centeredColumn + (row % 2 === 1 ? 0.5 : 0);
  const id = [3, 4, 5, 5, 5, 5].slice(0, row).reduce((sum, item) => sum + item, 0) + column + 1;
  return { deviceId: `tile-${id}`, name: `Tile ${id}`, x, y: row };
}));
const meta: Meta<typeof HexHeatmap> = { title: 'Dashboard/HexHeatmap', component: HexHeatmap, parameters: { layout: 'centered' } };
export default meta;
type Story = StoryObj<typeof HexHeatmap>;
export const Reference27Tiles: Story = { args: { tiles, values: Object.fromEntries(tiles.filter((_, i) => [3,7,8,13,16,19,22].includes(i)).map((tile) => [tile.deviceId, 1])), multiTile: true } };
