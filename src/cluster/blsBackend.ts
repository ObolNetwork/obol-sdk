/**
 * The BLS12-381 primitives lock and deposit verification need, as an
 * injectable backend. The default is pure JavaScript (`@noble/curves`); the
 * SDK never loads a native module, but a caller (a Node server) can pass an
 * adapter over a native library such as `@chainsafe/blst`.
 */
import {
  decodeG1,
  NobleSignatureBatch,
  onPolynomial,
  sumG1,
  verifyDecoded,
  type G1Point,
} from '../internal/bls.js';

/* eslint-disable @typescript-eslint/method-signature-style --
   Method signatures keep the parameters bivariant, so a backend typed with
   its own PublicKey (BlsBackend<blst.PublicKey>) is a BlsBackend. */

/**
 * A batch of signatures that is valid only if every signature in it is
 * valid on its own.
 */
export interface BlsBatch<PublicKey = unknown> {
  /**
   * Adds one signature. Throws if `signature` is not a valid compressed G2
   * point in the prime-order subgroup, or is the identity.
   */
  add(publicKey: PublicKey, message: Uint8Array, signature: Uint8Array): void;
  /**
   * True only if every added signature verifies on its own. A batch that is
   * checked as one equation must weight each signature with fresh secret
   * random scalars of at least 64 bits (a plain sum accepts invalid
   * signatures that cancel out).
   */
  verify(): boolean;
}

/**
 * BLS12-381 (Ethereum consensus: G1 public keys, G2 signatures, POP
 * ciphersuite) operations used by `cluster.verifyLock` and
 * `deposits.verifyDepositData`. `PublicKey` is the backend's decoded G1
 * point; the SDK only passes values it got from `decodePublicKey` or
 * `aggregatePublicKeys` back in.
 *
 * An adapter over `@chainsafe/blst` (Node, native):
 *
 * ```ts
 * import * as blst from '@chainsafe/blst';
 * import type { BlsBackend } from '@obolnetwork/obol-sdk';
 *
 * const binomial = (n: number, k: number): number => {
 *   let r = 1;
 *   for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
 *   return Math.round(r);
 * };
 * const same = (a: blst.PublicKey, b: blst.PublicKey): boolean =>
 *   Buffer.compare(a.toBytes(), b.toBytes()) === 0;
 *
 * export const blstBackend: BlsBackend<blst.PublicKey> = {
 *   // Native validation is cheap, so every key is fully checked.
 *   decodePublicKey: bytes => blst.PublicKey.fromBytes(bytes, true),
 *   aggregatePublicKeys: keys => blst.aggregatePublicKeys(keys, false),
 *   // t-th forward differences as two sums with binomial multiplicities.
 *   onPolynomial: (points, t) => {
 *     if (t < 1 || points.length < t + 1) return false;
 *     for (let k = 0; k + t < points.length; k++) {
 *       const sides: blst.PublicKey[][] = [[], []];
 *       for (let l = 0; l <= t; l++) {
 *         for (let c = binomial(t, l); c > 0; c--) {
 *           sides[(t - l) % 2].push(points[k + l]);
 *         }
 *       }
 *       const [even, odd] = sides.map(s => blst.aggregatePublicKeys(s, false));
 *       if (!same(even, odd)) return false;
 *     }
 *     return true;
 *   },
 *   verify: (publicKey, message, signature) => {
 *     try {
 *       return blst.verify(message, publicKey, blst.Signature.fromBytes(signature, true));
 *     } catch {
 *       return false;
 *     }
 *   },
 *   createBatch: () => {
 *     const sets: blst.SignatureSet[] = [];
 *     return {
 *       add: (publicKey, message, signature) => {
 *         sets.push({ pk: publicKey, msg: message, sig: blst.Signature.fromBytes(signature, true) });
 *       },
 *       // blst weights each set with a random 64-bit scalar.
 *       verify: () => blst.verifyMultipleAggregateSignatures(sets),
 *     };
 *   },
 * };
 * ```
 */
export interface BlsBackend<PublicKey = unknown> {
  /**
   * Decodes a compressed G1 point. Throws for a malformed encoding, a point
   * not on the curve, and the identity. With `subgroupCheck`, also for a
   * point outside the prime-order subgroup; without it the backend may skip
   * that check (the SDK asks for it only where the result is implied by
   * other checks), and checking anyway is always correct.
   */
  decodePublicKey(bytes: Uint8Array, subgroupCheck: boolean): PublicKey;
  /** The sum of the keys (may be the identity). */
  aggregatePublicKeys(keys: PublicKey[]): PublicKey;
  /**
   * Whether `points[x]`, for x = 0..n, are the values of one polynomial of
   * degree below `threshold`: every `threshold`-th forward difference is the
   * identity. Must use exact curve arithmetic: the points need not be in the
   * subgroup.
   */
  onPolynomial(points: PublicKey[], threshold: number): boolean;
  /** Verifies one signature; false (not a throw) for a malformed signature. */
  verify(
    publicKey: PublicKey,
    message: Uint8Array,
    signature: Uint8Array,
  ): boolean;
  /** A new, empty signature batch. */
  createBatch(): BlsBatch<PublicKey>;
}

/* eslint-enable @typescript-eslint/method-signature-style */

const noble: BlsBackend<G1Point> = {
  decodePublicKey: (bytes, subgroupCheck) => decodeG1(bytes, subgroupCheck),
  aggregatePublicKeys: keys => sumG1(keys),
  onPolynomial: (points, threshold) => onPolynomial(points, threshold),
  verify: (publicKey, message, signature) =>
    verifyDecoded(publicKey, message, signature),
  createBatch: () => new NobleSignatureBatch(),
};

/**
 * The default backend: pure JavaScript on `@noble/curves`, in Node and in
 * browsers. Batches use random 64-bit weights; points that are not
 * subgroup-checked are decoded with one square root.
 */
export const nobleBls: BlsBackend = noble;
