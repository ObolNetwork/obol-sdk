/**
 * blst: a native BLS backend for Node servers (`@obolnetwork/obol-sdk/blst`).
 *
 * `cluster.verifyLock` at `full` checks every deposit, builder and aggregate
 * signature. The default backend is pure JavaScript (about 25 ms per
 * signature on one thread); over `@chainsafe/blst` the same 1k-validator lock
 * takes about 1.3 s instead of 80 s. `@chainsafe/blst` is an optional peer
 * dependency: install it next to the SDK. Only this entry refers to it, and
 * it loads it on the first `loadBlstBackend()` call, so no other entry (and
 * no browser bundle) needs it.
 *
 *   import { loadBlstBackend } from '@obolnetwork/obol-sdk/blst';
 *   const bls = await loadBlstBackend();          // once, at startup
 *   const ok = await isValidLock(lock, { bls, publicClients });
 *
 * Keep `level: 'full'` on a server: `attested` skips share binding and
 * `signature_aggregate`, which is not a way to save CPU on locks from users.
 */
import type { BlsBackend, BlsBatch } from '../cluster/blsBackend.js';
import { ObolError } from '../errors.js';

/* eslint-disable @typescript-eslint/method-signature-style --
   Method signatures keep the parameters bivariant (structural match with
   the @chainsafe/blst classes). */

/** The part of a `@chainsafe/blst` PublicKey the adapter uses. */
export interface BlstPublicKey {
  toBytes(compress?: boolean): Uint8Array;
}

/** The part of a `@chainsafe/blst` Signature the adapter uses. */
export type BlstSignature = object;

/**
 * The part of the `@chainsafe/blst` (2.x) module the adapter uses, so the
 * SDK's types do not depend on it being installed.
 */
export interface BlstModule {
  PublicKey: {
    fromBytes(bytes: Uint8Array, pkValidate?: boolean): BlstPublicKey;
  };
  Signature: {
    fromBytes(bytes: Uint8Array, sigValidate?: boolean): BlstSignature;
  };
  aggregatePublicKeys(
    keys: BlstPublicKey[],
    pksValidate?: boolean,
  ): BlstPublicKey;
  verify(
    message: Uint8Array,
    publicKey: BlstPublicKey,
    signature: BlstSignature,
  ): boolean;
  verifyMultipleAggregateSignatures(
    sets: Array<{
      msg: Uint8Array;
      pk: BlstPublicKey;
      sig: BlstSignature;
    }>,
  ): boolean;
}

/* eslint-enable @typescript-eslint/method-signature-style */

const binomial = (n: number, k: number): number => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * The `BlsBackend` over a `@chainsafe/blst` module the caller imported
 * itself (`import * as blst from '@chainsafe/blst'`). Every key and
 * signature is fully validated (subgroup checks are cheap natively); batches
 * use blst's random 64-bit weights.
 */
export const blstBackendFrom = (blst: BlstModule): BlsBackend => {
  const backend: BlsBackend<BlstPublicKey> = {
    decodePublicKey: bytes => blst.PublicKey.fromBytes(bytes, true),
    aggregatePublicKeys: keys => blst.aggregatePublicKeys(keys, false),
    // t-th forward differences as two sums with binomial multiplicities.
    onPolynomial: (points, t) => {
      if (t < 1 || points.length < t + 1) return false;
      for (let k = 0; k + t < points.length; k++) {
        const sides: BlstPublicKey[][] = [[], []];
        for (let l = 0; l <= t; l++) {
          for (let c = binomial(t, l); c > 0; c--) {
            sides[(t - l) % 2].push(points[k + l]);
          }
        }
        const [even, odd] = sides.map(side =>
          blst.aggregatePublicKeys(side, false).toBytes(),
        );
        if (!sameBytes(even, odd)) return false;
      }
      return true;
    },
    verify: (publicKey, message, signature) => {
      try {
        return blst.verify(
          message,
          publicKey,
          blst.Signature.fromBytes(signature, true),
        );
      } catch {
        return false;
      }
    },
    createBatch: (): BlsBatch<BlstPublicKey> => {
      const sets: Array<{
        msg: Uint8Array;
        pk: BlstPublicKey;
        sig: BlstSignature;
      }> = [];
      return {
        add: (publicKey, message, signature) => {
          sets.push({
            pk: publicKey,
            msg: message,
            sig: blst.Signature.fromBytes(signature, true),
          });
        },
        verify: () => blst.verifyMultipleAggregateSignatures(sets),
      };
    },
  };
  return backend as BlsBackend;
};

const isBlstModule = (value: unknown): value is BlstModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as BlstModule).verifyMultipleAggregateSignatures ===
    'function' &&
  typeof (value as BlstModule).PublicKey?.fromBytes === 'function';

let loaded: Promise<BlsBackend> | undefined;

/**
 * Loads `@chainsafe/blst` (once) and returns the backend over it.
 *
 * @throws BLS_BACKEND_UNAVAILABLE when `@chainsafe/blst` is not installed or
 *   its native binding does not load on this platform.
 */
export const loadBlstBackend = async (): Promise<BlsBackend> => {
  loaded ??= (async () => {
    try {
      const imported: unknown = await import('@chainsafe/blst');
      const module = isBlstModule(imported)
        ? imported
        : (imported as { default?: unknown }).default;
      if (!isBlstModule(module)) throw new Error('unexpected module shape');
      return blstBackendFrom(module);
    } catch (cause) {
      loaded = undefined;
      throw new ObolError(
        'BLS_BACKEND_UNAVAILABLE',
        `@chainsafe/blst could not be loaded: ${(cause as Error).message}`,
        {
          hint: 'Install @chainsafe/blst (2.x) next to the SDK, or use the default pure-JS backend',
          cause,
        },
      );
    }
  })();
  return await loaded;
};

export type { BlsBackend, BlsBatch } from '../cluster/blsBackend.js';
