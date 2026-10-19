// Helpers that build invalid BLS signatures for the batch verification tests.
import { fromHexString, toHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { depositDataContainer } from '../src/verification/sszTypes.js';
import type { ClusterLock, ValidatorDeposit } from '../src/types.js';

const ls = bls12_381.longSignatures;
const G2 = bls12_381.G2.Point;
const { Fp, Fp2 } = bls12_381.fields;

const OFFSET = G2.BASE.multiply(BigInt(123456789));

const decode = (signature: string): typeof G2.BASE =>
  ls.Signature.fromBytes(fromHexString(signature));
const encode = (point: typeof G2.BASE): string =>
  toHexString(ls.Signature.toBytes(point));

/**
 * Returns `[a + D, b - D]` for a fixed G2 point D: two signatures that are
 * each invalid while their sum equals `a + b`.
 */
export const offsetSignaturePair = (a: string, b: string): [string, string] => [
  encode(decode(a).add(OFFSET)),
  encode(decode(b).subtract(OFFSET)),
];

/** Compressed encoding without noble's validity check (for points outside G2). */
const encodeUnchecked = (point: typeof G2.BASE): string => {
  const { x, y } = point.toAffine();
  const bytes = new Uint8Array(96);
  bytes.set(numberToBytesBE(x.c1, 48), 0);
  bytes.set(numberToBytesBE(x.c0, 48), 48);
  const half = (Fp.ORDER - BigInt(1)) / BigInt(2);
  const yIsLarger = y.c1 === BigInt(0) ? y.c0 > half : y.c1 > half;
  bytes[0] |= yIsLarger ? 0xa0 : 0x80;
  return toHexString(bytes);
};

/** A point on the G2 curve that is not in the prime-order subgroup. */
export const pointOutsideSubgroup = (): typeof G2.BASE => {
  const b = { c0: BigInt(4), c1: BigInt(4) };
  for (let k = 1; ; k++) {
    const x = { c0: BigInt(k), c1: BigInt(1) };
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
export const signatureOutsideSubgroup = (signature: string): string =>
  encodeUnchecked(decode(signature).add(pointOutsideSubgroup()));

/** Copy of `deposit` with `signature` and the matching deposit_data_root. */
export const withSignature = (
  deposit: ValidatorDeposit,
  signature: string,
): ValidatorDeposit => {
  const root = depositDataContainer.hashTreeRoot({
    pubkey: fromHexString(deposit.pubkey),
    withdrawal_credentials: fromHexString(deposit.withdrawal_credentials),
    amount: BigInt(deposit.amount) / BigInt(1_000_000_000),
    signature: fromHexString(signature),
  });
  return { ...deposit, signature, deposit_data_root: toHexString(root) };
};

/**
 * Copy of a lock whose first validator's deposit and builder registration
 * signatures are replaced by {@link offsetSignaturePair}. Hashes are not
 * recomputed.
 */
export const withOffsetLockSignatures = (lock: ClusterLock): ClusterLock => {
  const copy = JSON.parse(JSON.stringify(lock)) as ClusterLock;
  const validator = copy.distributed_validators[0];
  const deposit = validator.partial_deposit_data![0];
  const builder = validator.builder_registration!;
  [deposit.signature, builder.signature] = offsetSignaturePair(
    deposit.signature!,
    builder.signature,
  );
  return copy;
};

/** Two copies of `deposit` signed with {@link offsetSignaturePair}. */
export const offsetDepositPair = (
  deposit: ValidatorDeposit,
): [ValidatorDeposit, ValidatorDeposit] => {
  const [a, b] = offsetSignaturePair(deposit.signature, deposit.signature);
  return [withSignature(deposit, a), withSignature(deposit, b)];
};
