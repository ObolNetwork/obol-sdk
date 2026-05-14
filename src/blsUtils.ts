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
  return ls.Signature.toBytes(ls.aggregateSignatures(signatures)) as Uint8Array;
}

function lagrangeCoeffAtZero(shareIndex: bigint, indices: bigint[]): bigint {
  const { Fr } = bls12_381.fields;
  let num = BigInt(1);
  let den = BigInt(1);
  for (const j of indices) {
    if (j === shareIndex) continue;
    num = Fr.mul(num, Fr.neg(j));
    den = Fr.mul(den, Fr.sub(shareIndex, j));
  }
  return Fr.mul(num, Fr.inv(den));
}

function blsRecoverWithIndices(
  shares: Uint8Array[],
  indices: bigint[],
): Uint8Array | null {
  try {
    let recovered = bls12_381.G1.Point.ZERO;
    for (let i = 0; i < shares.length; i++) {
      const point = bls12_381.G1.Point.fromBytes(shares[i]);
      const coeff = lagrangeCoeffAtZero(indices[i], indices);
      recovered = recovered.add(point.multiply(coeff));
    }
    return recovered.toBytes() as Uint8Array;
  } catch {
    return null;
  }
}

// Recover validator distributed pubkey from threshold public shares using
// Lagrange interpolation in G1 at x=0. Shares are assumed to be at 1-based
// consecutive positions (index 1, 2, ..., threshold).
export function blsRecoverDistributedPubkeyFromShares(
  pubshares: Uint8Array[],
  threshold: number,
): Uint8Array | null {
  if (threshold <= 0 || pubshares.length < threshold) return null;
  const selected = pubshares.slice(0, threshold);
  const indices = selected.map((_, i) => BigInt(i + 1));
  return blsRecoverWithIndices(selected, indices);
}

// Verify that every share beyond the first threshold lies on the same
// polynomial as the first threshold shares. Replaces the last share of the
// threshold subset with the extra share (keeping its real 1-based index) and
// checks the reconstruction still produces the same distributed key.
export function blsVerifyExtraShares(
  pubshares: Uint8Array[],
  threshold: number,
  distributedPubkey: Uint8Array,
): boolean {
  // Don't trust the caller — refuse to vacuously pass when there aren't
  // enough shares to even form a threshold-sized subset.
  if (threshold <= 0 || pubshares.length < threshold) return false;
  try {
    const baseShares = pubshares.slice(0, threshold - 1);
    const baseIndices = baseShares.map((_, i) => BigInt(i + 1));
    for (let i = threshold; i < pubshares.length; i++) {
      const shares = [...baseShares, pubshares[i]];
      const indices = [...baseIndices, BigInt(i + 1)];
      const recovered = blsRecoverWithIndices(shares, indices);
      // Length guard before .every() — Uint8Array#every only iterates the
      // shorter array's indices, so a shorter `recovered` would pass
      // vacuously without this check.
      if (
        !recovered ||
        recovered.length !== distributedPubkey.length ||
        !recovered.every((b, j) => b === distributedPubkey[j])
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
