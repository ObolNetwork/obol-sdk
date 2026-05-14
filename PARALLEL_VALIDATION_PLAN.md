# Parallel Lock Validation Plan

## Problem

`validateClusterLock` is CPU-bound and single-threaded on pure-JS BLS. Large
locks (100+ validators) take 15-30s+ — long enough that obol-api's HTTP
handler times out before validation completes. `Promise.all` does not help,
because BLS in `@noble/curves` is synchronous CPU work; awaiting promises
serializes them. Real parallelism requires worker threads.

## Bottleneck (measured on 4 cores, see `test/perf/parallelBench.mjs`)

| Phase | N=500 sync | N=500 parallel | Speedup |
|---|---|---|---|
| Share-binding (Lagrange + extras) | ~9.0s | ~2.2s | **4.0×** |
| Batch BLS verify (deposit+builder) | ~11.3s | ~3.7s | **3.0×** |
| Aggregate sig + node sigs | <200ms | (not parallelized) | — |

End-to-end on a 500-validator lock: **~20s sync → ~6s parallel**, well clear
of any reasonable HTTP timeout.

## Where it actually runs (build x outcome matrix)

| Build target | Worker path | Outcome | Why |
|---|---|---|---|
| **CJS Node** (obol-api / NestJS) | `dist/cjs/src/verification/lockWorker.js` | **Parallel** ✅ | `__dirname` resolves; `worker_threads` available; everything wires up |
| ESM Node | none | Sync fallback | See "Why ESM is sync" below. |
| Browser (dv-launchpad / Next.js) | none (worker not emitted) | Sync fallback | Browser has no `worker_threads`; would need Web Workers + Next.js bundler config. Out of scope. |
| Source-mode (jest, tsx, ts-node) | resolves but file missing | Sync fallback | The `.js` file isn't there pre-build; `fs.existsSync` check returns false. |
| Small lock (`< MIN_PARALLEL_VALIDATORS`) | available | Sync fallback | Worker spin-up dominates for small inputs (~30-100ms each). |

**Bottom line:** the **canonical DKG publish flow is fully covered**:

```
charon (dkg) -> obol-api (NestJS / CJS / Node 24) -> obol-sdk validateClusterLock (CJS dist)
                                                       └─> parallel ✅
```

Every other path (browser SDK consumers, jest tests, small fixture locks) is
sync, and that's both fast enough and intentional.

## Thresholds

- `MIN_PARALLEL_VALIDATORS = 50` — share-binding needs at least this many
  validators before workers are worth spinning up.
- `MIN_PARALLEL_BATCH_PAIRS = 100` — batch BLS verify threshold.
- `MIN_VALIDATORS_PER_WORKER = 25`, `MIN_PAIRS_PER_WORKER = 50` — minimum
  chunk size to keep workers busy enough to amortize startup.
- `MAX_WORKERS = 8` — soft cap; effective parallelism also bounded by
  `os.cpus().length`.

## Files

- `src/verification/lockWorker.ts` — worker entry. One file, two modes
  (`shareBinding`, `verifyBatch`) dispatched on `workerData.mode`.
- `src/verification/parallelPool.ts` — pool abstraction. Exposes
  `verifySharesBinding` and `verifyBatchParallel`. Each has a sync fallback
  identical in shape to the parallel path.
- `src/verification/v1.6.0.ts` / `v1.7.0.ts` / `v1.8.0.ts` — `verifyDV` is
  structured as Phase 1 (cheap structural pre-checks: count, uniqueness)
  then Phase 2 (parallel share-binding) then existing per-validator data
  collection then parallel batch verify.
- `tsup.config.ts` — three Node entries (`blsUtils`, `parallelPool`,
  `lockWorker`) so they stay separate dist files. Browser build does not
  include the worker entry.

## Public API

No new public surface. `validateClusterLock(lock, safeRpcUrl?)` keeps the
same signature; parallelization is transparent.

## Why ESM is sync (and not "just shim `__dirname` in tsup")

The obvious-looking fix — adding a tsup `banner` that defines `__dirname`
via `import.meta.url` for the ESM build — was tried and **does not work**.
Two compounding problems:

1. `parallelPool.ts` uses `require('node:path')` / `require('node:fs')`
   inside `getWorkerPath()` to keep these imports out of the browser
   bundle. tsup polyfills `require()` in ESM output to throw
   `"Dynamic require of "path" is not supported"`. So even with the
   `__dirname` shim, the function crashes on the first `require()`.
2. tsup splits `parallelPool.ts`'s implementation into a shared chunk
   (`dist/esm/src/chunk-XXXX.js`); the entry `parallelPool.js` is just a
   re-export. The chunk's `__dirname` resolves to `dist/esm/src/`, not
   `dist/esm/src/verification/`, so the worker file lookup misses and
   falls back to sync.

A real ESM fix needs either:
- Refactoring `parallelPool.ts` to use top-level `import` for `node:path`
  and friends (which then either breaks browser builds or needs
  per-build entry shimming),
- Disabling tsup `splitting` for the ESM build (loses code-sharing,
  bigger output),
- Or using `import.meta.url` directly in source, which is ESM-only
  syntax that breaks the CJS build unless gated behind a runtime trick.

None of these are "small". The CJS path covers obol-api (the only known
heavy consumer), so this is left as a documented limitation rather than
a multi-day refactor.

## Caveats / fragility

1. **Noble's `getPublicKey()` returns a Point object, not `Uint8Array`,**
   even though the type declarations claim otherwise. We rely on this
   internally; if a future noble version changes the return shape, the
   `as any` cast in the bench (and any future callers) needs review.
   `Point` instances do **not** survive `workerData` structured clone
   (their class prototype is stripped). Always serialize via `.toBytes()`
   before sending across the worker boundary.
2. **No persistent worker pool.** Each `validateClusterLock` call spawns
   workers fresh and pays ~30-100ms per worker startup. For a single
   call processing hundreds of validators, this is amortized; for
   high-frequency repeated calls on small locks, sync is still chosen by
   the threshold.
3. **No automated test for the actual worker path.** `test/verification/
   parallelPool.spec.ts` exercises the public `verifySharesBinding` and
   `verifyBatchParallel` API with 50-100 input batches — enough to trip
   the parallel threshold — but jest runs from source so the built
   `lockWorker.js` doesn't exist; `getWorkerPath()` returns `null` and
   the tests transparently run the **sync fallback**. They catch:
   - sync-fallback correctness regressions
   - `WorkerInput` shape mismatches at compile time (now typed)
   - API signature drift

   They do **not** catch worker-thread-specific breakage (path
   resolution, structured-clone issues, the worker entry crashing).
   For that, run `node test/perf/parallelBench.mjs` after `yarn build` —
   that is the only thing that exercises the real worker code today.

## Decision record: `require()` in `parallelPool.ts`

`parallelPool.ts` intentionally uses guarded `require('node:*')` calls
inside `try/catch` (with narrow eslint disables) instead of top-level
`import` for `worker_threads`, `os`, `path`, and `fs`.

### Why this works

The current pattern preserves three required behaviors:

1. **Lazy runtime load** - Node-only modules are resolved only when needed.
2. **No static Node import pull-in for browser bundles** - avoids bundler
   statically binding `node:*` in browser output.
3. **Synchronous probing** - callsites stay sync/cheap for environment checks.

Observed runtime behavior:

| Build target | `require('node:worker_threads')` result | Outcome |
|---|---|---|
| CJS Node | Loads real module | Parallel path enabled ✅ |
| ESM Node | tsup dynamic-require shim throws; caught | Sync fallback |
| Browser | shim/unsupported require throws; caught | Sync fallback |

So the runtime behavior is correct across supported targets.

### Why this is not ideal stylistically

- `require()` in modern TS source is less idiomatic than `import()`.
- Each call needs local eslint disables (`no-require-imports` /
  `no-var-requires`), which adds review noise.
- It depends on current tsup ESM dynamic-require behavior (throw + catch).

### Preferred cleanup path (future)

Refactor lazy loaders to dynamic import:

```ts
async function loadWorkerThreads(): Promise<WorkerThreads | null> {
  try {
    return await import('node:worker_threads');
  } catch {
    return null;
  }
}
```

Trade-offs of this refactor:

- **Pros:** idiomatic ESM/CJS-compatible runtime loading; no eslint disables.
- **Cons:** loader/cache flow becomes async (`Promise<Module>` cache), so
  callers need small plumbing changes.
- **Build note:** browser output still needs `node:*` treated as external in
  bundling config so runtime `import()` can fail safely and be caught.

Status today: keep `require()` because it is functionally correct, CI/bench are
green, and it keeps the current sync fallback behavior simple.

## Out of scope (explicit followups)

- Web Workers for browser parallelization (requires Next.js bundler work)
- ESM Node parallelization (would need tsup banner injecting
  `import.meta.url` into the pool)
- Persistent worker pool with idle-timeout reuse
- Parallelizing the aggregate-sig and node-sig checks (not bottlenecks)

## How to verify locally

```bash
yarn install
yarn build           # emits the three dist entries the pool needs
yarn test            # 141 unit tests, all sync (pool tests hit fallback)
node test/perf/parallelBench.mjs   # confirms parallel speedup on dist
```
