import { bls12_381 } from '@noble/curves/bls12-381.js';

// ETH2 BLS uses G1 public keys (48 bytes) and G2 signatures (96 bytes) — longSignatures mode.
// The Ethereum consensus spec uses the POP (Proof of Possession) DST, not the noble/curves NUL default.
const { longSignatures: ls } = bls12_381;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';

export function blsVerify(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ls.verify(signature, ls.hash(message, ETH2_DST), pubkey);
  } catch {
    return false;
  }
}

export function blsVerifyAggregate(
  pubkeys: Uint8Array[],
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ls.verify(
      signature,
      ls.hash(message, ETH2_DST),
      ls.aggregatePublicKeys(pubkeys),
    );
  } catch {
    return false;
  }
}

export function blsVerifyMultiple(
  pubkeys: Uint8Array[],
  messages: Uint8Array[],
  signature: Uint8Array,
): boolean {
  try {
    if (pubkeys.length !== messages.length) return false;
    const items = messages.map((msg, i) => ({
      message: ls.hash(msg, ETH2_DST),
      publicKey: pubkeys[i],
    }));
    return ls.verifyBatch(signature, items);
  } catch {
    return false;
  }
}

export function blsAggregateSignatures(signatures: Uint8Array[]): Uint8Array {
  return ls.Signature.toBytes(
    ls.aggregateSignatures(signatures),
  ) as Uint8Array;
}
