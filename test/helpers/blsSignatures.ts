// Helpers that build invalid BLS signatures for the batch verification tests.
import { fromHexString, toHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import type { Hex } from 'viem';
import { depositDataRoot } from '../../src/deposits/verifyDepositData.js';
import type { Deposit } from '../../src/types.js';

const ls = bls12_381.longSignatures;
const G2 = bls12_381.G2.Point;
const { Fp, Fp2 } = bls12_381.fields;

const OFFSET = G2.BASE.multiply(123456789n);

const decode = (signature: string): typeof G2.BASE =>
  ls.Signature.fromBytes(fromHexString(signature));
const encode = (point: typeof G2.BASE): Hex =>
  toHexString(ls.Signature.toBytes(point)) as Hex;

/**
 * Returns `[a + D, b - D]` for a fixed G2 point D: two signatures that are
 * each invalid while their sum equals `a + b`.
 */
export const offsetSignaturePair = (a: string, b: string): [Hex, Hex] => [
  encode(decode(a).add(OFFSET)),
  encode(decode(b).subtract(OFFSET)),
];

/** Compressed encoding without noble's validity check (for points outside G2). */
const encodeUnchecked = (point: typeof G2.BASE): Hex => {
  const { x, y } = point.toAffine();
  const bytes = new Uint8Array(96);
  bytes.set(numberToBytesBE(x.c1, 48), 0);
  bytes.set(numberToBytesBE(x.c0, 48), 48);
  const half = (Fp.ORDER - 1n) / 2n;
  const yIsLarger = y.c1 === 0n ? y.c0 > half : y.c1 > half;
  bytes[0] |= yIsLarger ? 0xa0 : 0x80;
  return toHexString(bytes) as Hex;
};

/** A point on the G2 curve that is not in the prime-order subgroup. */
export const pointOutsideSubgroup = (): typeof G2.BASE => {
  const b = { c0: 4n, c1: 4n };
  for (let k = 1n; ; k++) {
    const x = { c0: k, c1: 1n };
    let y;
    try {
      y = Fp2.sqrt(Fp2.add(Fp2.mul(Fp2.sqr(x), x), b));
    } catch {
      continue;
    }
    const point = G2.fromAffine({ x, y });
    if (!point.isTorsionFree()) return point;
  }
};

/** `signature + P` for a curve point P outside the prime-order subgroup. */
export const signatureOutsideSubgroup = (signature: string): Hex =>
  encodeUnchecked(decode(signature).add(pointOutsideSubgroup()));

/** Copy of `deposit` with `signature` and the matching deposit data root. */
export const withSignature = (deposit: Deposit, signature: Hex): Deposit => ({
  ...deposit,
  signature,
  depositDataRoot: depositDataRoot({
    pubkey: deposit.pubkey,
    withdrawalCredentials: deposit.withdrawalCredentials,
    amountGwei: deposit.amount / 1_000_000_000n,
    signature,
  }),
});

/** Two copies of `deposit` signed with {@link offsetSignaturePair}. */
export const offsetDepositPair = (deposit: Deposit): [Deposit, Deposit] => {
  const [a, b] = offsetSignaturePair(deposit.signature, deposit.signature);
  return [withSignature(deposit, a), withSignature(deposit, b)];
};
