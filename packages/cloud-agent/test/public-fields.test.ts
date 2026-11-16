import { afterEach, describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@force/cloud';
import { liveSnapshot } from '../../cloud/test/helpers.js';
import { DEVICE, T0, closeAll, commit, records, startAgent } from './fixtures.js';

afterEach(closeAll);

/** The approved field sets of the three publicly readable collections. */
const PUBLIC = {
  [COLLECTIONS.devices]: [
    'schemaVersion',
    'deviceId',
    'name',
    'firmwareVersion',
    'info',
    'lastSeenAt',
    'createdAt',
    'syncedAt',
  ],
  [COLLECTIONS.dailySummaries]: [
    'schemaVersion',
    'deviceId',
    'date',
    'timeZone',
    'dayStart',
    'dayEnd',
    'steps',
    'energyWh',
    'energyNj2',
    'recordedMs',
    'peakPowerW',
    'sessions',
    'estimated',
    'computedAt',
    'syncedAt',
  ],
  [COLLECTIONS.liveStatus]: [
    'schemaVersion',
    'deviceId',
    'connection',
    'sessionId',
    'sampleAt',
    'lastPacketAt',
    'measurementValid',
    'inputPresent',
    'generating',
    'measured',
    'link',
    'calculated',
    'estimated',
    'quality',
    'alerts',
    'syncedAt',
  ],
};

describe('public documents contain only approved fields (P1, P3, site private)', () => {
  it('devices, dailySummaries and liveStatus', async () => {
    const a = await startAgent();
    expect((await a.post('records', records())).status).toBe(200);
    expect((await a.post('commit', commit())).status).toBe(200);
    const snap = {
      ...liveSnapshot(),
      sessionId: `${DEVICE}-mhz3k2a1`,
      alerts: [
        {
          id: 'x',
          kind: 'no_input',
          severity: 'warning',
          since: T0,
          message: 'Installed at <secret address>',
        },
      ],
    };
    expect((await a.post('live', { deviceId: DEVICE, snapshot: snap })).status).toBe(200);

    for (const [col, allowed] of Object.entries(PUBLIC)) {
      const docs = [...a.docs.col(col).values()];
      expect(docs.length, col).toBeGreaterThan(0);
      for (const d of docs) expect(Object.keys(d).sort(), col).toEqual([...allowed].sort());
    }
    const device = a.docs.col(COLLECTIONS.devices).get(DEVICE)!;
    expect(device.info).toEqual({ sampleRateHz: 20, sensorLimitMa: 3200 });
    const text = JSON.stringify([...Object.keys(PUBLIC)].map((c) => [...a.docs.col(c).values()]));
    expect(text).not.toContain('Florix lab'); // site name is private
    expect(text).not.toContain('lab-1');
    expect(text).not.toContain('emissionFactorKgPerKwh":0.475,"ledWatts'); // no profile
    expect(text).not.toContain('secret address'); // no alert free text
    const live = a.docs.col(COLLECTIONS.liveStatus).get(DEVICE)!;
    expect(live.alerts).toEqual([{ kind: 'no_input', severity: 'warning', since: new Date(T0) }]);

    // the private collection holds the profile and the site
    const config = a.docs.col(COLLECTIONS.deviceConfigs).get(DEVICE)!;
    expect(config.site).toEqual({ id: 'lab-1', name: 'Florix lab, ground floor' });
    expect(Object.keys(config.profile as object)).toContain('stepThresholdW');
  });
});
