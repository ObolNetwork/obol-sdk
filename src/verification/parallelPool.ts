// Parallel BLS verification via Node worker_threads.
//
// IMPORTANT: only the CJS build actually runs in parallel. ESM Node and
// browser bundles transparently fall back to sync. See the matrix in
// PARALLEL_VALIDATION_PLAN.md. The main consumer flow (charon DKG ->
// obol-api NestJS handler -> SDK CJS) is CJS, so it gets the speedup.
//
// Strategy:
// - Look up the worker file via __dirname (CJS only). If undefined or the
//   file isn't where we expect (ESM, browser, source-mode tsx/jest), return
//   undefined and fall back to sync.
// - Below MIN_PARALLEL_* thresholds, sync wins (worker spin-up dominates).
// - Spawn one worker per chunk, await all, collapse to a single boolean.

import { fromHexString } from '@chainsafe/ssz';
import {
  blsAggregatePublicKeys,
  blsAggregateSignatures,
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyAggregate,
  blsVerifyExtraShares,
  blsVerifyMultiple,
  blsVerifyWithAggregatedPubkey,
} from '../blsUtils.js';
// Type-only imports — erased at compile time, so they don't pull node:*
// modules into the browser bundle.
import type * as WTNs from 'node:worker_threads';
import type * as OsNs from 'node:os';
import type * as PathNs from 'node:path';
import type * as FsNs from 'node:fs';
import { ClusterLockValidationTimeoutError } from '../errors.js';
import type { BlsSignatureCheck, ClusterLock, SafeRpcUrl } from '../types.js';
import type { AggregatePubkeysInput, WorkerInput } from './lockWorker.js';

const MIN_PARALLEL_VALIDATORS = 50;
const MIN_PARALLEL_BATCH_PAIRS = 100;
const MAX_WORKERS = 8;
const MIN_VALIDATORS_PER_WORKER = 25;
const MIN_PAIRS_PER_WORKER = 50;
const MIN_PARALLEL_AGGREGATE_KEYS = 400;
const MIN_KEYS_PER_WORKER_AGG = 100;
// Hard ceiling so a stuck worker can't leak past obol-api / ingress timeouts.
// Bench ~3s per chunk on fast CPU; dev pods (~500m) need more headroom for ~1k DVs.
const MIN_VALIDATORS_FOR_VALIDATION_WORKER = 50;
const VALIDATION_WORKER_TIMEOUT_MS = 300_000;
const WORKER_TIMEOUT_MS = 180_000;

/** Posted from clusterLockValidationWorker when a nested BLS worker times out. */
export type LockValidationWorkerTimeoutReply = {
  validationTimeoutMs: number;
};

function isValidationTimeoutReply(
  msg: unknown,
): msg is LockValidationWorkerTimeoutReply {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'validationTimeoutMs' in msg &&
    typeof (msg as LockValidationWorkerTimeoutReply).validationTimeoutMs ===
      'number'
  );
}
// Cap simultaneous workers (memory). Scales up for large jobs on multi-core hosts.
const MAX_CONCURRENT_WORKERS_CAP = 8;

function maxConcurrentWorkers(numWorkers: number): number {
  return Math.min(numWorkers, MAX_CONCURRENT_WORKERS_CAP);
}

type WorkerThreads = typeof WTNs;
type NodeOs = typeof OsNs;

let workerThreadsCache: WorkerThreads | null | undefined;
let osCache: NodeOs | null | undefined;
// Tri-state per worker file: undefined = uncached, null = unavailable, string = path.
const workerPathByFile = new Map<string, string | null | undefined>();

function loadWorkerThreads(): WorkerThreads | null {
  if (workerThreadsCache !== undefined) return workerThreadsCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    workerThreadsCache = require('node:worker_threads') as WorkerThreads;
  } catch {
    workerThreadsCache = null;
  }
  return workerThreadsCache;
}

function loadOs(): NodeOs | null {
  if (osCache !== undefined) return osCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    osCache = require('node:os') as NodeOs;
  } catch {
    osCache = null;
  }
  return osCache;
}

function getWorkerPath(filename: string): string | null {
  const cached = workerPathByFile.get(filename);
  if (cached !== undefined) return cached;
  if (typeof __dirname === 'undefined') {
    workerPathByFile.set(filename, null);
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const path = require('node:path') as typeof PathNs;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof FsNs;
  // Bundled index.js: __dirname is dist/cjs/src; workers live in verification/.
  // Standalone parallelPool.js entry: __dirname is already verification/.
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, 'verification', filename),
  ];
  try {
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        workerPathByFile.set(filename, candidate);
        return candidate;
      }
    }
  } catch {
    // fall through
  }
  workerPathByFile.set(filename, null);
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function chunkArrays<T>(arr: T[], n: number): T[][] {
  const size = Math.ceil(arr.length / n);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function verifySharesSync(
  shares: string[][],
  distributedKeys: string[],
  threshold: number,
): boolean {
  for (let i = 0; i < shares.length; i++) {
    const sharesBytes = shares[i].map(s => fromHexString(s));
    const dkBytes = fromHexString(distributedKeys[i]);
    const recovered = blsRecoverDistributedPubkeyFromShares(
      sharesBytes,
      threshold,
    );
    if (!recovered) return false;
    if (recovered.length !== dkBytes.length) return false;
    for (let j = 0; j < recovered.length; j++) {
      if (recovered[j] !== dkBytes[j]) return false;
    }
    if (!blsVerifyExtraShares(sharesBytes, threshold, dkBytes)) {
      return false;
    }
  }
  return true;
}

async function runWorkerAggregatePubkeys(
  wt: WorkerThreads,
  workerFile: string,
  data: AggregatePubkeysInput,
): Promise<Uint8Array | null> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const worker = new wt.Worker(workerFile, { workerData: data });
    const finish = (result: Uint8Array | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      reject(new ClusterLockValidationTimeoutError(WORKER_TIMEOUT_MS));
    }, WORKER_TIMEOUT_MS);
    worker.once('message', (msg: unknown) => {
      finish(msg instanceof Uint8Array ? msg : null);
    });
    worker.once('error', () => {
      finish(null);
    });
    worker.once('exit', code => {
      if (code !== 0) finish(null);
    });
  });
}

async function runWorker(
  wt: WorkerThreads,
  workerFile: string,
  data: WorkerInput,
): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const worker = new wt.Worker(workerFile, { workerData: data });
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      reject(new ClusterLockValidationTimeoutError(WORKER_TIMEOUT_MS));
    }, WORKER_TIMEOUT_MS);
    worker.once('message', (msg: unknown) => {
      finish(msg === true);
    });
    worker.once('error', () => {
      finish(false);
    });
    worker.once('exit', code => {
      if (code !== 0) finish(false);
    });
  });
}

function poolSize(
  itemCount: number,
  minPerWorker: number,
): {
  numWorkers: number;
  wt: WorkerThreads | null;
  workerFile: string | null;
} {
  const wt = loadWorkerThreads();
  const os = loadOs();
  const workerFile = getWorkerPath('lockWorker.js');
  const numCpus = os ? Math.max(1, os.cpus().length) : 1;
  const numWorkers = Math.min(
    MAX_WORKERS,
    Math.max(1, Math.floor(itemCount / minPerWorker)),
    numCpus,
  );
  return { numWorkers, wt, workerFile };
}

async function runWorkerChunks(
  wt: WorkerThreads,
  workerFile: string,
  chunks: WorkerInput[],
): Promise<boolean> {
  const results = await mapWithConcurrency(
    chunks,
    maxConcurrentWorkers(chunks.length),
    async data => await runWorker(wt, workerFile, data),
  );
  return results.every(Boolean);
}

export async function verifySharesBinding(
  shares: string[][],
  distributedKeys: string[],
  threshold: number,
): Promise<boolean> {
  if (shares.length !== distributedKeys.length) return false;
  if (shares.length === 0) return true;

  const { numWorkers, wt, workerFile } = poolSize(
    shares.length,
    MIN_VALIDATORS_PER_WORKER,
  );

  // Inline the guard so TS narrows wt/workerFile for the parallel path below
  // (avoids non-null assertions).
  if (
    wt === null ||
    workerFile === null ||
    shares.length < MIN_PARALLEL_VALIDATORS ||
    numWorkers < 2
  ) {
    return verifySharesSync(shares, distributedKeys, threshold);
  }

  const shareChunks = chunkArrays(shares, numWorkers);
  const keyChunks = chunkArrays(distributedKeys, numWorkers);

  return await runWorkerChunks(
    wt,
    workerFile,
    shareChunks.map((chunk, i) => ({
      mode: 'shareBinding',
      shares: chunk,
      distributedKeys: keyChunks[i],
      threshold,
    })),
  );
}

/** Verify deposit + builder BLS signatures collected from `depositBlsCheck` / `builderBlsCheck`. */
export async function verifyBlsChecksParallel(
  checks: BlsSignatureCheck[],
): Promise<boolean> {
  if (checks.length === 0) return true;
  return await verifyBatchParallel(
    checks.map(c => c.pubkey),
    checks.map(c => c.message),
    checks.map(c => c.signature),
  );
}

// Verify a batch of (pubkey, message, individual signature) triples.
// Sync path aggregates all sigs and runs blsVerifyMultiple once (matches the
// previous behavior). Parallel path splits into chunks; each chunk's sigs are
// aggregated and verified independently — same total pairing count, K× wall
// time speedup.
export async function verifyBatchParallel(
  pubkeys: Uint8Array[],
  messages: Uint8Array[],
  signatures: Uint8Array[],
): Promise<boolean> {
  if (
    pubkeys.length !== messages.length ||
    pubkeys.length !== signatures.length
  ) {
    return false;
  }
  if (pubkeys.length === 0) return true;

  const { numWorkers, wt, workerFile } = poolSize(
    pubkeys.length,
    MIN_PAIRS_PER_WORKER,
  );

  if (
    wt === null ||
    workerFile === null ||
    pubkeys.length < MIN_PARALLEL_BATCH_PAIRS ||
    numWorkers < 2
  ) {
    return blsVerifyMultiple(
      pubkeys,
      messages,
      blsAggregateSignatures(signatures),
    );
  }

  const pkChunks = chunkArrays(pubkeys, numWorkers);
  const msgChunks = chunkArrays(messages, numWorkers);
  const sigChunks = chunkArrays(signatures, numWorkers);

  return await runWorkerChunks(
    wt,
    workerFile,
    pkChunks.map((pks, i) => ({
      mode: 'verifyBatch',
      pubkeys: pks,
      messages: msgChunks[i],
      signatures: sigChunks[i],
    })),
  );
}

// Lock signature_aggregate: aggregate many operator shares (validators × operators)
// then verify one BLS signature over lock_hash. Parallel path aggregates pubkey
// chunks in workers, combines partial aggregates on the main thread, then verifies.
export async function verifyAggregateParallel(
  pubkeys: Uint8Array[],
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (pubkeys.length === 0) return false;

  const { numWorkers, wt, workerFile } = poolSize(
    pubkeys.length,
    MIN_KEYS_PER_WORKER_AGG,
  );

  if (
    wt === null ||
    workerFile === null ||
    pubkeys.length < MIN_PARALLEL_AGGREGATE_KEYS ||
    numWorkers < 2
  ) {
    return blsVerifyAggregate(pubkeys, message, signature);
  }

  const pkChunks = chunkArrays(pubkeys, numWorkers);
  const partials = await mapWithConcurrency(
    pkChunks,
    maxConcurrentWorkers(pkChunks.length),
    async chunk =>
      await runWorkerAggregatePubkeys(wt, workerFile, {
        mode: 'aggregatePubkeys',
        pubkeys: chunk,
      }),
  );
  if (partials.some(p => p === null)) return false;

  const aggregated = blsAggregatePublicKeys(partials as Uint8Array[]);
  return blsVerifyWithAggregatedPubkey(aggregated, message, signature);
}

/**
 * Large locks: run full validation off the main thread (obol-api stays responsive).
 * Returns null when workers are unavailable — caller should use sync validation.
 */
export async function validateClusterLockInWorker(
  lock: ClusterLock,
  safeRpcUrl?: SafeRpcUrl,
): Promise<boolean | null> {
  const n = lock.distributed_validators?.length ?? 0;
  if (n < MIN_VALIDATORS_FOR_VALIDATION_WORKER) return null;

  const wt = loadWorkerThreads();
  const workerFile = getWorkerPath('clusterLockValidationWorker.js');
  if (wt === null || workerFile === null) return null;

  return await new Promise((resolve, reject) => {
    let settled = false;
    const worker = new wt.Worker(workerFile, {
      workerData: { lock, safeRpcUrl },
    });
    // Timeout rejects (ClusterLockValidationTimeoutError) instead of resolving
    // false: callers must distinguish **504** gateway timeout from **400** invalid
    // crypto. Do not resolve null here — full sync fallback would block Node again.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      reject(
        new ClusterLockValidationTimeoutError(VALIDATION_WORKER_TIMEOUT_MS),
      );
    }, VALIDATION_WORKER_TIMEOUT_MS);
    const finish = (result: boolean | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      resolve(result);
    };
    worker.once('message', (msg: unknown) => {
      if (isValidationTimeoutReply(msg)) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        worker.terminate();
        reject(new ClusterLockValidationTimeoutError(msg.validationTimeoutMs));
        return;
      }
      finish(msg === true);
    });
    worker.once('error', () => {
      finish(null);
    });
    worker.once('exit', code => {
      if (code !== 0) finish(null);
    });
  });
}
