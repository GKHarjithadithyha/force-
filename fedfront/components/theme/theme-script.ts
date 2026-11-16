// No 'use client' here on purpose: app/layout.tsx (a server component) imports this string.
export const THEME_KEY = 'force.theme';

/** Runs in <head> before first paint, so a saved light theme never flashes dark. */
export const themeInitScript = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
