// Worker entry point loaded by parallelPool via Node's worker_threads.
//
// Two modes (dispatched on workerData.mode):
//   'shareBinding' — Lagrange + extra-share verification for a validator chunk.
//   'verifyBatch'  — blsVerifyMultiple on a (pubkeys, messages, aggregateSig)
//                    chunk of the deposit+builder batch.
//   'aggregatePubkeys' — partial G1 aggregate of a pubkey chunk (for lock sig).
//
// shareBinding / verifyBatch return boolean; aggregatePubkeys returns bytes.

import { parentPort, workerData } from 'node:worker_threads';
import { fromHexString } from '@chainsafe/ssz';
import {
  blsAggregatePublicKeys,
  blsAggregateSignatures,
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
  blsVerifyMultiple,
} from '../blsUtils.js';

export interface ShareBindingInput {
  mode: 'shareBinding';
  shares: string[][];
  distributedKeys: string[];
  threshold: number;
}

export interface VerifyBatchInput {
  mode: 'verifyBatch';
  pubkeys: Uint8Array[];
  messages: Uint8Array[];
  signatures: Uint8Array[];
}

export interface AggregatePubkeysInput {
  mode: 'aggregatePubkeys';
  pubkeys: Uint8Array[];
}

export type WorkerInput =
  | ShareBindingInput
  | VerifyBatchInput
  | AggregatePubkeysInput;

export type WorkerResult = boolean | Uint8Array;

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
    blsAggregateSignatures(input.signatures),
  );
}

function dispatch(input: WorkerInput): WorkerResult {
  if (input.mode === 'shareBinding') return verifyShareBindingChunk(input);
  if (input.mode === 'verifyBatch') return verifyBatchChunk(input);
  if (input.mode === 'aggregatePubkeys') {
    return blsAggregatePublicKeys(input.pubkeys);
  }
  return false;
}

if (parentPort) {
  try {
    parentPort.postMessage(dispatch(workerData as WorkerInput));
  } catch {
    parentPort.postMessage(false);
  }
}
