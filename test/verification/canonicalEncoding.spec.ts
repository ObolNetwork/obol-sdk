// BLS points must be decoded only from their canonical compressed encoding:
// each base field element below the modulus p, flag bits as the consensus
// spec defines them. Consensus clients reject anything else.
import { fromHexString, toHexString } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
// Load the package entry first: the verification modules import each other.
import { validateClusterLock } from '../../src/index';
import {
  blsAggregatePublicKeys,
  blsAggregateSignatures,
  blsRecoverDistributedPubkeyFromShares,
  blsThresholdAggregateSignatures,
  blsVerify,
  blsVerifyAggregate,
  blsVerifyEach,
  blsVerifyMultiple,
} from '../../src/blsUtils';
import { FORK_MAPPING } from '../../src/types';
import {
  computeDepositMsgRoot,
  depositDomainForFork,
  signingRoot,
} from '../../src/verification/common';
import { verifyDepositPayloads } from '../../src/verification/depositPayload';
import { verifyBlsChecksParallel } from '../../src/verification/parallelPool';
import { verifyDVV1X10 } from '../../src/verification/v1.10.0';
import type { ClusterLock } from '../../src/types';
import {
  clusterLockSoloV1X10,
  hoodiCompoundingDepositPayload,
} from '../fixtures';
import { addFieldModulus, withSignature } from '../blsTestUtils';

const ls = bls12_381.longSignatures;
const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const hex = (bytes: Uint8Array): string => toHexString(bytes);

interface Signer {
  secretKey: Uint8Array;
  pubkey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
}

function signer(i: number): Signer {
  const seed = new Uint8Array(48);
  seed[0] = (i + 1) & 0xff;
  seed[1] = ((i + 1) >> 8) & 0xff;
  const { secretKey } = ls.keygen(seed);
  const message = new Uint8Array(32).fill(i & 0xff);
  return {
    secretKey,
    pubkey: ls.getPublicKey(secretKey).toBytes(),
    message,
    signature: ls.Signature.toBytes(
      ls.sign(ls.hash(message, ETH2_DST), secretKey),
    ),
  };
}

const SIGNERS = Array.from({ length: 40 }, (_, i) => signer(i));

/** Index of the first signer whose encoding has room for x + p at `offset`. */
function findSigner(field: 'pubkey' | 'signature', offset: 0 | 48): number {
  const index = SIGNERS.findIndex(
    s => addFieldModulus(hex(s[field]), offset) !== null,
  );
  if (index === -1) throw new Error(`no signer fits ${field} at ${offset}`);
  return index;
}

/** `signers` with `field` of signer `index` re-encoded with x + p at `offset`. */
function reencoded(
  index: number,
  field: 'pubkey' | 'signature',
  offset: 0 | 48,
): Signer[] {
  const copy = SIGNERS.slice(0, Math.max(5, index + 1)).map(s => ({ ...s }));
  copy[index][field] = fromHexString(
    addFieldModulus(hex(SIGNERS[index][field]), offset)!,
  );
  return copy;
}

const columns = (
  signers: Signer[],
): [Uint8Array[], Uint8Array[], Uint8Array[]] => [
  signers.map(s => s.pubkey),
  signers.map(s => s.message),
  signers.map(s => s.signature),
];

describe('non-canonical field elements', () => {
  const cases: Array<[string, 'pubkey' | 'signature', 0 | 48]> = [
    ['public key x + p', 'pubkey', 0],
    ['signature x.c1 + p', 'signature', 0],
    ['signature x.c0 + p', 'signature', 48],
  ];

  it('valid signatures pass', async () => {
    const [pubkeys, messages, signatures] = columns(SIGNERS);
    SIGNERS.forEach(s =>
      expect(blsVerify(s.pubkey, s.message, s.signature)).toBe(true),
    );
    expect(blsVerifyEach(pubkeys, messages, signatures)).toBe(true);
    expect(
      await verifyBlsChecksParallel(
        SIGNERS.map(s => ({
          pubkey: s.pubkey,
          message: s.message,
          signature: s.signature,
        })),
      ),
    ).toBe(true);
  });

  it.each(cases)(
    'rejects a %s in blsVerify and blsVerifyEach',
    async (_label, field, offset) => {
      const index = findSigner(field, offset);
      const signers = reencoded(index, field, offset);
      const s = signers[index];
      // The re-encoding is the same point once reduced mod p.
      expect(s[field]).not.toEqual(SIGNERS[index][field]);
      expect(blsVerify(s.pubkey, s.message, s.signature)).toBe(false);
      expect(blsVerifyEach(...columns(signers))).toBe(false);
      expect(
        await verifyBlsChecksParallel(
          signers.map(t => ({
            pubkey: t.pubkey,
            message: t.message,
            signature: t.signature,
          })),
        ),
      ).toBe(false);
    },
  );

  it('rejects a re-encoded public key in the aggregate helpers', () => {
    const index = findSigner('pubkey', 0);
    const signers = reencoded(index, 'pubkey', 0);
    const [pubkeys, messages, signatures] = columns(signers);
    const [canonical] = columns(SIGNERS.slice(0, signers.length));
    expect(() => blsAggregatePublicKeys(pubkeys)).toThrow('modulus');
    // One aggregate signature over distinct messages.
    const aggregate = blsAggregateSignatures(signatures);
    expect(blsVerifyMultiple(canonical, messages, aggregate)).toBe(true);
    expect(blsVerifyMultiple(pubkeys, messages, aggregate)).toBe(false);
    // One aggregate signature over a common message.
    const message = new Uint8Array(32).fill(0xee);
    const common = blsAggregateSignatures(
      signers.map(s =>
        ls.Signature.toBytes(ls.sign(ls.hash(message, ETH2_DST), s.secretKey)),
      ),
    );
    expect(blsVerifyAggregate(canonical, message, common)).toBe(true);
    expect(blsVerifyAggregate(pubkeys, message, common)).toBe(false);
  });

  it('rejects a re-encoded signature in the aggregate helpers', () => {
    const index = findSigner('signature', 48);
    const [, , signatures] = columns(reencoded(index, 'signature', 48));
    expect(() => blsAggregateSignatures(signatures)).toThrow('modulus');
    expect(() =>
      blsThresholdAggregateSignatures(
        new Map(signatures.map((sig, i) => [i + 1, sig])),
      ),
    ).toThrow('modulus');
  });

  it('rejects a re-encoded share in distributed key recovery', () => {
    const index = findSigner('pubkey', 0);
    const shares = reencoded(index, 'pubkey', 0).map(s => s.pubkey);
    expect(
      blsRecoverDistributedPubkeyFromShares(shares, shares.length),
    ).toBeNull();
  });
});

describe('flag bits', () => {
  const { pubkey, message, signature } = SIGNERS[0];
  const withFirstByte = (bytes: Uint8Array, first: number): Uint8Array => {
    const copy = bytes.slice();
    copy[0] = first;
    return copy;
  };
  const infinity = (length: number, first = 0xc0): Uint8Array => {
    const bytes = new Uint8Array(length);
    bytes[0] = first;
    return bytes;
  };

  it('rejects encodings without the compression flag', () => {
    expect(
      blsVerify(withFirstByte(pubkey, pubkey[0] & 0x7f), message, signature),
    ).toBe(false);
    expect(
      blsVerify(pubkey, message, withFirstByte(signature, signature[0] & 0x7f)),
    ).toBe(false);
    // Uncompressed G1 encoding of a valid key.
    const uncompressed = bls12_381.G1.Point.fromBytes(pubkey).toBytes(false);
    expect(blsVerify(uncompressed, message, signature)).toBe(false);
  });

  it('rejects wrong lengths', () => {
    expect(blsVerify(pubkey.slice(0, 47), message, signature)).toBe(false);
    expect(blsVerify(pubkey, message, signature.slice(0, 95))).toBe(false);
  });

  it('rejects a field element equal to p', () => {
    const p = bls12_381.fields.Fp.ORDER.toString(16).padStart(96, '0');
    const g1 = fromHexString(p);
    g1[0] |= 0x80;
    expect(() => blsAggregatePublicKeys([g1])).toThrow('modulus');
    const g2 = fromHexString(p + '00'.repeat(48));
    g2[0] |= 0x80;
    expect(() => blsAggregateSignatures([g2])).toThrow('modulus');
  });

  it('accepts the canonical point at infinity only where the identity is allowed', () => {
    expect(hex(blsAggregatePublicKeys([infinity(48), pubkey]))).toBe(
      hex(pubkey),
    );
    expect(blsVerify(infinity(48), message, infinity(96))).toBe(false);
    expect(blsVerifyEach([infinity(48)], [message], [infinity(96)])).toBe(
      false,
    );
  });

  it.each([
    ['the sort flag', 0xe0, 0],
    ['other bits in the first byte', 0xc1, 0],
    ['bits in a later byte', 0xc0, 47],
  ])('rejects a point at infinity with %s set', (_label, first, later) => {
    const g1 = infinity(48, first);
    const g2 = infinity(96, first);
    if (later) {
      g1[later] = 1;
      g2[later] = 1;
    }
    expect(() => blsAggregatePublicKeys([g1])).toThrow('infinity');
    expect(() => blsAggregateSignatures([g2])).toThrow('infinity');
  });
});

describe('verifyDepositPayloads', () => {
  const hoodi = hoodiCompoundingDepositPayload;

  it('rejects a deposit signature re-encoded with x.c0 + p', async () => {
    const signature = addFieldModulus(hoodi.deposit.signature, 48);
    expect(signature).not.toBeNull();
    const deposit = withSignature(hoodi.deposit, signature!);
    await expect(
      verifyDepositPayloads([hoodi.deposit], { chainId: hoodi.chainId }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositPayloads([hoodi.deposit, deposit], {
        chainId: hoodi.chainId,
      }),
    ).rejects.toThrow('Invalid deposit at index 1: invalid deposit signature');
  });

  it('rejects a deposit signed for a re-encoded public key', async () => {
    const { secretKey, pubkey } = SIGNERS[findSigner('pubkey', 0)];
    const signedFor = (pubkeyHex: string): typeof hoodi.deposit => {
      const message = signingRoot(
        depositDomainForFork(FORK_MAPPING[hoodi.chainId] as string),
        computeDepositMsgRoot({
          pubkey: pubkeyHex,
          withdrawal_credentials: hoodi.deposit.withdrawal_credentials,
          amount: (
            BigInt(hoodi.deposit.amount) / BigInt(1_000_000_000)
          ).toString(),
        }),
      );
      const signature = ls.sign(ls.hash(message, ETH2_DST), secretKey);
      return withSignature(
        { ...hoodi.deposit, pubkey: pubkeyHex },
        hex(ls.Signature.toBytes(signature)),
      );
    };
    await expect(
      verifyDepositPayloads([signedFor(hex(pubkey))], {
        chainId: hoodi.chainId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositPayloads([signedFor(addFieldModulus(hex(pubkey), 0)!)], {
        chainId: hoodi.chainId,
      }),
    ).rejects.toThrow('Invalid deposit at index 0: invalid deposit signature');
  });
});

// verifyDVV1X10 does not recompute lock_hash, so the decode is the only check
// that sees a re-encoded value.
describe('cluster lock validation', () => {
  const lock = clusterLockSoloV1X10 as unknown as ClusterLock;
  const tampered = (edit: (copy: ClusterLock) => void): ClusterLock => {
    const copy = JSON.parse(JSON.stringify(lock)) as ClusterLock;
    edit(copy);
    return copy;
  };

  it('accepts the fixture lock', async () => {
    expect(await verifyDVV1X10(lock)).toBe(true);
    expect(await validateClusterLock(lock)).toBe(true);
  });

  it('rejects a public share re-encoded with x + p', async () => {
    const copy = tampered(l => {
      const shares = l.distributed_validators[0].public_shares;
      shares[0] = addFieldModulus(shares[0], 0)!;
      expect(shares[0]).not.toBeNull();
    });
    expect(await verifyDVV1X10(copy)).toBe(false);
    expect(await validateClusterLock(copy)).toBe(false);
  });

  it('rejects a deposit signature re-encoded with x.c0 + p', async () => {
    const copy = tampered(l => {
      const deposit = l.distributed_validators[0].partial_deposit_data![0];
      deposit.signature = addFieldModulus(deposit.signature!, 48)!;
      expect(deposit.signature).not.toBeNull();
    });
    expect(await verifyDVV1X10(copy)).toBe(false);
    expect(await validateClusterLock(copy)).toBe(false);
  });
});
