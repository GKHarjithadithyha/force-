# Performance run (M10)

Budget from Architecture section 14: decode and calculate **under 0.1 ms per sample**, constant time, no growth with session length.

Test: [packages/worker/test/perf.test.ts](../packages/worker/test/perf.test.ts). One simulated hour of 90 steps/min walking is pushed through the real `Pipeline` (decoder, sequence check, calculation engine M1-M19, step detector, minute buckets, clock-drift check, chart-point callback). Run it yourself:

```
FORCE_PERF_REPORT=perf.json npx vitest run packages/worker/test/perf.test.ts
```

## Results (Node 24, Windows 11, one core, 15 Nov 2026)

| Rate | Samples | Total | Mean per sample | Worst 1000-sample batch | First vs last quarter of the hour | Snapshot (10 Hz) | Steps found |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50 Hz | 180 001 | 338 ms | **0.0019 ms** | 0.0196 ms | 0.0026 / 0.0012 ms | 0.026 ms | 5 400 (exact) |
| 100 Hz (DCR rate) | 360 001 | 481 ms | **0.0013 ms** | 0.0213 ms | 0.0017 / 0.0013 ms | 0.007 ms | 5 400 (exact) |

That is about 50 times under budget at 50 Hz and 75 times at 100 Hz; the whole hour is processed in under half a second. Time per sample does not grow over the hour (the last quarter is no slower than the first). The test asserts all of this, so a regression fails CI.

## What this does and does not show

- **Measured:** engine cost per sample and per snapshot, in Node. The engine has no DOM, so the number carries to the browser worker; absolute figures will differ by device.
- **Not measured here (needs a browser and ideally a phone):** structured-clone cost of the 10 Hz messages, IndexedDB write latency in a real browser (storage tests use fake-indexeddb, which is much slower than the real thing but proves correctness), canvas frame time (frontend), and the 60-minute run on the real unit (Phase 1 gate). The hardware-in-the-loop run is in [BENCH_TEST.md](BENCH_TEST.md).
- Memory: the engine holds constant state per session (heap growth about 1 MB for an hour at 50 Hz, mostly the test's own counters).
