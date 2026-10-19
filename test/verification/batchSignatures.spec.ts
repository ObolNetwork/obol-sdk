// Batch BLS verification must accept a batch only when every signature in it
// is valid on its own.
import { fromHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
// Load the package entry first: the verification modules import each other.
import { validateClusterLock } from '../../src/index';
import { blsVerify, blsVerifyEach } from '../../src/blsUtils';
import {
  verifyBatchParallel,
  verifyBlsChecksParallel,
} from '../../src/verification/parallelPool';
import { verifyDVV1X10 } from '../../src/verification/v1.10.0';
import type { ClusterLock } from '../../src/types';
import { clusterLockV1X10 } from '../fixtures';
import {
  offsetSignaturePair,
  pointOutsideSubgroup,
  signatureOutsideSubgroup,
  withOffsetLockSignatures,
} from '../blsTestUtils';

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const hex = (bytes: Uint8Array): string =>
  '0x' + Buffer.from(bytes).toString('hex');
const INFINITY_G1 = new Uint8Array(48);
INFINITY_G1[0] = 0xc0;
const INFINITY_G2 = new Uint8Array(96);
INFINITY_G2[0] = 0xc0;

function buildCorpus(n: number): {
  pubkeys: Uint8Array[];
  messages: Uint8Array[];
  signatures: Uint8Array[];
} {
  const pubkeys: Uint8Array[] = [];
  const messages: Uint8Array[] = [];
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const seed = new Uint8Array(48);
    seed[0] = (i + 1) & 0xff;
    seed[1] = ((i + 1) >> 8) & 0xff;
    const sk = ls.keygen(seed).secretKey;
    pubkeys.push(ls.getPublicKey(sk).toBytes());
    const msg = new Uint8Array(32).fill(i & 0xff);
    messages.push(msg);
    signatures.push(ls.Signature.toBytes(ls.sign(ls.hash(msg, ETH2_DST), sk)));
  }
  return { pubkeys, messages, signatures };
}

/** Replace signatures i and j by an offset pair with an unchanged sum. */
function offsetPair(signatures: Uint8Array[], i: number, j: number): void {
  const [a, b] = offsetSignaturePair(hex(signatures[i]), hex(signatures[j]));
  signatures[i] = fromHexString(a);
  signatures[j] = fromHexString(b);
}

describe('blsVerifyEach', () => {
  it('accepts a batch of valid signatures', () => {
    const { pubkeys, messages, signatures } = buildCorpus(20);
    expect(blsVerifyEach(pubkeys, messages, signatures)).toBe(true);
  });

  it('accepts an empty batch and rejects mismatched lengths', () => {
    const { pubkeys, messages, signatures } = buildCorpus(3);
    expect(blsVerifyEach([], [], [])).toBe(true);
    expect(blsVerifyEach(pubkeys.slice(1), messages, signatures)).toBe(false);
  });

  it('rejects two invalid signatures whose sum is valid', () => {
    const { pubkeys, messages, signatures } = buildCorpus(20);
    offsetPair(signatures, 3, 11);
    expect(blsVerify(pubkeys[3], messages[3], signatures[3])).toBe(false);
    expect(blsVerify(pubkeys[11], messages[11], signatures[11])).toBe(false);
    expect(blsVerifyEach(pubkeys, messages, signatures)).toBe(false);
  });

  it('rejects a signature outside the prime-order subgroup', () => {
    expect(pointOutsideSubgroup().isTorsionFree()).toBe(false);
    const { pubkeys, messages, signatures } = buildCorpus(5);
    signatures[2] = fromHexString(signatureOutsideSubgroup(hex(signatures[2])));
    expect(() => ls.Signature.fromBytes(signatures[2])).toThrow(
      'not in prime-order subgroup',
    );
    expect(blsVerifyEach(pubkeys, messages, signatures)).toBe(false);
  });

  it('rejects an identity public key with an identity signature', () => {
    const { pubkeys, messages, signatures } = buildCorpus(3);
    pubkeys[1] = INFINITY_G1;
    signatures[1] = INFINITY_G2;
    expect(blsVerify(pubkeys[1], messages[1], signatures[1])).toBe(false);
    expect(blsVerifyEach(pubkeys, messages, signatures)).toBe(false);
  });
});

describe('verifyBatchParallel / verifyBlsChecksParallel', () => {
  it('rejects two invalid signatures whose sum is valid', async () => {
    const { pubkeys, messages, signatures } = buildCorpus(120);
    offsetPair(signatures, 0, 119);
    expect(await verifyBatchParallel(pubkeys, messages, signatures)).toBe(
      false,
    );
    const checks = pubkeys.map((pubkey, i) => ({
      pubkey,
      message: messages[i],
      signature: signatures[i],
    }));
    expect(await verifyBlsChecksParallel(checks)).toBe(false);
  });

  it('rejects a signature outside the prime-order subgroup', async () => {
    const { pubkeys, messages, signatures } = buildCorpus(4);
    signatures[0] = fromHexString(signatureOutsideSubgroup(hex(signatures[0])));
    expect(
      await verifyBlsChecksParallel(
        pubkeys.map((pubkey, i) => ({
          pubkey,
          message: messages[i],
          signature: signatures[i],
        })),
      ),
    ).toBe(false);
  });
});

describe('cluster lock deposit and builder registration signatures', () => {
  const lock = clusterLockV1X10 as unknown as ClusterLock;

  it('accepts the fixture lock', async () => {
    expect(await verifyDVV1X10(lock)).toBe(true);
    expect(await validateClusterLock(lock)).toBe(true);
  });

  // verifyDVV1X10 does not recompute lock_hash, so the BLS batch is the only
  // check that sees the replaced signatures.
  it('rejects a deposit and builder signature pair whose sum is valid', async () => {
    const tampered = withOffsetLockSignatures(lock);
    expect(await verifyDVV1X10(tampered)).toBe(false);
    expect(await validateClusterLock(tampered)).toBe(false);
  });
});
