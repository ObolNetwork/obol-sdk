# Parallel Lock Validation Plan

## Problem

`validateClusterLock` is CPU-bound and single-threaded. For large locks (100+ validators) on
pure-JS BLS, total time is in the 15-30s+ range — long enough that obol-api's HTTP handlers
time out before validation completes.

`Promise.all` does not help here: BLS in `@noble/curves` is synchronous CPU work, so awaiting
multiple promises serializes them. Real parallelism requires worker threads.

## Bottleneck breakdown (estimated, 500 validators, 4-of-6)

| Phase | Cost | Parallelizable |
|---|---|---|
| Per-validator Lagrange + extra-share check | ~10-20s (10k G1 muls) | Yes — embarrassingly parallel by validator |
| `blsVerifyMultiple` (2k deposit+builder pairings, batched) | ~5-10s | Yes — split into per-worker batches |
| `blsVerifyAggregate` (single aggregate sig over lock_hash) | <100ms | No (single op, fast) |
| `verifyNodeSignatures` (N secp256k1) | <50ms | No (small, fast) |

So we parallelize the per-validator block + split the batch pairing across workers. Aggregate
sig + node sigs stay on the main thread.

## Approach

1. **Node.js**: use `worker_threads`. Pool of `min(os.cpus().length, ceil(V/25), 8)` workers,
   only when `validators.length >= 50` (otherwise the spin-up cost wins).
2. **Browser**: out of scope for first cut. Falls back to current sync path. Web Workers
   would need separate bundler config (Next.js url loader etc.) — followup.
3. **Restricted environments** (no `worker_threads`, no `Worker`): falls back to sync.

## Worker contract

Input: `{ validators, context }` where context has the per-version data the worker needs:
operatorCount, threshold, fork_version, withdrawal_addresses, fee_recipient_addresses,
compounding flag, version tag.

Per-validator the worker does:
- Lagrange reconstruction on first `threshold` shares → must equal `distributed_public_key`
- `blsVerifyExtraShares` for shares beyond threshold
- Builds deposit-data + builder-registration signing roots
- Aggregates per-chunk deposit + builder signatures and runs `blsVerifyMultiple` on its own slice

Output: `{ ok: boolean, pubShares: Uint8Array[][] }` — main thread only needs the per-validator
public shares to feed into the global aggregate-sig check.

## Files

- `src/verification/lockWorker.ts` — worker entry point. Imports verification helpers, runs the
  per-chunk work. Bundled as a separate tsup entry so it lands in
  `dist/cjs/src/verification/lockWorker.js` and the ESM equivalent.
- `src/verification/parallelPool.ts` — pool abstraction. Detects `worker_threads`, manages
  worker lifecycle, exposes `runParallel(validators, context)` that returns the merged result.
- `src/verification/v1.6.0.ts`, `v1.7.0.ts`, `v1.8.0.ts` — `verifyDV` functions call into the
  pool when the pool is available + `validators.length >= MIN_PARALLEL_VALIDATORS`. Otherwise
  the existing sync code path runs unchanged.
- `tsup.config.ts` — second entry for the worker file in CJS + ESM Node builds. Browser build
  excludes it.

## Public API

No new public surface. `validateClusterLock(lock, safeRpcUrl?)` keeps the same signature.
Parallelization is transparent.

## Testing

- Unit tests still pass (sync fallback for the existing fixture sizes).
- New benchmark in `test/perf/lockValidation.bench.ts` (excluded from `yarn test`):
  - Generates a synthetic 500-validator lock (deterministic, seeded).
  - Times sync vs parallel.
  - Asserts both produce the same boolean.

## Out of scope (followups)

- Web Workers / browser parallel path.
- Worker-internal MSM / multi-scalar mul (would need noble support or hand-rolled Pippenger).
- Replacing pure-JS BLS with WASM blst on the server side (separate dep migration).

## Risks

- Worker file path resolution differs between CJS, ESM, and bundlers that re-bundle the SDK.
  Plan: resolve via `__dirname` in CJS, `import.meta.url` in ESM. Document for downstream
  bundlers — if it breaks, the pool falls back to sync.
- Worker startup overhead (~30-100ms per worker). Mitigated by the `MIN_PARALLEL_VALIDATORS`
  threshold and reuse-pool design (workers stay alive across calls if possible).
