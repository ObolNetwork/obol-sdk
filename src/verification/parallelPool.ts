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
  blsAggregateSignatures,
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
  blsVerifyMultiple,
} from '../blsUtils.js';

const MIN_PARALLEL_VALIDATORS = 50;
const MIN_PARALLEL_BATCH_PAIRS = 100;
const MAX_WORKERS = 8;
const MIN_VALIDATORS_PER_WORKER = 25;
const MIN_PAIRS_PER_WORKER = 50;

type WorkerThreads = typeof import('node:worker_threads');
type NodeOs = typeof import('node:os');

let workerThreadsCache: WorkerThreads | null | undefined;
let osCache: NodeOs | null | undefined;
let workerPathCache: string | undefined;

function loadWorkerThreads(): WorkerThreads | null {
  if (workerThreadsCache !== undefined) return workerThreadsCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    workerThreadsCache = require('node:worker_threads') as WorkerThreads;
  } catch {
    workerThreadsCache = null;
  }
  return workerThreadsCache;
}

function loadOs(): NodeOs | null {
  if (osCache !== undefined) return osCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    osCache = require('node:os') as NodeOs;
  } catch {
    osCache = null;
  }
  return osCache;
}

function getWorkerPath(): string | undefined {
  if (workerPathCache) return workerPathCache;
  // CJS only. In ESM and browser builds __dirname is undefined, so this
  // returns undefined and the caller falls back to sync. See plan for the
  // full coverage matrix.
  if (typeof __dirname === 'undefined') return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const candidate = path.join(__dirname, 'lockWorker.js');
  // Sanity check: running from source (tsx, ts-node, jest without a build)
  // also hits the CJS branch but the .js file isn't there yet.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    if (!fs.existsSync(candidate)) return undefined;
  } catch {
    return undefined;
  }
  workerPathCache = candidate;
  return workerPathCache;
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

function runWorker(
  wt: WorkerThreads,
  workerFile: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      worker.terminate();
      resolve(result);
    };
    const worker = new wt.Worker(workerFile, { workerData: data });
    worker.once('message', (msg: unknown) => finish(msg === true));
    worker.once('error', () => finish(false));
    worker.once('exit', code => {
      if (code !== 0) finish(false);
    });
  });
}

function poolSize(itemCount: number, minPerWorker: number): {
  numWorkers: number;
  wt: WorkerThreads | null;
  workerFile: string | undefined;
} {
  const wt = loadWorkerThreads();
  const os = loadOs();
  const workerFile = getWorkerPath();
  const numCpus = os ? os.cpus().length : 1;
  const numWorkers = Math.min(
    MAX_WORKERS,
    Math.max(1, Math.floor(itemCount / minPerWorker)),
    numCpus,
  );
  return { numWorkers, wt, workerFile };
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

  const useParallel =
    wt !== null &&
    workerFile !== undefined &&
    shares.length >= MIN_PARALLEL_VALIDATORS &&
    numWorkers >= 2;

  if (!useParallel) {
    return verifySharesSync(shares, distributedKeys, threshold);
  }

  const shareChunks = chunkArrays(shares, numWorkers);
  const keyChunks = chunkArrays(distributedKeys, numWorkers);

  const results = await Promise.all(
    shareChunks.map((chunk, i) =>
      runWorker(wt!, workerFile!, {
        mode: 'shareBinding',
        shares: chunk,
        distributedKeys: keyChunks[i],
        threshold,
      }),
    ),
  );
  return results.every(Boolean);
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

  const useParallel =
    wt !== null &&
    workerFile !== undefined &&
    pubkeys.length >= MIN_PARALLEL_BATCH_PAIRS &&
    numWorkers >= 2;

  if (!useParallel) {
    return blsVerifyMultiple(
      pubkeys,
      messages,
      blsAggregateSignatures(signatures),
    );
  }

  const pkChunks = chunkArrays(pubkeys, numWorkers);
  const msgChunks = chunkArrays(messages, numWorkers);
  const sigChunks = chunkArrays(signatures, numWorkers);

  const results = await Promise.all(
    pkChunks.map((pks, i) =>
      runWorker(wt!, workerFile!, {
        mode: 'verifyBatch',
        pubkeys: pks,
        messages: msgChunks[i],
        aggregateSignature: blsAggregateSignatures(sigChunks[i]),
      }),
    ),
  );
  return results.every(Boolean);
}
