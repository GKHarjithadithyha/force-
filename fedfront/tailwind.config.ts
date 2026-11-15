import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      bg: 'var(--bg)', panel: 'var(--panel)', border: 'var(--panel-border)',
      accent: 'var(--accent)', 'accent-soft': 'var(--accent-soft)', text: 'var(--text)', muted: 'var(--text-muted)',
    },
    borderRadius: { panel: 'var(--radius-panel)', control: 'var(--radius-control)' },
  } },
  plugins: [],
};
export default config;
