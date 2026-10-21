import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';

// ETH2 BLS uses G1 public keys (48 bytes) and G2 signatures (96 bytes) — longSignatures mode.
// The Ethereum consensus spec uses the POP (Proof of Possession) DST, not the noble/curves NUL default.
const { longSignatures: ls } = bls12_381;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const { Fp, Fp12 } = bls12_381.fields;
export type G1Point = typeof G1.BASE;
type G2Point = typeof G2.BASE;
type LineCoefficients = ReturnType<
  typeof bls12_381.utils.calcPairingPrecomputes
>;
type PairingInput = [LineCoefficients, bigint, bigint];

const precomputes = (point: G2Point): LineCoefficients =>
  bls12_381.utils.calcPairingPrecomputes(point);

const HALF_P = (Fp.ORDER - BigInt(1)) / BigInt(2);
const NEG_G1 = G1.BASE.negate().toAffine();

/**
 * Decodes a compressed G1 point (ZCash encoding) without the prime-order
 * subgroup check: one square root, so the point is on the curve by
 * construction. Throws for a bad length or flags, an x outside the field, an
 * x with no curve point, and the point at infinity.
 */
export function decodeG1Unchecked(bytes: Uint8Array): G1Point {
  if (bytes.length !== 48) throw new Error('G1 point: expected 48 bytes');
  const flags = bytes[0];
  if ((flags & 0x80) === 0) throw new Error('G1 point: not compressed');
  if ((flags & 0x40) !== 0) throw new Error('G1 point: point at infinity');
  const xBytes = bytes.slice();
  xBytes[0] &= 0x1f;
  const x = bytesToNumberBE(xBytes);
  if (x >= Fp.ORDER) throw new Error('G1 point: x not in the field');
  // y² = x³ + 4; Fp.sqrt throws when x is not on the curve.
  let y = Fp.sqrt(Fp.add(Fp.mul(Fp.sqr(x), x), BigInt(4)));
  const yIsLarger = y > HALF_P;
  if (yIsLarger !== ((flags & 0x20) !== 0)) y = Fp.neg(y);
  return G1.fromAffine({ x, y });
}

/**
 * The canonical-encoding rules of the ZCash compressed format (IETF BLS,
 * Ethereum consensus `KeyValidate`), checked on the bytes before a point is
 * decoded: the compression flag set; the infinity flag only with every other
 * bit zero (sign flag included); each field element (G1: x; G2: x.c1, then
 * x.c0) below the field modulus. A field element at or above the modulus is a
 * second encoding of a smaller one and is refused here, since the decoder
 * would reduce it.
 */
function assertCanonical(bytes: Uint8Array, length: 48 | 96): void {
  if (bytes.length !== length) {
    throw new Error(`point: expected ${length} bytes`);
  }
  const flags = bytes[0];
  if ((flags & 0x80) === 0) throw new Error('point: not compressed');
  const body = bytes.slice();
  body[0] &= 0x1f;
  if ((flags & 0x40) !== 0) {
    if ((flags & 0x20) !== 0 || body.some(b => b !== 0)) {
      throw new Error('point: malformed infinity encoding');
    }
    return;
  }
  for (let offset = 0; offset < length; offset += 48) {
    if (bytesToNumberBE(body.subarray(offset, offset + 48)) >= Fp.ORDER) {
      throw new Error('point: coordinate not in the field');
    }
  }
}

/**
 * Decodes a G1 public key from its canonical encoding. With
 * `subgroupCheck`, the point must be in the prime-order subgroup (noble's
 * full validation); the identity is always rejected.
 */
export function decodeG1(bytes: Uint8Array, subgroupCheck: boolean): G1Point {
  if (!subgroupCheck) {
    const point = decodeG1Unchecked(bytes);
    if (point.is0()) throw new Error('G1 point: point at infinity');
    return point;
  }
  assertCanonical(bytes, 48);
  const point = G1.fromBytes(bytes);
  if (point.is0()) throw new Error('G1 point: point at infinity');
  return point;
}

/**
 * Decodes a G2 signature from its canonical encoding: on the curve, in the
 * subgroup, not the identity.
 */
export function decodeSignature(bytes: Uint8Array): G2Point {
  assertCanonical(bytes, 96);
  const point = ls.Signature.fromBytes(bytes);
  if (point.is0()) throw new Error('signature is the point at infinity');
  return point;
}

/** Σ points (the identity for an empty list). */
export function sumG1(points: G1Point[]): G1Point {
  let sum = G1.ZERO;
  for (const point of points) sum = sum.add(point);
  return sum;
}

/**
 * Whether `points[x]` (x = 0..n) are the values of one polynomial of degree
 * below `threshold`: every `threshold`-th forward difference of the sequence
 * is the identity. Uses only point subtraction, which is exact group
 * arithmetic on the curve whether or not a point is in the subgroup.
 *
 * With `points[0]` the group key and `points[j]` the public share at index j,
 * this accepts exactly when recovering the key from the first `threshold`
 * shares, and from any `threshold - 1` of them plus each further share, gives
 * the group key.
 */
export function onPolynomial(points: G1Point[], threshold: number): boolean {
  if (!Number.isSafeInteger(threshold) || threshold < 1) return false;
  if (points.length < threshold + 1) return false;
  let differences = points;
  for (let order = 0; order < threshold; order++) {
    const next = new Array<G1Point>(differences.length - 1);
    for (let k = 0; k < next.length; k++) {
      next[k] = differences[k + 1].subtract(differences[k]);
    }
    differences = next;
  }
  return differences.every(point => point.is0());
}

const pairingIsOne = (pairs: PairingInput[]): boolean =>
  Fp12.eql(Fp12.finalExponentiate(bls12_381.millerLoopBatch(pairs)), Fp12.ONE);

/**
 * Verifies one signature against a decoded public key (not the identity):
 * e(pk, H(m)) · e(-G1, S) == 1.
 */
export function verifyDecoded(
  publicKey: G1Point,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    if (publicKey.is0()) return false;
    const S = decodeSignature(signature);
    const H = ls.hash(message, ETH2_DST);
    const pk = publicKey.toAffine();
    return pairingIsOne([
      [precomputes(H), pk.x, pk.y],
      [precomputes(S), NEG_G1.x, NEG_G1.y],
    ]);
  } catch {
    return false;
  }
}

export function blsVerify(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return verifyDecoded(decodeG1(pubkey, true), message, signature);
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

/** [k]P for k below 2^64 by double-and-add (no precomputed table). */
function mulSmall(point: G1Point, k: bigint): G1Point {
  let acc = G1.ZERO;
  const bits = k.toString(2);
  for (let i = 0; i < bits.length; i++) {
    acc = acc.double();
    if (bits[i] === '1') acc = acc.add(point);
  }
  return acc;
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

/** Signatures per group of Miller loops inside a batch (keeps `add` short). */
const GROUP = 2;

/**
 * Randomised batch verification. For fresh random non-zero 64-bit weights rᵢ
 * (drawn when each signature is added, after its inputs are fixed) it checks
 *
 *   Π e(rᵢ·PKᵢ, H(mᵢ)) · e(-G1, Σ rᵢ·Sᵢ) == 1.
 *
 * Every public key is a decoded subgroup point (not the identity) and every
 * signature is checked to be in the prime-order subgroup and not the
 * identity, so if any signature is invalid on its own the check fails except
 * with probability at most 2^-63 over the weights.
 *
 * The work is done as signatures are added (hashing, Miller loops in groups
 * of two); `verify` adds one Miller loop and the final exponentiation.
 */
export class NobleSignatureBatch {
  private accumulated = Fp12.ONE;
  private weightedSum = G2.ZERO;
  private pairs: PairingInput[] = [];
  private signatures: G2Point[] = [];
  private weights: bigint[] = [];
  private count = 0;

  add(publicKey: G1Point, message: Uint8Array, signature: Uint8Array): void {
    if (publicKey.is0()) throw new Error('public key is the point at infinity');
    const S = decodeSignature(signature);
    const weight = randomWeight();
    const H = ls.hash(message, ETH2_DST);
    const weighted = mulSmall(publicKey, weight).toAffine();
    this.pairs.push([precomputes(H), weighted.x, weighted.y]);
    this.signatures.push(S);
    this.weights.push(weight);
    this.count++;
    if (this.pairs.length >= GROUP) this.flush();
  }

  private flush(): void {
    if (this.pairs.length === 0) return;
    this.accumulated = Fp12.mul(
      this.accumulated,
      bls12_381.millerLoopBatch(this.pairs),
    );
    this.weightedSum = this.weightedSum.add(
      sumWeightedSignatures(this.signatures, this.weights),
    );
    this.pairs = [];
    this.signatures = [];
    this.weights = [];
  }

  verify(): boolean {
    this.flush();
    if (this.count === 0) return true;
    // Σ rᵢ·Sᵢ is the identity only with negligible probability for valid
    // signatures; noble cannot pair the identity.
    if (this.weightedSum.is0()) return false;
    const last = bls12_381.millerLoopBatch([
      [precomputes(this.weightedSum), NEG_G1.x, NEG_G1.y],
    ]);
    return Fp12.eql(
      Fp12.finalExponentiate(Fp12.mul(this.accumulated, last)),
      Fp12.ONE,
    );
  }
}

export function blsAggregateSignatures(signatures: Uint8Array[]): Uint8Array {
  return ls.Signature.toBytes(
    ls.aggregateSignatures(signatures.map(decodeSignature)),
  ) as Uint8Array;
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
    const point = decodeSignature(sig);
    const coeff = lagrangeCoeffAtZero(indices[i], indices);
    aggregate = aggregate.add(point.multiply(coeff));
    i++;
  }
  return ls.Signature.toBytes(aggregate) as Uint8Array;
}
