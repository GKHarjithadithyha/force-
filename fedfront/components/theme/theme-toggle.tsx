'use client';

import { Moon, Sun } from 'lucide-react';
import { toggleTheme, useTheme } from '@/components/theme/theme';

/** Sun/Moon button for the header. Shows the theme you would switch TO. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;
  return <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme} title={`Switch to ${next} theme`} aria-label={`Switch to ${next} theme`}><Icon className="theme-icon" size={18} aria-hidden="true"/></button>;
}
