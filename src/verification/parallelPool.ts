// Parallel share-binding verification via Node worker_threads.
//
// Strategy:
// - Detect worker_threads at runtime. Browser/restricted envs => sync fallback.
// - Below MIN_PARALLEL_VALIDATORS, sync wins (worker spin-up dominates).
// - Spawn one worker per chunk, await all, collapse to a single boolean.
//
// We resolve the worker file path from the same directory as this module —
// tsup emits `lockWorker.js` next to `parallelPool.js` in both CJS and ESM
// Node builds. Browser build excludes the worker entry; bundlers that
// re-bundle the SDK and break path resolution will hit the sync fallback.

import { fromHexString } from '@chainsafe/ssz';
import {
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
} from '../blsUtils.js';

const MIN_PARALLEL_VALIDATORS = 50;
const MAX_WORKERS = 8;
const MIN_VALIDATORS_PER_WORKER = 25;

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
  let candidate: string | undefined;
  if (typeof __dirname !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    candidate = path.join(__dirname, 'lockWorker.js');
  } else {
    // ESM: resolve via import.meta.url — set by build/runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (globalThis as any).__OBOL_SDK_IMPORT_META__;
    if (meta && meta.url) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const url = require('node:url') as typeof import('node:url');
      candidate = path.join(
        path.dirname(url.fileURLToPath(meta.url)),
        'lockWorker.js',
      );
    }
  }
  if (!candidate) return undefined;
  // Verify the worker file actually exists — running from source (tsx, ts-node,
  // jest without a build) hits this path; the worker is only emitted by tsup.
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
  shares: string[][],
  distributedKeys: string[],
  threshold: number,
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
    const worker = new wt.Worker(workerFile, {
      workerData: { shares, distributedKeys, threshold },
    });
    worker.once('message', (msg: unknown) => finish(msg === true));
    worker.once('error', () => finish(false));
    worker.once('exit', code => {
      if (code !== 0) finish(false);
    });
  });
}

export async function verifySharesBinding(
  shares: string[][],
  distributedKeys: string[],
  threshold: number,
): Promise<boolean> {
  if (shares.length !== distributedKeys.length) return false;
  if (shares.length === 0) return true;

  const wt = loadWorkerThreads();
  const os = loadOs();
  const workerFile = getWorkerPath();

  const numCpus = os ? os.cpus().length : 1;
  const numWorkers = Math.min(
    MAX_WORKERS,
    Math.max(1, Math.floor(shares.length / MIN_VALIDATORS_PER_WORKER)),
    numCpus,
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
      runWorker(wt!, workerFile!, chunk, keyChunks[i], threshold),
    ),
  );
  return results.every(Boolean);
}
