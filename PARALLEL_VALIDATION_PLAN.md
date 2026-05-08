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
| ESM Node | none | Sync fallback | tsup ESM build has no `__dirname`; no `import.meta.url` plumbing in place. Documented limitation. |
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
3. **No automated test for the parallel path.** Existing fixtures are
   small enough to trip `MIN_PARALLEL_VALIDATORS=50` and run sync. The
   bench (`test/perf/parallelBench.mjs`) is the only thing that exercises
   workers. If the worker breaks, CI stays green.

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
yarn test            # 131 unit tests, all sync (small fixtures)
node test/perf/parallelBench.mjs   # confirms speedup on a real machine
```
