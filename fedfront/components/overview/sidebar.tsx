'use client';

import type { LucideIcon } from 'lucide-react';

export interface NavItem { name: string; icon: LucideIcon }

/**
 * Main navigation. Presentation only: the page state and the navigation handler live in the
 * dashboard. Desktop: full sidebar. Tablet: icon rail. Mobile: a drawer opened from the header.
 */
export function Sidebar({ items, page, brandExpansion, onNavigate }: { items: NavItem[]; page: string; brandExpansion: string; onNavigate: (name: string) => void }) {
  return <aside className="sidebar" id="app-sidebar">
    <div className="brand"><div className="brand-name">F.O.R.C.E.</div><div className="brand-expansion">{brandExpansion}</div></div>
    <nav className="nav-list" aria-label="Main navigation">
      {items.map(({ name, icon: Icon }) => <button key={name} type="button" onClick={() => onNavigate(name)} className={`nav-item${page === name ? ' active' : ''}`} aria-current={page === name ? 'page' : undefined} title={name}><Icon aria-hidden="true"/><span className="nav-label">{name}</span></button>)}
    </nav>
    <svg className="hex-art" viewBox="0 0 230 340" aria-hidden="true"><g fill="none" strokeWidth="1.5"><path d="M97 6 148 35v59l-51 29-51-29V35Z"/><path d="m97 123 51 29v59l-51 29-51-29v-59Z"/><path d="m97 241 51 29v59l-51 29-51-29v-59Z"/><path d="m-4 65 51 29v59l-51 29-51-29V94Z"/></g></svg>
    <div className="side-footer"><div className="footer-mark">FLORIX ENERGY</div><div className="footer-tagline">Empower The World</div></div>
  </aside>;
}
