# F.O.R.C.E. Firebase Firestore setup

Firestore is an **extra** cloud copy of F.O.R.C.E data. The laptop stays the primary receiver and the only place calculations run. When the cloud is unreachable, nothing changes locally. Finished sessions upload when it comes back.

Status on 16 Nov 2026:
- The code is done and tested.
- **The Firebase project has not been set up.** The steps in section 6 are yours to do.

---

## 1. How it fits the existing system

The dashboard has no back-end server. Everything below "existing" runs inside Chrome or Edge on the laptop:

```
 ESP32 + INA219 ──BLE (15-byte packets, 20 Hz, protocol unchanged)──┐
                                                                     ▼
 ┌──────────────────────────── Chrome / Edge on the laptop ─────────────────────────────┐
 │  Web Bluetooth ─► Web Worker: decoder ─► pipeline (steps, energy, minutes) ─► Dexie   │  existing,
 │                                                    │                    IndexedDB "force"│  unchanged
 │                                                    ▼                         │         │
 │                                         dashboard (live + history)            │ read    │
 │                                                                               ▼ only    │
 │                       @force/cloud SyncClient: finished real-device sessions,         │  new
 │                       live status every 30 s, upload progress in IndexedDB "force-sync"│
 └───────────────────────────────────────────────┬──────────────────────────────────────┘
                                                 │ HTTP POST JSON to 127.0.0.1:8787
                                                 ▼
 ┌────────────── local sync agent (Node, this laptop, npm run cloud:agent) ─────────────┐
 │  serves the dashboard (fedfront/out) + /api/sync/v1/*                                 │  new
 │  checks the pairing token, validates every payload ─► maps to documents ─► Firebase Admin SDK (service-account) │
 └───────────────────────────────────────────────┬──────────────────────────────────────┘
                                                 ▼ HTTPS
                                     Cloud Firestore (your project)
                                                 ▲ read only (security rules)
                                  public website / Android app / signed-in readers
```

The flow follows the brief: ESP32, local system, existing calculation engine, existing local database, Firestore. The difference is where the "local server" sits. The data is received and calculated in the browser. The new agent is a small local process whose only jobs are to hold the Firebase key and write Firestore.

**Firestore is never on the live path.** The browser reads the local database after the engine has stored the data. If the agent or the internet is down:
- recording, charts and exports are unaffected;
- the sync client backs off and retries: 2 s, doubling, capped at 5 min.

---

## 2. Firestore collections

All documents carry `schemaVersion: 1` and `syncedAt` (the server time of the last write). Timestamps are Firestore `Timestamp`s made from the existing UTC epoch-millisecond values, with no rounding.

| Collection | Document id | One document per | Who can read |
| --- | --- | --- | --- |
| `devices` | `{deviceId}`, e.g. `FORCE-71B6` | ESP32 tile | anyone |
| `liveStatus` | `{deviceId}` | ESP32 tile: the latest dashboard state | anyone |
| `dailySummaries` | `{deviceId}_{YYYY-MM-DD}` | tile per local day | anyone |
| `sessions` | the existing session id, e.g. `FORCE-71B6-mhz3k2a1` | recording session | readers with the `forceReader` claim |
| `footsteps` | the engine's existing step key `{deviceId}_{UTC time}` | detected step | readers with the `forceReader` claim |
| `energyMinutes` | `{sessionId}_{epochMinute}` | clock minute of a session | readers with the `forceReader` claim |
| `dataGaps` | `{sessionId}_{startMs}` | gap in a session | readers with the `forceReader` claim |
| `deviceConfigs` | `{deviceId}` | ESP32 tile: **private** settings profile and installation site | readers with the `forceReader` claim |

Flat top-level collections, each with `deviceId` and `sessionId` fields, make "all devices" and "one session" queries simple.

### Fields

Values are grouped so that measured, calculated and estimated values are never confused:
- **measured:** reported by the device;
- **calculated:** by the existing engine;
- **estimated:** calculated with a placeholder or assumed factor.

**`devices/{deviceId}`**
- `deviceId`, `name`, `firmwareVersion`: from the Device Info characteristic.
- `info.sampleRateHz` (Hz) and `info.sensorLimitMa` (mA): Device Info.
- `lastSeenAt`, `createdAt` (first write only), `syncedAt`.
- The public document has **no** `profile` and **no** `site`. They live in `deviceConfigs`.

**`deviceConfigs/{deviceId}`** (private)
- `profile`: the engine's settings profile (thresholds, emission factor and score weights). Its factors are **placeholders** until agreed.
- `site`: `{ id, name }` from `FORCE_SITE_ID` and `FORCE_SITE_NAME`, or `null`.

**`liveStatus/{deviceId}`** is the latest state, so a website or the Android app needs no history reads. It is written at most every `FORCE_SYNC_LIVE_INTERVAL_S` seconds (default 30) while the device is connected, plus once on every connection change.
- `connection`, `sessionId`, `sampleAt`, `lastPacketAt`, `measurementValid`, `inputPresent`, `generating`.
- `measured`: `{ voltageV` (V), `currentMa` (mA), `powerW` (W) `}`. It is `null` unless the newest sample is a valid measurement, the same rule the dashboard uses.
- `link`: `{ rssiDbm, sampleRateHz }`.
- `calculated`: `{ sessionEnergyWh, totalEnergyWh` (Wh), `avgPowerW, peakPowerW` (W), `steps, cadenceSpm, energyPerStepJ` (J) `}`.
- `estimated`: `{ co2AvoidedKg, ledHours, phoneCharges, kcal, sustainabilityScore }`, which use placeholder factors.
- `quality`: `{ lostPackets, droppedPackets, recordedMs, excludedGapMs }`.
- `alerts[]`: `{ kind, severity, since, message }`.

**`sessions/{sessionId}`** (all values calculated)
- `deviceId`, `source` (always `device`), `status` (`closed` or `interrupted`), `name`, `firmwareVersion`.
- `startedAt`, `endedAt`, `durationMs`.
- `steps`, `energyWh` (float, for display) and `energyNj2` (**exact**, a decimal string of doubled nanojoules).
- `peakPowerW`, `recordedMs`, `bridgedMs`, `excludedGapMs`.
- `counts`: `{ steps, minutes, gaps }`, the number of child documents uploaded.

**`footsteps/{stepId}`**
- `stepId`, `deviceId`, `sessionId`, `stepNumber`, `at`.
- `measured`: `{ voltageV, currentMa }` at the trigger sample.
- `calculated`: `{ peakW, avgW, energyJ, durationMs }`.

**`energyMinutes/{sessionId}_{minute}`**
- `minute` (epoch minute index) and `minuteStart`.
- `energyNj2`: **exact integer**. Joules = `energyNj2 / 2e9`.
- `energyJ`: display only.
- `recordedMs`, `peakPowerUw` (integer µW), `peakPowerW`, `steps`, `samples`, `gapMs`.

**`dailySummaries/{deviceId}_{date}`**
- `date`, `timeZone` (IANA name), `dayStart`, `dayEnd`.
- `steps`, `energyWh`, `energyNj2` (exact string), `recordedMs`, `peakPowerW`, `sessions`.
- `estimated`: `{ co2AvoidedKg, emissionFactorKgPerKwh }`.
- `computedAt`.

**`dataGaps/{sessionId}_{startMs}`**
- `start`, `end`, `durationMs`.
- `cause`: `lost_packets`, `link_down`, `device_restart` or `stale`.

### Precision and time zone rules

**Energy**
- The engine integrates energy as exact integers. Each minute bucket's `energyNj2` is stored unchanged as a Firestore integer. One minute is always below 2^53.
- Session and daily totals are summed as **BigInt** and stored as a decimal **string**, because Firestore cannot store a BigInt.
- To get exact joules, sum the minute integers as BigInt, then divide by 2e9.

**Daily summaries**
- They use the dashboard's existing local-day rule: local midnight to the next local midnight on the laptop that recorded the data.
- The values come from the existing `getTotals` aggregation, limited to the one device. Real-device sessions only.
- The zone used is stored in `timeZone`.
- A summary is recomputed from the full local data and overwritten each time one of its sessions is uploaded. This makes it safe to resend.

### Indexes

`firestore.indexes.json` holds the composite indexes for the expected queries:
- sessions of a device, newest first;
- footsteps, minutes and gaps of a session, in time order;
- footsteps and minutes of a device, newest first;
- daily summaries of a device, newest first.

Use `limit()` with `startAfter()` for pagination. The rules require a `limit` on every list query (see section 5).

---

## 3. Existing model to Firestore mapping

| Existing (where) | Firestore | Notes |
| --- | --- | --- |
| `DeviceInfo` + `DeviceRow.lastSeen` (`packages/contracts`, `packages/storage/src/db.ts`) | `devices` | the `DeviceProfile` and site go to the private `deviceConfigs` |
| `LiveSnapshot` (`packages/contracts`) | `liveStatus` | throttled; device source only |
| `SessionSummary` / `SessionRow` (`packages/contracts`, `db.ts`) | `sessions` | closed or interrupted, `source: 'device'` only |
| `StepEvent` / `StepRow` (`packages/contracts`, `db.ts`) | `footsteps` | only when `FORCE_SYNC_FOOTSTEPS=on`; the id is the engine's idempotency key |
| `MinuteBucket` / `MinuteRow` (`packages/engine/src/session.ts`, `db.ts`) | `energyMinutes` | integer energy kept exactly |
| `GapRecord` / `GapRow` | `dataGaps` | |
| `RangeTotals` from `Store.getTotalsExact` (`packages/storage/src/store.ts`) | `dailySummaries` | same aggregation as `getTotals` |
| `ChunkRow` (raw one-second samples) | **not uploaded** | large, and no requirement yet; still exportable locally |

---

## 4. How synchronisation works

**Done locally**
1. **Pending work is derived, not queued.** Every 15 s, and when the browser comes back online, the client lists the completed real-device sessions in IndexedDB `force`. Each is compared with its saved upload progress in IndexedDB `force-sync`.
2. **Progress is recorded only after the agent confirms the write.** For each session:
   - Send `records` in chunks of at most 400 (footsteps only when enabled, then minutes, then gaps), saving a cursor after each confirmed chunk.
   - Then send `commit`: the device, the daily summaries and the session document, in one atomic Firestore batch. The session document is written last.
3. **Idempotent.** Every document id is stable and every write is a full `set`. Retries, restarts or a lost `force-sync` database cause re-writes of identical documents, never duplicates.
4. **Changes**
   - A rename rewrites only the session document.
   - A recomputed session (new thresholds) first sends `reset`, which deletes its old footsteps, minutes, gaps and session document, then uploads again.

**Failures and restarts**
5. **Failures**
   - Network, agent or Firestore errors: back-off with jitter, 2 s doubling to 5 min.
   - Data the agent rejects as invalid (HTTP 400): parked for 1 hour, shown as "Sessions refused", and never retried in a loop.
6. **Restarts and crashes:** a session cut off by a closed tab is marked `interrupted` by the existing start-up recovery, then uploaded. Interrupted uploads resume from the last confirmed chunk.
7. **Shutdown:** Ctrl+C on the agent stops new requests, waits up to 15 s for writes in flight and closes Firestore. Anything unfinished is resent later.

**What is never sent**
8. **Never synced:**
   - demo, replay and mock data, blocked at four layers:
     - mock mode creates no sync client;
     - only the `force` database is read;
     - only `source: 'device'` is selected;
     - the agent rejects anything else;
   - open sessions;
   - raw sample chunks.

**Visibility**
9. **Status:** the Connection screen shows a **Cloud Sync** panel when sync is on: status, synced, pending and refused counts, last upload, next retry, live status and last error.
   - The agent logs every failure and retry, never key material.
   - `GET http://127.0.0.1:8787/api/sync/v1/health` reports the Firestore state, write and failure counts, and the last error. Without the pairing token it only answers `ok`.

---

## 5. Security model

- **The only secret is the service-account JSON file.**
  - It stays on the laptop, outside the repository.
  - Only the agent reads it.
  - It is never in the browser bundle, `NEXT_PUBLIC_` variables, Git or chat.
  - `.gitignore` excludes `.env.cloud`, `secrets/` and `*service-account*.json`.
- **Pairing token.** Every agent call except the static dashboard files and a bare `health` check needs `Authorization: Bearer <FORCE_SYNC_TOKEN>`.
  - Create it with `npm run cloud:token` and put the printed line in `.env.cloud`. The agent refuses to start without one (at least 32 characters).
  - Paste it once into the dashboard (**Connection > Cloud Sync**). The dashboard stores it locally. Without it the sync client stays idle and shows "not paired".
  - It is a local secret, not a Firebase credential. Run the command again to rotate it, then restart the agent and re-pair.
- **The agent listens on 127.0.0.1 only.** Because any web page could try to reach a local port, it:
  - checks the `Host` header (blocks DNS rebinding);
  - accepts browser requests only from its own origin plus `FORCE_SYNC_ALLOWED_ORIGINS`;
  - requires `application/json` (forces a CORS preflight);
  - limits bodies to 2 MB;
  - validates every field before writing.
- **Firestore rules (`firestore.rules`):**
  - No client can write anything. The Admin SDK used by the agent bypasses rules, so the agent is the only writer.
  - Anyone can read `devices`, `liveStatus` and `dailySummaries`. A list query must set `limit` of at most 100; a single `get` is always allowed.
  - `deviceConfigs` (settings profile and installation site) is private: readers only.
  - `sessions`, `footsteps`, `energyMinutes` and `dataGaps` need a signed-in user with the custom claim `forceReader: true`, granted with `npm run cloud:grant-reader -- <email>`. Creating an account is not enough. Their list queries need `limit` of at most 500.
  - Every other path is denied.
  - Test the rules with `npm run cloud:test:rules` (needs Java and the Firestore emulator; it never touches a real project).
- **The Firebase web or Android config (`apiKey`, `appId`, …) is not a secret.** Access is controlled by the rules above.

---

## 6. Manual steps you must do

Do them in this order. Nothing here has been done for you.

### Step 1. Create the project
1. Open https://console.firebase.google.com and click **Create a project** (or pick an existing one).
2. Note the **Project ID**: it is shown under the name, and in **Project settings > General**. This is `FIREBASE_PROJECT_ID`, and it is not secret.

### Step 2. Create Firestore
1. Go to **Build > Firestore Database > Create database**.
2. Choose **Standard edition** if asked. The database id stays `(default)` unless you change it.
3. Pick a **location** close to the site. It cannot be changed later.
4. Start in **production mode**. Everything is denied until step 3.

### Step 3. Publish the rules and indexes
- **Console option:**
  1. Go to **Firestore Database > Rules**, replace the text with the contents of `firestore.rules` from this repository, and click **Publish**.
  2. Go to **Indexes > Composite** and create the seven indexes listed in `firestore.indexes.json`.
- **CLI option** (needs a Google login in the browser):
  ```
  npx firebase-tools login
  npx firebase-tools deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
  ```

### Step 4. Create the service-account key (secret)
1. Go to **Project settings** (gear icon) **> Service accounts > Firebase Admin SDK > Generate new private key**, and confirm. A JSON file downloads.
2. Move it **outside the repository**, for example `C:\Users\Admin\.force\firebase-service-account.json`. Do not open it in shared tools, paste it anywhere, or commit it.
3. Optional, least privilege: the default Admin SDK account can do much more than write Firestore.
   - In **Google Cloud Console > IAM & Admin > Service accounts**, create an account with only the **Cloud Datastore User** role.
   - Create a JSON key for it and use that file instead.

### Step 5. Configure the agent
Copy `D:\FED\.env.cloud.example` to `D:\FED\.env.cloud`. That file is git-ignored. Then set:

| Variable | File | Value | Where to find it | Secret? | Used by |
| --- | --- | --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `D:\FED\.env.cloud` | your project id | Console > Project settings > General | no | local agent |
| `GOOGLE_APPLICATION_CREDENTIALS` | `D:\FED\.env.cloud` | full path to the JSON from step 4 | the file you saved | the **file** is secret; the path is not | local agent |
| `FIRESTORE_DATABASE_ID` | `D:\FED\.env.cloud` | empty, unless you named the database | Firestore Database page | no | local agent |
| `FORCE_SYNC_TOKEN` | `D:\FED\.env.cloud` | the output of `npm run cloud:token` | you generate it | **yes** (local) | local agent; also pasted once into the dashboard |
| `FORCE_SYNC_FOOTSTEPS` | `D:\FED\.env.cloud` | `off` (default) or `on` | n/a | no | local agent |
| `FORCE_SYNC_LIVE_INTERVAL_S` | `D:\FED\.env.cloud` | `30` (default), 10 to 600 | n/a | no | local agent |
| `FORCE_SYNC_PORT` | `D:\FED\.env.cloud` | `8787` (default) | your choice, 1024 to 65535 | no | local agent |
| `FORCE_SYNC_STATIC_DIR` | `D:\FED\.env.cloud` | empty (`fedfront/out`), or `off` | n/a | no | local agent |
| `FORCE_SYNC_ALLOWED_ORIGINS` | `D:\FED\.env.cloud` | empty; `http://localhost:3000` only when using `next dev` | n/a | no | local agent |
| `FORCE_SITE_ID`, `FORCE_SITE_NAME` | `D:\FED\.env.cloud` | optional, set both or neither | your installation | no | local agent |

Then enable the browser side:

| Variable | File | Value | Secret? | Used by |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_CLOUD_SYNC_URL` | `D:\FED\fedfront\.env.local` (create it; it is git-ignored) | `/api/sync/v1` | no | dashboard (built in) |

Never set `FIREBASE_PRIVATE_KEY` or paste key contents into any `.env` file. The agent refuses to start if it finds one.

### Step 6. Check, build and run
From `D:\FED`:
```
npm run cloud:token          # once: prints FORCE_SYNC_TOKEN=...; put it in .env.cloud
npm run cloud:check          # validates .env.cloud and the key file, then reads Firestore; exit 0 = OK
npm run web:build            # rebuild the dashboard so NEXT_PUBLIC_CLOUD_SYNC_URL is included
npm run cloud:agent          # serves http://127.0.0.1:8787 and the sync API; Ctrl+C to stop
```
Open **http://127.0.0.1:8787** in Chrome or Edge. Web Bluetooth works there because 127.0.0.1 counts as a secure origin. Open **Connection > Cloud Sync** and paste the token once. Connect to the tile as usual. Use this address from now on: the old `serve-static` preview on 8080 does not sync.

Development with `next dev`:
- set `FORCE_SYNC_ALLOWED_ORIGINS=http://localhost:3000` in `.env.cloud`;
- set `NEXT_PUBLIC_CLOUD_SYNC_URL=http://127.0.0.1:8787/api/sync/v1` in `fedfront/.env.local`;
- run `npm run cloud:agent` and `npm run dev -w fedfront`.

### Step 7. Optional: readers of the detailed history
1. Go to **Authentication > Get started > Sign-in method** and enable **Email/Password**.
2. Go to **Authentication > Users > Add user** for each person.
3. Run `npm run cloud:grant-reader -- person@example.com`. Use `--revoke` to remove access.
4. The person must sign in again before the claim takes effect.

---

## 7. Verify that data reaches Firestore

1. `npm run cloud:check` prints `Firestore connection OK` and exits 0.
2. While the agent runs, `curl -H "Authorization: Bearer <FORCE_SYNC_TOKEN>" http://127.0.0.1:8787/api/sync/v1/health` returns `"firestore":"ok"`.
3. Connect the tile at http://127.0.0.1:8787. Within about 30 s, **Firestore Database > Data > liveStatus > FORCE-xxxx** appears and updates.
4. Walk on the tile, then press **Disconnect**. Within about 15 s the Connection screen's Cloud Sync panel shows `Sessions synced: 1` and `Sessions pending: 0`. Firestore then has:
   - `sessions/<id>`;
   - its `energyMinutes` and `dailySummaries/<device>_<today>` (and `footsteps` only if `FORCE_SYNC_FOOTSTEPS=on`);
   - `devices/<device>` and the private `deviceConfigs/<device>`.
5. Cross-check:
   - the session's `steps` matches the Sessions screen;
   - `dailySummaries.steps` matches the Overview "today" value for that device.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Configuration: FIREBASE_PROJECT_ID is missing` | `.env.cloud` is not at `D:\FED\.env.cloud`, or the variable is empty. |
| `service-account file belongs to project "x"` | The key is from another project; download one from the right project. |
| `Firestore permission denied …` | Firestore is not created yet (step 2), or the custom service account lacks **Cloud Datastore User**. |
| `Firestore authentication failed` | The key was deleted or revoked; create a new one (step 4). |
| `Firestore unavailable: … ECONNREFUSED` / `ETIMEDOUT` | No internet, or a proxy is blocking it. Local recording continues; uploads resume by themselves. |
| Panel says **Agent unreachable, retrying** | The agent is not running, or the dashboard was built without the right `NEXT_PUBLIC_CLOUD_SYNC_URL`. Start `npm run cloud:agent` and open http://127.0.0.1:8787. |
| No Cloud Sync panel at all | Sync is off in this build: set `NEXT_PUBLIC_CLOUD_SYNC_URL` in `fedfront/.env.local`, then run `npm run web:build`. Mock mode never shows it. |
| `Origin not allowed` in the agent log | The dashboard is served from another address; add that origin to `FORCE_SYNC_ALLOWED_ORIGINS`. |
| **Sessions refused** > 0 | The agent rejected the data as invalid; the reason is in the panel and the agent log. It is retried after 1 hour or when the session changes. |
| `MetadataLookupWarning` on start | Only with the emulator (no key file); harmless. |
| Website gets `Missing or insufficient permissions` on sessions | Expected without the `forceReader` claim (step 7). |

---

## 9. Reading the data from the website and the Android app

1. In **Project settings > General > Your apps**, add a **Web** app and an **Android** app (package name required). Copy the generated config into those apps. It is not secret.
2. Public reads (`devices`, `liveStatus`, `dailySummaries`) need no sign-in, but every list needs `limit(100)` or less. The exact REST paths, field table, freshness rules and error handling are in `.agent-board/CLOUD_READ_SPEC.md`. Web example (Firebase JS SDK v10+):
   ```js
   import { initializeApp } from 'firebase/app';
   import { getFirestore, doc, onSnapshot, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
   const db = getFirestore(initializeApp(firebaseConfig));
   onSnapshot(doc(db, 'liveStatus', 'FORCE-71B6'), (d) => render(d.data()));            // live tile
   const days = await getDocs(query(collection(db, 'dailySummaries'),
     where('deviceId', '==', 'FORCE-71B6'), orderBy('date', 'desc'), limit(30)));        // last 30 days
   ```
   Android (Kotlin): use `Firebase.firestore.collection("liveStatus").document("FORCE-71B6").addSnapshotListener { … }` and the same query shape.
3. History (`sessions`, `footsteps`, `energyMinutes`, `dataGaps`):
   - sign in with Firebase Auth as a user granted `forceReader`;
   - query by `sessionId` or `deviceId` with `orderBy` and `limit` (at most 500);
   - `deviceConfigs` (profile, site) is readable the same way and is never public;
   - paginate with `startAfter(lastDoc)`.
4. Any write from the website or app is refused by the rules, by design.

---

## 10. Decisions and limitations to review

1. **Firebase replaces the Supabase plan** in `FORCE_Dashboard_Tech_Stack.md` (recorded as H-30 in `docs/DECISIONS.md`).
2. **The agent must run, and the dashboard must be opened from it** (http://127.0.0.1:8787), for uploads to happen. Without it everything still works locally, and sessions upload the next time the agent runs.
3. **Footsteps are off by default** (`FORCE_SYNC_FOOTSTEPS=off`), to stay inside the free tier.
   - With `on`, there is one document per footstep: at 100 steps/min about 6,000 writes per walking hour, against 20,000 writes per day on the Spark plan.
   - Live status adds about 120 writes per connected hour at the default 30 s.
   - Minutes, summaries and sessions are always uploaded. Turning footsteps on later does not back-fill sessions already uploaded.
4. **Deleting data locally does not delete it in Firestore**, whether one session or "Delete all data". Delete in the console if needed.
5. **The daily summary time zone** is the recording laptop's. If two laptops in different zones record the same device, their summaries for a "date" use different bounds; each records its `timeZone`.
6. **A daily summary** is refreshed when a session of that day is uploaded. During an open session, use `liveStatus` for today's running values.
7. **A backup restored under a renamed id** (`…-import`) on a laptop whose original was already uploaded would appear as a second session in Firestore.
8. **Estimated values** (CO₂, LED hours, phone charges, score) use the **placeholder** emission factor and score settings in the profile, exactly as on the dashboard.
9. **Not done:**
   - Firestore emulator and rules tests (`npm run cloud:test:rules`): Java is not installed here, so they are skipped and **unverified**. They run when `FIRESTORE_EMULATOR_HOST` is set.
   - A real-project test: it needs your credentials.
10. **There is no Android app in this repository.** Section 9 shows how one should read the data.

---

## 11. Files

- `packages/cloud/`: Firestore model, ids, units, the browser sync client, IndexedDB adapters (no Firebase SDK, no secrets).
- `packages/cloud-agent/`: local agent with config checks, validation, writer, HTTP API, static server, `grant-reader`, `token` (pairing token generator).
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` (emulator ports 8085 and 9099).
- `.env.cloud.example` (agent) and `fedfront/.env.example` (`NEXT_PUBLIC_CLOUD_SYNC_URL`).
- Changed:
  - `packages/storage/src/store.ts` (additive `getTotalsExact`, `getSessionMinutes`);
  - `fedfront/engine/index.ts`;
  - `fedfront/components/other-screen.tsx`;
  - the new `fedfront/components/cloud-sync-status.tsx`;
  - `fedfront/next.config.mjs`, `fedfront/package.json`, root `package.json`, `.gitignore`.
