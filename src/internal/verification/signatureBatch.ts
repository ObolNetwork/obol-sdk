/**
 * Batched signature checks with a per-signature answer: signatures are
 * checked in chunks with the backend's batch; a chunk that fails is checked
 * one signature at a time to find the first invalid one.
 */
import type { BlsBackend } from '../../cluster/blsBackend.js';
import type { Tick } from '../yielder.js';

export interface SignatureItem<PublicKey> {
  /** null for a public key that did not decode: the item is invalid. */
  publicKey: PublicKey | null;
  message: Uint8Array;
  signature: Uint8Array;
}

/** Signatures per batch. */
export const BATCH_SIZE = 32;

const verifyOne = <PublicKey>(
  bls: BlsBackend<PublicKey>,
  item: SignatureItem<PublicKey>,
): boolean => {
  if (item.publicKey === null) return false;
  try {
    return bls.verify(item.publicKey, item.message, item.signature);
  } catch {
    return false;
  }
};

/**
 * The index of the first item whose signature is invalid, or -1 when every
 * signature is valid on its own.
 */
export const firstInvalidSignature = async <PublicKey>(
  bls: BlsBackend<PublicKey>,
  items: Array<SignatureItem<PublicKey>>,
  tick: Tick,
  batchSize = BATCH_SIZE,
): Promise<number> => {
  for (let start = 0; start < items.length; start += batchSize) {
    const chunk = items.slice(start, start + batchSize);
    let valid = false;
    try {
      const batch = bls.createBatch();
      for (const item of chunk) {
        // A key that did not decode or a malformed signature fails the chunk.
        if (item.publicKey === null) throw new Error('public key malformed');
        batch.add(item.publicKey, item.message, item.signature);
        await tick();
      }
      valid = batch.verify();
    } catch {
      valid = false;
    }
    await tick();
    if (valid) continue;
    for (let i = 0; i < chunk.length; i++) {
      if (!verifyOne(bls, chunk[i])) return start + i;
      await tick();
    }
    // The batch failed although each signature verifies alone: only a
    // backend fault does this. Fail closed at the chunk.
    return start;
  }
  return -1;
};
