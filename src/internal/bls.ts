import { bls12_381 } from '@noble/curves/bls12-381.js';

// ETH2 BLS uses G1 public keys (48 bytes) and G2 signatures (96 bytes) — longSignatures mode.
// The Ethereum consensus spec uses the POP (Proof of Possession) DST, not the noble/curves NUL default.
const { longSignatures: ls } = bls12_381;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
type G1Point = typeof G1.BASE;
type G2Point = typeof G2.BASE;

// Decode with full validation (on-curve and prime-order subgroup, done by
// noble's fromBytes) and reject the identity point, which fromBytes accepts.
function decodePubkey(bytes: Uint8Array): G1Point {
  const point = G1.fromBytes(bytes);
  if (point.is0()) throw new Error('public key is the point at infinity');
  return point;
}

function decodeSignature(bytes: Uint8Array): G2Point {
  const point = ls.Signature.fromBytes(bytes);
  if (point.is0()) throw new Error('signature is the point at infinity');
  return point;
}

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

export function blsAggregatePublicKeys(pubkeys: Uint8Array[]): Uint8Array {
  if (pubkeys.length === 0) {
    throw new Error('cannot aggregate empty pubkey set');
  }
  return ls.aggregatePublicKeys(pubkeys).toBytes() as Uint8Array;
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

/** Verify when the pubkey set is already aggregated to a single G1 key. */
export function blsVerifyWithAggregatedPubkey(
  aggregatedPubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ls.verify(signature, ls.hash(message, ETH2_DST), aggregatedPubkey);
  } catch {
    return false;
  }
}

const WEIGHT_BITS = 64;

/** Random non-zero 64-bit weight from a cryptographically secure RNG. */
function randomWeight(): bigint {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  const weight = (BigInt(hi) << BigInt(32)) | BigInt(lo);
  return weight === BigInt(0) ? BigInt(1) : weight;
}

/**
 * Σ weights[i]·points[i] for weights below 2^64, by the bucket method. Noble's
 * generic multi-scalar multiplication walks all 255 scalar bits.
 */
function sumWeightedSignatures(points: G2Point[], weights: bigint[]): G2Point {
  // Window size dividing WEIGHT_BITS; larger windows pay off for more points.
  const windowBits = points.length < 16 ? 2 : points.length < 512 ? 4 : 8;
  const mask = BigInt((1 << windowBits) - 1);
  let sum = G2.ZERO;
  for (let shift = WEIGHT_BITS - windowBits; shift >= 0; shift -= windowBits) {
    for (let k = 0; k < windowBits; k++) sum = sum.double();
    const buckets = new Array<G2Point | undefined>(1 << windowBits);
    for (let i = 0; i < points.length; i++) {
      const digit = Number((weights[i] >> BigInt(shift)) & mask);
      if (digit !== 0) {
        const bucket = buckets[digit];
        buckets[digit] = bucket ? bucket.add(points[i]) : points[i];
      }
    }
    // Σ digit·bucket[digit] via running sums.
    let running = G2.ZERO;
    for (let digit = buckets.length - 1; digit > 0; digit--) {
      const bucket = buckets[digit];
      if (bucket) running = running.add(bucket);
      sum = sum.add(running);
    }
  }
  return sum;
}

/**
 * Checks that every `signatures[i]` is a valid signature of `messages[i]`
 * under `pubkeys[i]`, with one batched pairing check: for fresh random
 * non-zero 64-bit weights rᵢ,
 *
 *   e(G1, Σ rᵢ·Sᵢ) == Π e(rᵢ·PKᵢ, H(mᵢ)).
 *
 * Every point is checked to be in the prime-order subgroup and not the
 * identity, so if any signature is invalid on its own the check fails except
 * with probability at most 2^-63 over the weights.
 */
export function blsVerifyEach(
  pubkeys: Uint8Array[],
  messages: Uint8Array[],
  signatures: Uint8Array[],
): boolean {
  try {
    if (
      pubkeys.length !== messages.length ||
      pubkeys.length !== signatures.length
    ) {
      return false;
    }
    if (pubkeys.length === 0) return true;
    const weights = pubkeys.map(randomWeight);
    const items = pubkeys.map((pubkey, i) => ({
      message: ls.hash(messages[i], ETH2_DST),
      publicKey: decodePubkey(pubkey).multiplyUnsafe(weights[i]),
    }));
    const weightedSignature = sumWeightedSignatures(
      signatures.map(decodeSignature),
      weights,
    );
    return ls.verifyBatch(weightedSignature, items);
  } catch {
    return false;
  }
}

/**
 * Verifies one aggregate signature (the plain sum of the signers' signatures)
 * over distinct (pubkey, message) pairs. This proves only that the sum is
 * valid, not that each signer's own signature is; use {@link blsVerifyEach}
 * to check a set of individual signatures.
 */
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

/**
 * Threshold-aggregate partial BLS signatures (G2) into the group signature,
 * matching Charon's `tbls.ThresholdAggregate`: Lagrange interpolation at x=0
 * over every provided share, keyed by its 1-based share index.
 *
 * All provided partials are used. Interpolating through more than `threshold`
 * points still yields the group signature when every partial lies on the same
 * polynomial; fewer than `threshold` partials yield a signature that does not
 * verify against the group public key, so callers should verify the result.
 *
 * @throws When no partials are given, an index is not a positive safe integer,
 *   or a signature is not a valid compressed G2 point.
 */
export function blsThresholdAggregateSignatures(
  partialsByIndex: Map<number, Uint8Array>,
): Uint8Array {
  if (partialsByIndex.size === 0) {
    throw new Error('cannot threshold-aggregate an empty signature set');
  }
  const indices: bigint[] = [];
  for (const idx of partialsByIndex.keys()) {
    if (!Number.isSafeInteger(idx) || idx < 1) {
      throw new Error(`invalid share index ${idx}: must be a positive integer`);
    }
    indices.push(BigInt(idx));
  }
  let aggregate = bls12_381.G2.Point.ZERO;
  let i = 0;
  for (const sig of partialsByIndex.values()) {
    const point = ls.Signature.fromBytes(sig);
    point.assertValidity();
    const coeff = lagrangeCoeffAtZero(indices[i], indices);
    aggregate = aggregate.add(point.multiply(coeff));
    i++;
  }
  return ls.Signature.toBytes(aggregate) as Uint8Array;
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
