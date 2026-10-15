// Node (ENR) signature verification over real cluster locks, plus malformed
// and non-canonical signature handling in the secp256k1 helpers.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ENR } from '@chainsafe/enr';
import { fromHexString } from '@chainsafe/ssz';
import { verifyNodeSignatures } from '../../src/verification/common.js';
import {
  parseSecp256k1Signature,
  secp256k1VerifyDigest,
} from '../../src/secp256k1Utils.js';
import {
  clusterLockSoloV1X10,
  nullDepositAmountsClusterLockV1X8,
  clusterLockWithSafe,
  clusterLockV1X10,
  clusterLockWithCompoundingWithdrawalss,
  clusterLockV1X11,
} from '../fixtures.js';

const CURVE_N = secp256k1.Point.CURVE().n;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Replaces s with n - s (same signature, high-s form), keeping r and v. */
const toHighS = (sig: string): string => {
  const hex = sig.replace(/^0x/, '');
  const s = BigInt('0x' + hex.slice(64, 128));
  const highS = (CURVE_N - s).toString(16).padStart(64, '0');
  return '0x' + hex.slice(0, 64) + highS + hex.slice(128);
};

const fixtureLocks: Record<string, any> = {
  clusterLockSoloV1X10,
  nullDepositAmountsClusterLockV1X8,
  clusterLockWithSafe,
  clusterLockV1X10,
  clusterLockWithCompoundingWithdrawalss,
  clusterLockV1X11,
};

// Locks whose operators all have ENRs and node signatures.
const signedLocks = Object.entries(fixtureLocks).filter(
  ([, lock]) =>
    lock.node_signatures?.length > 0 &&
    lock.cluster_definition.operators.every((op: any) => !!op.enr),
);

const withNodeSignature = (lock: any, index: number, signature: string) => ({
  ...lock,
  node_signatures: lock.node_signatures.map((sig: string, i: number) =>
    i === index ? signature : sig,
  ),
});

describe('verifyNodeSignatures', () => {
  it('has signed fixture locks to check', () => {
    expect(signedLocks.length).toBeGreaterThan(0);
  });

  describe.each(signedLocks)('%s', (_name, lock) => {
    it('verifies every node signature', () => {
      expect(verifyNodeSignatures(lock)).toBe(true);
    });

    it('verifies each signature individually and all are low-s', () => {
      const lockHash = fromHexString(lock.lock_hash);
      lock.node_signatures.forEach((sig: string, i: number) => {
        const { publicKey } = ENR.decodeTxt(
          lock.cluster_definition.operators[i].enr,
        );
        expect(secp256k1VerifyDigest(publicKey, lockHash, sig)).toBe(true);
        const s = BigInt('0x' + sig.slice(2 + 64, 2 + 128));
        expect(s <= CURVE_N / 2n).toBe(true);
      });
    });

    it('accepts signatures without the 0x prefix or recovery id', () => {
      const sig = lock.node_signatures[0];
      expect(
        verifyNodeSignatures(withNodeSignature(lock, 0, sig.slice(2))),
      ).toBe(true);
      expect(
        verifyNodeSignatures(withNodeSignature(lock, 0, sig.slice(0, 130))),
      ).toBe(true);
    });

    it('rejects a signature from the wrong operator', () => {
      if (lock.node_signatures.length < 2) return;
      expect(
        verifyNodeSignatures(
          withNodeSignature(lock, 0, lock.node_signatures[1]),
        ),
      ).toBe(false);
    });

    it('rejects a high-s signature', () => {
      const highS = toHighS(lock.node_signatures[0]);
      expect(verifyNodeSignatures(withNodeSignature(lock, 0, highS))).toBe(
        false,
      );
    });

    it.each([
      ['empty', '0x'],
      ['too short', (sig: string) => sig.slice(0, 128)],
      ['too long', (sig: string) => sig + '00'],
      ['non-hex', (sig: string) => sig.slice(0, -2) + 'zz'],
      ['r = 0', (sig: string) => '0x' + '0'.repeat(64) + sig.slice(66)],
      ['s = n', (sig: string) => sig.slice(0, 66) + CURVE_N.toString(16)],
    ])('rejects a malformed signature (%s) without throwing', (_c, make) => {
      const sig =
        typeof make === 'string' ? make : make(lock.node_signatures[0]);
      expect(() =>
        verifyNodeSignatures(withNodeSignature(lock, 0, sig)),
      ).not.toThrow();
      expect(verifyNodeSignatures(withNodeSignature(lock, 0, sig))).toBe(false);
    });
  });

  it('rejects a lock with missing node signatures', () => {
    const [, lock] = signedLocks[0];
    expect(
      verifyNodeSignatures({
        ...lock,
        node_signatures: lock.node_signatures.slice(1),
      }),
    ).toBe(false);
  });
});

describe('secp256k1 helpers', () => {
  const { secretKey, publicKey } = secp256k1.keygen();
  const digest = new Uint8Array(32).fill(0x42);
  const compact = secp256k1.sign(digest, secretKey, { prehash: false });

  it('parses 64- and 65-byte hex signatures', () => {
    expect(parseSecp256k1Signature(toHex(compact))).toEqual(compact);
    expect(parseSecp256k1Signature('0x' + toHex(compact) + '01')).toEqual(
      compact,
    );
  });

  it.each([
    ['empty', ''],
    ['63 bytes', 'ab'.repeat(63)],
    ['66 bytes', 'ab'.repeat(66)],
    ['odd length', 'a'.repeat(129)],
    ['non-hex', 'zz'.repeat(64)],
    ['not a string', 123],
  ])('returns null for %s', (_c, input) => {
    expect(parseSecp256k1Signature(input as any)).toBeNull();
  });

  it('verifies a compact and a 65-byte signature', () => {
    expect(secp256k1VerifyDigest(publicKey, digest, toHex(compact))).toBe(true);
    expect(
      secp256k1VerifyDigest(publicKey, digest, '0x' + toHex(compact) + '00'),
    ).toBe(true);
  });

  it('does not hash the digest again', () => {
    const prehashed = secp256k1.sign(digest, secretKey);
    expect(secp256k1VerifyDigest(publicKey, digest, toHex(prehashed))).toBe(
      false,
    );
  });

  it('rejects high-s, a wrong digest, a bad public key and bad digest length', () => {
    expect(
      secp256k1VerifyDigest(publicKey, digest, toHighS(toHex(compact))),
    ).toBe(false);
    expect(
      secp256k1VerifyDigest(
        publicKey,
        new Uint8Array(32).fill(0x43),
        toHex(compact),
      ),
    ).toBe(false);
    expect(
      secp256k1VerifyDigest(new Uint8Array(33), digest, toHex(compact)),
    ).toBe(false);
    expect(
      secp256k1VerifyDigest(publicKey, digest.slice(1), toHex(compact)),
    ).toBe(false);
  });
});
