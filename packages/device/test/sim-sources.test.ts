import { describe, expect, it } from 'vitest';
import type { SessionBackup } from '@force/engine';
import { DemoSource, FakeClock, ReplaySource } from '../src/index.js';
import { makeBackup } from './backup.js';
import { recorder } from './fakes.js';

describe('DemoSource', () => {
  it('announces a DEMO device first, then streams packets at the chosen rate on the clock', async () => {
    const clock = new FakeClock();
    const src = new DemoSource({ cadenceSpm: 90, sampleRateHz: 50 }, clock);
    const rec = recorder();
    await src.start(rec);
    expect(src.kind).toBe('demo');
    expect(rec.readyCalls[0]!.deviceId).toBe('DEMO');
    expect(rec.readyCalls[0]!.deviceInfo!.sampleRateHz).toBe(50);
    expect(rec.log[0]).toBe('state:connecting');
    expect(rec.log.indexOf('ready')).toBeLessThan(rec.log.indexOf('packet'));
    clock.advance(2000);
    expect(rec.packets.length).toBe(101); // 50 Hz x 2 s + the first
    expect(rec.stateNames()).toEqual(['connecting', 'streaming']);
    // arrival times follow the clock
    expect(rec.packets[0]!.arrivalMs).toBe(clock.now() - 2000);
    expect(rec.packets.at(-1)!.arrivalMs).toBe(clock.now());
    await src.stop();
    expect(rec.stateNames().at(-1)).toBe('idle');
    expect(clock.pendingTimers).toBe(0);
  });

  it('injected faults show up: a 3 s stale window gives stale then streaming again', async () => {
    const clock = new FakeClock();
    const src = new DemoSource({}, clock);
    const rec = recorder();
    await src.start(rec);
    clock.advance(2000);
    src.inject({ kind: 'stale', durationMs: 3000 }, 1000);
    clock.advance(10_000);
    const names = rec.stateNames();
    expect(names).toContain('stale');
    expect(names.at(-1)).toBe('streaming');
    expect(names.indexOf('stale')).toBeGreaterThan(names.indexOf('streaming'));
  });

  it('stop() is safe twice and stops all timers', async () => {
    const clock = new FakeClock();
    const src = new DemoSource({}, clock);
    await src.start(recorder());
    await src.stop();
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });
});

describe('ReplaySource', () => {
  it('replays the recorded packets at their original timing, then goes idle', async () => {
    const clock = new FakeClock();
    const src = new ReplaySource(makeBackup(10_000), {}, clock);
    const rec = recorder();
    await src.start(rec);
    expect(src.kind).toBe('replay');
    expect(rec.readyCalls[0]!.deviceId).toBe('FORCE-A1B2');
    expect(rec.readyCalls[0]!.deviceInfo!.firmwareVersion).toBe('1.0.0');
    expect(rec.readyCalls[0]!.deviceInfo!.sampleRateHz).toBe(20);
    clock.advance(5000);
    expect(rec.packets.length).toBe(101); // half-way
    expect(rec.stateNames().at(-1)).toBe('streaming');
    clock.advance(6000);
    expect(rec.packets.length).toBe(201); // all of them, no more
    expect(rec.stateNames().at(-1)).toBe('idle');
    expect(clock.pendingTimers).toBe(0);
    // bytes are the recorded ones, in order
    const first = new DataView(rec.packets[0]!.buf);
    const last = new DataView(rec.packets.at(-1)!.buf);
    expect(first.getUint16(0, true)).toBe(0);
    expect(last.getUint16(0, true)).toBe(200);
  });

  it('plays faster at speed 4', async () => {
    const clock = new FakeClock();
    const src = new ReplaySource(makeBackup(8000), { speed: 4 }, clock);
    const rec = recorder();
    await src.start(rec);
    clock.advance(2100);
    expect(rec.packets.length).toBe(161);
    expect(rec.stateNames().at(-1)).toBe('idle');
  });

  it('rejects a file that is not a valid backup with a plain message', () => {
    expect(() => new ReplaySource('not json')).toThrow(/valid JSON/);
    expect(() => new ReplaySource('{"format":"x"}')).toThrow(/session backup/);
    const bad = JSON.parse(makeBackup(2000)) as SessionBackup;
    bad.chunks[0]!.count = 99999;
    expect(() => new ReplaySource(JSON.stringify(bad))).toThrow(/sample count/);
  });

  it('can be stopped part-way and delivers nothing afterwards', async () => {
    const clock = new FakeClock();
    const src = new ReplaySource(makeBackup(10_000), {}, clock);
    const rec = recorder();
    await src.start(rec);
    clock.advance(2000);
    await src.stop();
    const n = rec.packets.length;
    clock.advance(20_000);
    expect(rec.packets).toHaveLength(n);
    expect(rec.stateNames().at(-1)).toBe('idle');
  });
});
