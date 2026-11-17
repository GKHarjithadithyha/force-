import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'F.O.R.C.E Dashboard', short_name: 'F.O.R.C.E', description: 'Florix Energy real-time power and tile dashboard',
    start_url: '/', display: 'standalone', background_color: '#05070d', theme_color: '#0b0d1a', orientation: 'any',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  };
}
