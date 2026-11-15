import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SerwistProvider } from '@serwist/next/react';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'F.O.R.C.E. | Florix Energy',
  description: 'Real-time monitoring of energy generation and system performance',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={inter.className}><SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === 'development'}>{children}</SerwistProvider></body></html>;
}
