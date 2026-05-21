# Parallel Lock Validation Plan

**Branch goal:** fix obol-api **502s** on large locks and cut validation time vs
published **2.12.0**, without native BLS (`blst`).

**Status:** implementation on `fix/lock-validation-event-loop` — profiling helpers
and extra perf scripts removed; core worker + batch-BLS path kept.

---

## Problem

`validateClusterLock` is CPU-bound on pure-JS BLS (`@noble/curves`). Large locks
(500–1000 validators, thousands of partial deposits) can take **~60s+** of CPU
work. When that runs on the **obol-api main thread**, the Node event loop is
starved → health checks fail → **502 for all users**.

`Promise.all` on the main thread does not help: BLS in noble is synchronous CPU
work. Real fixes are **worker threads** and **batching**, not `setImmediate`
yields.

**We use `@noble/curves` intentionally** (no `blst` / native addon): portable
CJS+ESM+browser, no `node-gyp`, audited pure TS. Perf ceiling is lower than
native BLS; parallelism is how we stay within HTTP timeouts.

### Why 2.12.0 regressed (~103s on 1k lock)

1. Per-deposit BLS verified **twice** (inside `verifyDepositData` and again in batch).
2. No **whole-lock validation worker** — CPU work blocked the API process.
3. Share-binding + batch paths added cost without the batch dedup fix.

This branch: **~57s** on the same lock, non-blocking for HTTP when CJS workers load.

---

## Measured on real 1k lock (4 operators, 2000 partial deposits, v1.10.0)

| Bottleneck (approx.) | Share of ~57s |
|---|---|
| Batch BLS (deposits + builders) | ~60% |
| Share-binding (Lagrange + extras) | ~33% |
| Lock `signature_aggregate` (pubkey aggregation + one verify) | ~5% |
| Definition signatures, hashes, rest | ~2% |

Synthetic chunk benchmarks (`test/perf/parallelBench.mjs`, N=500):

| Phase | Sync | Parallel workers | Speedup |
|---|---|---|---|
| Share-binding | ~9s | ~2s | **~4×** |
| Batch BLS verify | ~11s | ~4s | **~3×** |

---

## Two layers of workers (do not confuse them)

| Layer | File | What moves off-thread | Primary win |
|---|---|---|---|
| **1. Validation worker** | `clusterLockValidationWorker.js` | Entire `isValidClusterLock()` | **502 fix** — obol-api main thread stays responsive |
| **2. Chunk workers** | `lockWorker.js` | Share-binding, batch BLS, pubkey aggregation chunks | **Speed** — uses multiple cores *inside* validation |

- Layer 1 alone would still take ~60–90s on a 1k lock but would not 502 the API.
- Layer 2 alone on the main thread would still 502.
- **We ship both** for obol-api (CJS): responsive API + ~57s validation.

Optional future simplification (not implemented): drop layer 2, keep layer 1 +
`depositBlsCheck` / `verifyBlsChecksParallel` sync fallback — smaller diff,
slower on huge locks, 502 still fixed.

---

## Architecture (current)

```
POST /lock/verify or /lock (obol-api main thread)
    └── validateClusterLock()                    [src/services.ts]
            ├── [≥50 validators, CJS] validateClusterLockInWorker()
            │       └── clusterLockValidationWorker.js
            │               └── isValidClusterLock()   ← layer 1
            └── [<50 or no worker file] isValidClusterLock() on main thread

isValidClusterLock()                             [src/verification/common.ts]
    ├── definition_signatures (ECDSA / Safe RPC)
    ├── definition_hash + lock_hash (SSZ)
    ├── unique DV keys
    └── verifyLockData() → verifyDVV1X6 | v1.7 | v1.8 | v1.10 (v1.10 = v1.8 alias)
            ├── phase1: structure (share count, uniqueness)
            ├── verifySharesBinding()     → lockWorker chunks (layer 2)
            ├── depositBlsCheck + builderBlsCheck → collect BlsSignatureCheck[]
            ├── verifyBlsChecksParallel() → lockWorker chunks (layer 2)
            ├── verifyNodeSignatures()    (ECDSA, sync)
            └── verifyAggregateParallel() → lockWorker chunks (layer 2)
```

### Deposit / builder BLS (readable flow)

1. `depositBlsCheck` / `builderBlsCheck` — structural checks + signing root; return
   `BlsSignatureCheck | null` (type in `src/types.ts`).
2. `verifyBlsChecksParallel(checks)` — verify all deposit/builder signatures **once**
   in batch (not twice like 2.12.0).

Fork domains (`depositDomainForFork`, `builderDomainForFork`) are computed once
per lock in `verifyDVV1X*`, not per deposit.

### `signature_aggregate` — one signature, many pubkeys

Each lock has **one** `signature_aggregate` over `lock_hash`. Verification must
**aggregate all operator public shares** (validators × operators) into one group
key, then verify that single signature.

`verifyAggregateParallel` parallelizes **pubkey aggregation** across chunks when
there are ≥400 keys and CJS workers are available; it does **not** verify multiple
lock signatures. Below the threshold it calls sync `blsVerifyAggregate`. This
step is a small fraction of total time on 1k locks (~5%).

---

## CJS worker path resolution (required for obol-api)

Consumers `require('@obolnetwork/obol-sdk')` → bundled **`dist/cjs/src/index.js`**.
`parallelPool` is inlined there, so runtime `__dirname` is **`dist/cjs/src`**, not
`dist/cjs/src/verification`.

Worker bundles are emitted beside it:

```text
dist/cjs/src/index.js                              ← main entry (bundled)
dist/cjs/src/verification/clusterLockValidationWorker.js
dist/cjs/src/verification/lockWorker.js
```

`getWorkerPath()` in `parallelPool.ts` tries both:

1. `path.join(__dirname, filename)` — standalone `parallelPool.js` entry
2. `path.join(__dirname, 'verification', filename)` — **bundled index (obol-api)**

Without (2), workers are never found → sync validation on the main thread → frozen
API (`/docs` hangs for ~60s). **Always run `yarn build` before publish**; npm
package `files` includes all of `dist/`.

---

## Where it runs (build × outcome)

| Build target | Validation worker (layer 1) | Chunk workers (layer 2) | Outcome |
|---|---|---|---|
| **CJS Node** (obol-api) | ✅ if `verification/*.js` resolves | ✅ same | Full parallel + main thread free |
| ESM Node | ❌ sync fallback | ❌ sync fallback | See "Why ESM is sync" |
| Browser | not emitted | not emitted | Sync only (acceptable) |
| Jest / source | worker file missing | worker file missing | Sync fallback in tests |
| Small lock (`<50` validators) | skipped | may still parallelize inner chunks | Sync whole-lock path |

**Canonical DKG publish flow:**

```
charon --publish --publish-address http://localhost:3001/v1
    → obol-api POST /lock (NestJS CJS, Node 24)
        → @obolnetwork/obol-sdk validateClusterLock (CJS)
            → clusterLockValidationWorker + lockWorker ✅
```

---

## Thresholds (`src/verification/parallelPool.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `MIN_VALIDATORS_FOR_VALIDATION_WORKER` | 50 | Whole-lock validation in dedicated worker (layer 1) |
| `MIN_PARALLEL_VALIDATORS` | 50 | Share-binding uses chunk workers |
| `MIN_PARALLEL_BATCH_PAIRS` | 100 | Batch BLS uses chunk workers |
| `MIN_PARALLEL_AGGREGATE_KEYS` | 400 | Parallel pubkey aggregation for lock aggregate |
| `MIN_KEYS_PER_WORKER_AGG` | 100 | Keys per worker when aggregating pubkeys |
| `MAX_WORKERS` | 8 | Chunk count cap |
| `MAX_CONCURRENT_WORKERS_CAP` | 8 | In-flight worker cap (memory) |
| `VALIDATION_WORKER_TIMEOUT_MS` | 120_000 | Whole-lock worker timeout |
| `WORKER_TIMEOUT_MS` | 60_000 | Per chunk worker timeout |

---

## Files

| File | Role |
|---|---|
| `src/services.ts` | Public `validateClusterLock` — worker first, else sync |
| `src/types.ts` | `BlsSignatureCheck` |
| `src/verification/common.ts` | `depositBlsCheck`, `builderBlsCheck`, `isValidClusterLock` |
| `src/verification/parallelPool.ts` | Chunk pool API + `validateClusterLockInWorker` |
| `src/verification/lockWorker.ts` | Chunk worker: `shareBinding`, `verifyBatch`, `aggregatePubkeys` |
| `src/verification/clusterLockValidationWorker.ts` | Layer-1 worker entry (~20 lines) |
| `src/verification/v1.6.0.ts` … `v1.8.0.ts` | DV verify; v1.10 aliases v1.8 |
| `src/blsUtils.ts` | Noble BLS primitives |
| `tsup.config.ts` | Separate CJS/ESM entries for workers (not in browser bundle) |

**Removed in simplification pass (do not re-add without reason):**

| Removed | Was |
|---|---|
| `lockProfiler.ts` | Opt-in `OBOL_SDK_LOCK_PROFILE=1` phase timings |
| `blsTypes.ts` | Type moved to `src/types.ts` |
| `validationWorker.ts` | Merged into `parallelPool.ts` as `validateClusterLockInWorker` |
| `test/perf/validateLockFile.mjs` | Redundant with `parallelBench.mjs` + `POST /lock/verify` |

Browser build: only `src/index.ts` — no worker entries.

---

## Public API

No breaking changes. `validateClusterLock(lock, safeRpcUrl?)` signature unchanged.

---

## Event loop / 502

`validateClusterLock` calls `validateClusterLockInWorker` when the lock has ≥
50 validators and `getWorkerPath('clusterLockValidationWorker.js')` resolves
(see **CJS worker path resolution** above). That runs all crypto on a
**background thread** so obol-api can still accept health checks and other
requests.

Invalid locks still return **400** from the API; 502 was from **blocking**, not
from validation throwing.

### `validateClusterLockInWorker` outcomes

| Event | Result | `validateClusterLock` behavior |
|---|---|---|
| Worker message valid / invalid | `true` / `false` resolve | Returned to caller (`true` / `false`) |
| Worker **timeout** (120s) | **rejects** `ClusterLockValidationTimeoutError` | Propagates; HTTP APIs → **504** |
| Nested **chunk worker timeout** (60s) inside validation worker | Posts `{ validationTimeoutMs: 60000 }` → parent **rejects** same error | Propagates; HTTP APIs → **504** |
| Worker **error** or non-zero **exit** | `null` | Sync fallback on main thread |
| Worker file not found | `null` | Sync fallback |

Timeout rejects (does not resolve `false`) so gateways distinguish overload/slow crypto from bad signatures (**400**).

Per-chunk timeouts (`runWorker` / `runWorkerAggregatePubkeys` in `parallelPool.ts`) throw
`ClusterLockValidationTimeoutError(WORKER_TIMEOUT_MS)` instead of resolving `false`/`null`.
`clusterLockValidationWorker.ts` forwards that to the main thread via `validationTimeoutMs`;
`isValidClusterLock` re-throws rather than returning `false`.

**HTTP consumers (e.g. obol-api):** catch `ClusterLockValidationTimeoutError` by `name` and respond with **504**, not **400**.

### Concurrent validation cap (DoS mitigation)

| Constant / env | Default | Purpose |
|---|---|---|
| `OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS` | `2` | Max in-flight `validateClusterLock` calls per Node process (`0` = unlimited) |

When at capacity, `validateClusterLock` throws `ClusterLockValidationBusyError` immediately (no queue). obol-api should map to **503**.

---

## Charon local testing (no ngrok)

Ngrok is only needed when Charon (or remote operators) must reach an API that
is not reachable from where Charon runs (e.g. API on laptop, Charon in cloud).

**Same machine, API on host:**

```bash
# obol-api on PORT from .env (e.g. 3001)
charon dkg --publish \
  --publish-address http://127.0.0.1:3001/v1 \
  --publish-timeout 3m
```

**Charon in Docker, API on host:**

```bash
--publish-address http://host.docker.internal:3001/v1
```

**Requirements:**

- MongoDB reachable from obol-api (your `.env` already points at Atlas for dev).
- Cluster **definition** must exist in DB for Launchpad/group flow, or use
  Charon-command solo flow (API creates definition from lock).
- Increase **`--publish-timeout`** for large locks (Charon default **30s** is
  too low for ~60s validation even after these optimizations).

Verify without publishing:

```bash
curl -X POST http://127.0.0.1:3001/lock/verify \
  -H "Content-Type: application/json" \
  -d @cluster-lock.json
```

Link local SDK in obol-api: `"@obolnetwork/obol-sdk": "file:../obol-sdk"`.

---

## Verification coverage

| What | Catches |
|---|---|
| `yarn test` (151 tests) | Crypto correctness, fixtures v1.6–v1.10, helper unit tests |
| `test/verification/parallelPool.spec.ts` | API shape; runs **sync fallback** (no built worker in jest) |
| `node test/perf/parallelBench.mjs` | Real `lockWorker` chunk speedup (after `yarn build`) |
| Manual `POST /lock/verify` on obol-api with linked SDK | HTTP path + layer-1 worker + non-blocking |

**Gap:** no CI job yet that runs `parallelBench.mjs` or a large-lock perf gate.

---

## Why ESM Node is sync

**CJS (obol-api):** fixed via `getWorkerPath` checking `verification/` under
bundled `index.js` `__dirname` (see above).

**ESM Node:** `import` resolves `dist/esm/src/index.js`; worker path resolution
still does not line up with emitted worker files, so both layers fall back to
sync. **obol-api uses CJS `require`** — no action required unless a new ESM-only
consumer needs parallel validation.

---

## Out of scope

- `blst` / native BLS (rejected; noble chosen for portability)
- Web Workers for browser Launchpad
- ESM Node parallelization without tsup / path refactor
- Persistent worker pool reuse (workers spawned per validation)
- Opt-in lock profiling (`OBOL_SDK_LOCK_PROFILE`) — removed
- Sub-20s validation for 1k validators on pure JS BLS without hardware scale-out

---

## How to verify locally

```bash
yarn install
yarn build
yarn test

# Chunk worker speedup (synthetic; needs dist/cjs workers)
node test/perf/parallelBench.mjs

# Optional: noble micro-benchmarks
node test/perf/blsBench.mjs

# obol-api (link local SDK)
# In obol-api package.json: "@obolnetwork/obol-sdk": "file:../obol-sdk"
npm install && npm run start:dev
curl -X POST http://127.0.0.1:3001/lock/verify \
  -H "Content-Type: application/json" \
  -d @/path/to/cluster-lock.json
```

**test/perf:** only `parallelBench.mjs` and `blsBench.mjs` — no `validateLockFile.mjs`.
