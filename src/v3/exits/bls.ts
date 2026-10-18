/**
 * BLS12-381 helpers (Ethereum consensus: G1 public keys, G2 signatures, POP
 * ciphersuite). Vectors: distributed-validator-specs bls_threshold.json.
 */
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { Type } from '@sinclair/typebox';
import { fromHexString } from '@chainsafe/ssz';
import { bytesToHex, type Hex } from 'viem';
import {
  blsAggregateSignatures,
  blsThresholdAggregateSignatures,
  blsVerify as verifyBytes,
} from '../../blsUtils.js';
import { decode, invalid, T } from '../schema.js';

const ShareIndex = Type.Integer({ minimum: 1 });

const uniqueIndices = (items: Array<{ index: number }>, path: string): void => {
  const seen = new Set<number>();
  items.forEach((item, i) => {
    if (seen.has(item.index)) {
      throw invalid(`${path}[${i}].index`, 'duplicate share index');
    }
    seen.add(item.index);
  });
};

/** Whether `signature` is a valid BLS signature of `message` by `pubkey`. */
export const blsVerify = (pubkey: Hex, message: Hex, signature: Hex): boolean =>
  verifyBytes(
    fromHexString(decode(T.Pubkey, pubkey, 'pubkey')),
    fromHexString(decode(T.Hex, message, 'message')),
    fromHexString(decode(T.BlsSignature, signature, 'signature')),
  );

/**
 * Plain aggregate (sum) of signatures: a multi-signature that verifies
 * against the aggregate of the signers' keys, as `signature_aggregate` in a
 * lock. Not a threshold signature.
 */
export const blsAggregate = (signatures: Hex[]): Hex => {
  const sigs = decode(
    Type.Array(T.BlsSignature, { minItems: 1 }),
    signatures,
    'signatures',
  );
  try {
    return bytesToHex(blsAggregateSignatures(sigs.map(s => fromHexString(s))));
  } catch {
    throw invalid('signatures', 'must be valid BLS signatures (G2 points)');
  }
};

/**
 * Threshold aggregate: Lagrange interpolation at 0 over the given partial
 * signatures by 1-based share index, as Charon `tbls.ThresholdAggregate`.
 * Gives the group signature when the partials are `threshold` or more valid
 * shares; callers should verify the result against the group key.
 */
export const blsThresholdAggregate = (
  partials: Array<{ index: number; signature: Hex }>,
): Hex => {
  const items = decode(
    Type.Array(Type.Object({ index: ShareIndex, signature: T.BlsSignature }), {
      minItems: 1,
    }),
    partials,
    'partials',
  );
  uniqueIndices(items, 'partials');
  try {
    return bytesToHex(
      blsThresholdAggregateSignatures(
        new Map(items.map(p => [p.index, fromHexString(p.signature)])),
      ),
    );
  } catch {
    throw invalid('partials', 'signatures must be valid BLS signatures');
  }
};

const lagrangeAtZero = (index: bigint, indices: bigint[]): bigint => {
  const { Fr } = bls12_381.fields;
  let num = 1n;
  let den = 1n;
  for (const j of indices) {
    if (j === index) continue;
    num = Fr.mul(num, Fr.neg(j));
    den = Fr.mul(den, Fr.sub(index, j));
  }
  return Fr.mul(num, Fr.inv(den));
};

/**
 * Recovers a group public key from public shares by 1-based share index
 * (Lagrange interpolation at 0 in G1). Needs `threshold` shares of one
 * sharing; with fewer the result is some other key.
 */
export const blsRecoverPubkey = (
  shares: Array<{ index: number; pubshare: Hex }>,
): Hex => {
  const items = decode(
    Type.Array(Type.Object({ index: ShareIndex, pubshare: T.Pubkey }), {
      minItems: 1,
    }),
    shares,
    'shares',
  );
  uniqueIndices(items, 'shares');
  const indices = items.map(s => BigInt(s.index));
  try {
    let sum = bls12_381.G1.Point.ZERO;
    items.forEach((share, i) => {
      const point = bls12_381.G1.Point.fromHex(share.pubshare.slice(2));
      sum = sum.add(point.multiply(lagrangeAtZero(indices[i], indices)));
    });
    return bytesToHex(sum.toBytes());
  } catch {
    throw invalid('shares', 'public shares must be valid BLS public keys');
  }
};
