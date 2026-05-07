// Worker entry point loaded by parallelPool via Node's worker_threads.
//
// Responsibility: verify the share-binding step (Lagrange + extra shares)
// for a chunk of validators. This is the dominant CPU cost in
// validateClusterLock (~75% on a 500-validator lock per blsBench.mjs).
//
// Returns simple boolean — the main thread re-runs other validation steps
// itself; this worker only handles the expensive math.

import { parentPort, workerData } from 'node:worker_threads';
import { fromHexString } from '@chainsafe/ssz';
import {
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
} from '../blsUtils.js';

interface WorkerInput {
  // For each validator in the chunk: hex strings.
  shares: string[][];
  distributedKeys: string[];
  threshold: number;
}

function verifyChunk(input: WorkerInput): boolean {
  const { shares, distributedKeys, threshold } = input;
  if (shares.length !== distributedKeys.length) return false;

  for (let i = 0; i < shares.length; i++) {
    const sharesBytes = shares[i].map(s => fromHexString(s));
    const dkBytes = fromHexString(distributedKeys[i]);

    const recovered = blsRecoverDistributedPubkeyFromShares(
      sharesBytes,
      threshold,
    );
    if (!recovered) return false;
    if (recovered.length !== dkBytes.length) return false;
    let equal = true;
    for (let j = 0; j < recovered.length; j++) {
      if (recovered[j] !== dkBytes[j]) {
        equal = false;
        break;
      }
    }
    if (!equal) return false;

    if (!blsVerifyExtraShares(sharesBytes, threshold, dkBytes)) {
      return false;
    }
  }
  return true;
}

if (parentPort) {
  try {
    const ok = verifyChunk(workerData as WorkerInput);
    parentPort.postMessage(ok);
  } catch {
    parentPort.postMessage(false);
  }
}
