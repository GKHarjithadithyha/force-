import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SerwistProvider } from '@serwist/next/react';
import { themeInitScript } from '@/components/theme/theme-script';
import './theme.css';
import './globals.css';
import './dashboard.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'F.O.R.C.E. | Florix Energy',
  description: 'Real-time monitoring of energy generation and system performance',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeInitScript }}/></head><body className={inter.className}><SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === 'development'}>{children}</SerwistProvider></body></html>;
}
