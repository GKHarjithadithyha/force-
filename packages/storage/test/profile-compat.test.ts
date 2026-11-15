import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, Pipeline } from '@force/engine';
import type { SessionBackup } from '@force/engine';
import { simulate } from '@force/simulator';
import { ForceDatabase, Store } from '../src/index.js';

let n = 0;
const mk = () => new Store(new ForceDatabase(`compat-${n++}`));
const { minInputV: _newField, ...OLD_PROFILE } = DEFAULT_PROFILE; // what the previous version saved

describe('data written before minInputV existed keeps working', () => {
  it('a stored profile without minInputV is completed with the default', async () => {
    const store = mk();
    await store.db.profiles.put({ id: 'default', profile: OLD_PROFILE as never, savedAt: 1 });
    const p = await store.getProfile();
    expect(p.minInputV).toBe(1);
    expect(p.stepThresholdW).toBe(DEFAULT_PROFILE.stepThresholdW);
  });

  it('a session backup from the previous version imports and reprocesses', async () => {
    const a = mk();
    const pipe = new Pipeline(
      {
        source: 'device',
        deviceId: 'FORCE-OLD',
        profile: DEFAULT_PROFILE,
        deviceSensorLimitMa: 3200,
        priorEnergyWh: 0,
        priorSteps: 0,
        checkClockDrift: false,
      },
      a.sink(),
    );
    for (const p of simulate({ cadenceSpm: 90 }, 10_000)) {
      pipe.pushPacket(p.bytes, 1_700_000_000_000 + p.arrivalOffsetMs);
    }
    pipe.close();
    await a.flush();
    const id = (await a.listSessions())[0]!.id;
    const backup = JSON.parse(await (await a.exportSessionJson(id)).text()) as SessionBackup;
    backup.profile = OLD_PROFILE as never; // as an older export would have it

    const b = mk();
    const imported = await b.importSessionJson(JSON.stringify(backup));
    expect(imported.steps).toBe((await a.listSessions())[0]!.steps);
    expect((await b.getSessionSteps(imported.id)).length).toBe(imported.steps);
  });
});
