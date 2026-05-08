// Worker entry point loaded by parallelPool via Node's worker_threads.
//
// Two modes (dispatched on workerData.mode):
//   'shareBinding' — Lagrange + extra-share verification for a validator chunk.
//   'verifyBatch'  — blsVerifyMultiple on a (pubkeys, messages, aggregateSig)
//                    chunk of the deposit+builder batch.
//
// Both modes return a simple boolean; main thread combines results.

import { parentPort, workerData } from 'node:worker_threads';
import { fromHexString } from '@chainsafe/ssz';
import {
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
  blsVerifyMultiple,
} from '../blsUtils.js';

interface ShareBindingInput {
  mode: 'shareBinding';
  shares: string[][];
  distributedKeys: string[];
  threshold: number;
}

interface VerifyBatchInput {
  mode: 'verifyBatch';
  pubkeys: Uint8Array[];
  messages: Uint8Array[];
  aggregateSignature: Uint8Array;
}

type WorkerInput = ShareBindingInput | VerifyBatchInput;

function verifyShareBindingChunk(input: ShareBindingInput): boolean {
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
    for (let j = 0; j < recovered.length; j++) {
      if (recovered[j] !== dkBytes[j]) return false;
    }
    if (!blsVerifyExtraShares(sharesBytes, threshold, dkBytes)) {
      return false;
    }
  }
  return true;
}

function verifyBatchChunk(input: VerifyBatchInput): boolean {
  return blsVerifyMultiple(
    input.pubkeys,
    input.messages,
    input.aggregateSignature,
  );
}

function dispatch(input: WorkerInput): boolean {
  if (input.mode === 'shareBinding') return verifyShareBindingChunk(input);
  if (input.mode === 'verifyBatch') return verifyBatchChunk(input);
  return false;
}

if (parentPort) {
  try {
    parentPort.postMessage(dispatch(workerData as WorkerInput));
  } catch {
    parentPort.postMessage(false);
  }
}
