// The @chainsafe/blst adapter from the BlsBackend TSDoc (src/cluster/blsBackend.ts).
import * as blst from '@chainsafe/blst';
import type { BlsBackend } from '../../src/cluster/blsBackend.js';

const binomial = (n: number, k: number): number => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
const same = (a: blst.PublicKey, b: blst.PublicKey): boolean =>
  Buffer.compare(a.toBytes(), b.toBytes()) === 0;

export const blstBackend: BlsBackend<blst.PublicKey> = {
  // Native validation is cheap, so every key is fully checked.
  decodePublicKey: bytes => blst.PublicKey.fromBytes(bytes, true),
  aggregatePublicKeys: keys => blst.aggregatePublicKeys(keys, false),
  // t-th forward differences as two sums with binomial multiplicities.
  onPolynomial: (points, t) => {
    if (t < 1 || points.length < t + 1) return false;
    for (let k = 0; k + t < points.length; k++) {
      const sides: blst.PublicKey[][] = [[], []];
      for (let l = 0; l <= t; l++) {
        for (let c = binomial(t, l); c > 0; c--) {
          sides[(t - l) % 2].push(points[k + l]);
        }
      }
      const [even, odd] = sides.map(s => blst.aggregatePublicKeys(s, false));
      if (!same(even, odd)) return false;
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
  createBatch: () => {
    const sets: blst.SignatureSet[] = [];
    return {
      add: (publicKey, message, signature) => {
        sets.push({
          pk: publicKey,
          msg: message,
          sig: blst.Signature.fromBytes(signature, true),
        });
      },
      // blst weights each set with a random 64-bit scalar.
      verify: () => blst.verifyMultipleAggregateSignatures(sets),
    };
  },
};
