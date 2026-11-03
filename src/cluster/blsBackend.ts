/**
 * The BLS12-381 primitives lock and deposit verification need, as an
 * injectable backend. The default is pure JavaScript (`@noble/curves`); only
 * the Node entry `@obolnetwork/obol-sdk/blst` loads a native module (the
 * optional peer `@chainsafe/blst`), and only when the caller asks for it.
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
 * For Node servers the SDK ships an adapter over `@chainsafe/blst` (native,
 * an optional peer dependency) in a separate entry, so no other entry and no
 * browser bundle refers to it:
 *
 * ```ts
 * import { loadBlstBackend } from '@obolnetwork/obol-sdk/blst';
 * const bls = await loadBlstBackend(); // or blstBackendFrom(await import('@chainsafe/blst'))
 * await cluster.isValidLock(lock, { bls });
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
