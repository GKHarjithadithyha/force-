'use client';

import { CloudDashboard } from '@/components/cloud-dashboard';
import { Dashboard } from '@/components/dashboard';

/** NEXT_PUBLIC_DATA_SOURCE is inlined at build time: the hosted build reads the cloud, the default build runs the local engine. */
const CLOUD = process.env.NEXT_PUBLIC_DATA_SOURCE === 'cloud';

export default function Home() {
  return CLOUD ? <CloudDashboard /> : <Dashboard />;
}
