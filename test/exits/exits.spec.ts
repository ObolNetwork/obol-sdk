import { readFileSync } from 'node:fs';
import { SignableENR } from '@chainsafe/enr';
import {
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  UintBigintType,
  fromHexString,
} from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { ObolError } from '../../src/errors.js';
import {
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
  createExitsModule,
  type PartialExitBlob,
  type StoredExitBlob,
} from '../../src/exits/index.js';
import { aggregate } from '../../src/exits/aggregate.js';
import { verifyPartialExit } from '../../src/exits/verifyPartialExit.js';
import {
  exitSigningRoot,
  partialExitsPayloadRoot,
} from '../../src/exits/ssz.js';
import { nobleBls } from '../../src/cluster/blsBackend.js';
import { blstBackend } from '../helpers/blstBackend.js';
import { fakeChain } from '../helpers/fakeChain.js';

// Shares 1..4 of one 3-of-4 sharing, from distributed-validator-specs.
const vectors = JSON.parse(
  readFileSync('test/fixtures/spec/bls_threshold.json', 'utf8'),
);
const shareSecret = (idx: number): Hex =>
  `0x${vectors.partials.find((p: any) => p.input.share_idx === idx).input.secret_hex}`;
const pubshare = (idx: number): Hex =>
  `0x${vectors.partials.find((p: any) => p.input.share_idx === idx).pubshare_hex}`;
const GROUP_PUBKEY: Hex = `0x${vectors.group_pubkey_hex}`;
const GROUP_SECRET: Hex = `0x${vectors.group_secret_hex}`;

const HOODI = '0x10000910';
const HOODI_CAPELLA = '0x40000910';
const HOODI_GVR =
  '0x212f13fc4df078b6cb7db228f1c8307566dcecf900867401a92023d7ba99cb5f';
const PINNED_PAYLOAD_ROOT =
  '0xd349f6855a08ff2392b955d0996f230ec6aa741f75f6f9f5ab2d62490798e2a6';
const PINNED_SIGNING_ROOT =
  '0x806c0c794d21d62350b0615de23eaf647d3e0c79c1ed964cded8da9eee14ccaf';

const { longSignatures: ls } = bls12_381;
const Fr = bls12_381.fields.Fr;
const DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const blsSign = (secret: Hex, message: Uint8Array): Hex =>
  bytesToHex(
    ls.Signature.toBytes(ls.sign(ls.hash(message, DST), hexToBytes(secret))),
  );
const secretHex = (n: bigint): Hex => bytesToHex(Fr.toBytes(n));
const pubkeyOf = (secret: Hex): Hex =>
  bytesToHex(ls.getPublicKey(hexToBytes(secret)).toBytes(true));

// A second validator of the same cluster: a random 3-of-4 sharing.
const coefficients = [11n, 22n, 33n].map(k => Fr.create(k * 987654321123n));
const shareOf = (x: bigint): bigint =>
  Fr.create(coefficients.reduce((sum, a, k) => sum + a * x ** BigInt(k), 0n));
const SECOND = {
  secret: (idx: number): Hex => secretHex(shareOf(BigInt(idx))),
  pubkey: pubkeyOf(secretHex(coefficients[0])),
};

const operatorKeys = [1, 2, 3, 4].map(() => secp256k1.keygen().secretKey);
const enrs = operatorKeys.map(k => SignableENR.createV4(k).encodeTxt());

const cluster = {
  operators: enrs.map(enr => ({ enr })),
  forkVersion: HOODI,
  validators: [
    {
      distributedPublicKey: GROUP_PUBKEY,
      publicShares: [1, 2, 3, 4].map(pubshare),
    },
    {
      distributedPublicKey: SECOND.pubkey,
      publicShares: [1, 2, 3, 4].map(i => pubkeyOf(SECOND.secret(i))),
    },
  ],
};

const message = { epoch: '200', validator_index: '42' };

const blob = (
  shareIdx: number,
  msg = message,
  secret = shareSecret(shareIdx),
  publicKey: Hex = GROUP_PUBKEY,
): PartialExitBlob => ({
  public_key: publicKey,
  signed_exit_message: {
    message: msg,
    signature: blsSign(secret, exitSigningRoot(msg, HOODI_CAPELLA, HOODI_GVR)),
  },
});

const secondBlob = (shareIdx: number): PartialExitBlob =>
  blob(
    shareIdx,
    { epoch: '200', validator_index: '7' },
    SECOND.secret(shareIdx),
    SECOND.pubkey,
  );

// The payload container, written out here (not taken from src) to check the
// signed root independently: Charon and the API sort by validator index first.
const uint64 = new UintBigintType(8);
const PayloadType = new ContainerType({
  partial_exits: new ListCompositeType(
    new ContainerType({
      public_key: new ByteVectorType(48),
      signed_exit_message: new ContainerType({
        message: new ContainerType({ epoch: uint64, validator_index: uint64 }),
        signature: new ByteVectorType(96),
      }),
    }),
    65536,
  ),
  share_idx: uint64,
});
const rootAsListed = (blobs: PartialExitBlob[], shareIdx: number): Uint8Array =>
  PayloadType.hashTreeRoot({
    partial_exits: blobs.map(b => ({
      public_key: fromHexString(b.public_key),
      signed_exit_message: {
        message: {
          epoch: BigInt(b.signed_exit_message.message.epoch),
          validator_index: BigInt(
            b.signed_exit_message.message.validator_index,
          ),
        },
        signature: fromHexString(b.signed_exit_message.signature),
      },
    })),
    share_idx: BigInt(shareIdx),
  });
const byIndex = (blobs: PartialExitBlob[]): PartialExitBlob[] =>
  [...blobs].sort(
    (a, b) =>
      Number(a.signed_exit_message.message.validator_index) -
      Number(b.signed_exit_message.message.validator_index),
  );

/** Signs a root like Charon: 65 bytes, r || s || v. */
const sign65 = (root: Uint8Array, signer: Uint8Array): Hex => {
  const recovered = secp256k1.sign(root, signer, {
    prehash: false,
    format: 'recovered',
  });
  return bytesToHex(new Uint8Array([...recovered.slice(1), recovered[0]]));
};

/** The payload as Charon submits it: the root of the sorted partial exits. */
const payloadFor = (
  shareIdx: number,
  partialExits: PartialExitBlob[],
  signer = operatorKeys[shareIdx - 1],
) => ({
  share_idx: shareIdx,
  partial_exits: partialExits,
  signature: sign65(rootAsListed(byIndex(partialExits), shareIdx), signer),
});

const caught = (fn: () => unknown): ObolError => {
  try {
    fn();
  } catch (e) {
    return e as ObolError;
  }
  throw new Error('expected a throw');
};

/** A stored exitblobs document with the given partial signatures by position. */
const stored = (
  signatures: Record<string, string>,
  msg = message,
): StoredExitBlob => ({
  lock_hash: `0x${'ab'.repeat(32)}`,
  publickey: GROUP_PUBKEY,
  epoch: msg.epoch,
  validator_index: msg.validator_index,
  shares_exit_data: Object.fromEntries(
    Object.entries(signatures).map(([k, sig]) => [
      k,
      { public_share: pubshare(Number(k) + 1), partial_exit_signature: sig },
    ]),
  ),
});

describe('exits SSZ', () => {
  // Pinned from SDK 2.x (`Exit.computeExitPayloadRoot` and
  // `verifyPartialExitSignature` on Hoodi) before it was removed.
  it('payload root matches 2.x', () => {
    expect(bytesToHex(partialExitsPayloadRoot([blob(2)], 2))).toBe(
      PINNED_PAYLOAD_ROOT,
    );
  });

  it('exit signing root matches 2.x verification', () => {
    expect(bytesToHex(exitSigningRoot(message, HOODI_CAPELLA, HOODI_GVR))).toBe(
      PINNED_SIGNING_ROOT,
    );
  });

  it('the payload root is of the partial exits sorted by validator index', () => {
    const unsorted = [blob(2), secondBlob(2)];
    expect(bytesToHex(partialExitsPayloadRoot(unsorted, 2))).toBe(
      bytesToHex(rootAsListed(byIndex(unsorted), 2)),
    );
    expect(bytesToHex(partialExitsPayloadRoot(unsorted, 2))).not.toBe(
      bytesToHex(rootAsListed(unsorted, 2)),
    );
  });
});

describe('exits.verifyPartialExit', () => {
  it('returns new valid blobs', () => {
    const blobs = [blob(2)];
    expect(
      verifyPartialExit({ cluster, payload: payloadFor(2, blobs) }),
    ).toEqual(blobs);
  });

  it('accepts a payload signed the way Charon signs it (sorted, 65 bytes)', () => {
    const blobs = [blob(3), secondBlob(3)];
    expect(
      verifyPartialExit({ cluster, payload: payloadFor(3, blobs) }),
    ).toEqual(byIndex(blobs));
  });

  it('rejects a signature over the unsorted list', () => {
    const blobs = [blob(3), secondBlob(3)];
    const payload = {
      share_idx: 3,
      partial_exits: blobs,
      signature: sign65(rootAsListed(blobs, 3), operatorKeys[2]),
    };
    expect(caught(() => verifyPartialExit({ cluster, payload })).code).toBe(
      'EXIT_PAYLOAD_SIGNATURE_INVALID',
    );
  });

  it('accepts a high-s payload signature, as the API does', () => {
    const payload = payloadFor(2, [blob(2)]);
    const bytes = hexToBytes(payload.signature as Hex);
    const n = secp256k1.Point.Fn.ORDER;
    const s = BigInt(bytesToHex(bytes.slice(32, 64)));
    const high = (n - s).toString(16).padStart(64, '0');
    const flipped = `${bytesToHex(bytes.slice(0, 32))}${high}${bytes[64] === 0 ? '01' : '00'}`;
    expect(
      verifyPartialExit({
        cluster,
        payload: { ...payload, signature: flipped },
      }),
    ).toHaveLength(1);
  });

  it('normalises leading zeros and hex case', () => {
    const mine = blob(2);
    const padded = {
      public_key: mine.public_key.toUpperCase().replace('0X', '0x'),
      signed_exit_message: {
        message: { epoch: '0200', validator_index: '00042' },
        signature: mine.signed_exit_message.signature,
      },
    };
    const payload = payloadFor(2, [padded]);
    expect(verifyPartialExit({ cluster, payload })).toEqual([mine]);
  });

  it('rejects a 64-byte payload signature', () => {
    const payload = payloadFor(2, [blob(2)]);
    payload.signature = payload.signature.slice(0, 130) as Hex;
    expect(caught(() => verifyPartialExit({ cluster, payload })).code).toBe(
      'EXIT_PAYLOAD_SIGNATURE_INVALID',
    );
  });

  it.each([0, 5])(
    'rejects share_idx %d (EXIT_SHARE_INDEX_INVALID)',
    shareIdx => {
      const payload = { ...payloadFor(1, [blob(1)]), share_idx: shareIdx };
      expect(caught(() => verifyPartialExit({ cluster, payload })).code).toBe(
        'EXIT_SHARE_INDEX_INVALID',
      );
    },
  );

  it('rejects a payload signed by another operator', () => {
    const payload = payloadFor(2, [blob(2)], operatorKeys[0]);
    expect(caught(() => verifyPartialExit({ cluster, payload })).code).toBe(
      'EXIT_PAYLOAD_SIGNATURE_INVALID',
    );
  });

  it('rejects an unparsable ENR with PAYLOAD_INVALID', () => {
    const bad = {
      ...cluster,
      operators: [{ enr: 'enr:-nope' }, ...cluster.operators.slice(1)],
    };
    const error = caught(() =>
      verifyPartialExit({ cluster: bad, payload: payloadFor(1, [blob(1)]) }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect((error.details.issues as any[])[0].path).toBe(
      'cluster.operators[0].enr',
    );
  });

  it.each([
    ['without a genesis validators root (Gnosis)', '0x00000064'],
    ['unknown', '0x12345678'],
  ])('rejects a fork %s (UNSUPPORTED_CHAIN)', (_n, forkVersion) => {
    const payload = payloadFor(1, [blob(1)]);
    expect(
      caught(() =>
        verifyPartialExit({ cluster: { ...cluster, forkVersion }, payload }),
      ).code,
    ).toBe('UNSUPPORTED_CHAIN');
  });

  it('rejects a validator that is not in the cluster', () => {
    const other = { ...blob(1), public_key: pubshare(4) };
    expect(
      caught(() =>
        verifyPartialExit({ cluster, payload: payloadFor(1, [other]) }),
      ).code,
    ).toBe('EXIT_VALIDATOR_NOT_IN_CLUSTER');
  });

  it('rejects a validator without a public share at share_idx', () => {
    const short = {
      ...cluster,
      validators: [
        { distributedPublicKey: GROUP_PUBKEY, publicShares: [pubshare(1)] },
      ],
    };
    expect(
      caught(() =>
        verifyPartialExit({
          cluster: short,
          payload: payloadFor(2, [blob(2)]),
        }),
      ).code,
    ).toBe('EXIT_SHARE_INDEX_INVALID');
  });

  it('rejects a partial signature by another share', () => {
    const wrong = { ...blob(3) };
    expect(
      caught(() =>
        verifyPartialExit({ cluster, payload: payloadFor(2, [wrong]) }),
      ).code,
    ).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
  });

  describe('against the stored exits', () => {
    const mine = blob(2);
    const run = (
      existing: StoredExitBlob[] | Record<string, StoredExitBlob>,
      blobs = [mine],
    ) =>
      verifyPartialExit({ cluster, payload: payloadFor(2, blobs), existing });

    it('drops the blob already stored (case-insensitive)', () => {
      const doc = stored({
        '1': mine.signed_exit_message.signature
          .toUpperCase()
          .replace('0X', '0x'),
      });
      expect(run([doc])).toEqual([]);
      expect(run({ [GROUP_PUBKEY.toUpperCase()]: doc })).toEqual([]);
    });

    it('accepts shares_exit_data wrapped in an array', () => {
      const doc = stored({ '1': mine.signed_exit_message.signature });
      expect(
        run([{ ...doc, shares_exit_data: [doc.shares_exit_data as any] }]),
      ).toEqual([]);
    });

    it('keeps a share not stored yet (missing key)', () => {
      expect(
        run([stored({ '0': blob(1).signed_exit_message.signature })]),
      ).toEqual([mine]);
    });

    it('checks every blob against the stored exit of its own pubkey', () => {
      const other = {
        ...stored({}),
        publickey: SECOND.pubkey,
        validator_index: '8',
      };
      expect(
        caught(() => run([stored({}), other], [mine, secondBlob(2)])).code,
      ).toBe('EXIT_VALIDATOR_INDEX_MISMATCH');
    });

    it('accepts a stored epoch with leading zeros', () => {
      expect(run([{ ...stored({}), epoch: '00200' }])).toEqual([mine]);
    });

    it('rejects a different validator index', () => {
      expect(
        caught(() => run([stored({}, { ...message, validator_index: '43' })]))
          .code,
      ).toBe('EXIT_VALIDATOR_INDEX_MISMATCH');
    });

    it.each(['199', '201'])(
      'rejects a different epoch (%s, EXIT_EPOCH_MISMATCH)',
      epoch => {
        expect(
          caught(() => run([stored({}, { ...message, epoch })])).code,
        ).toBe('EXIT_EPOCH_MISMATCH');
      },
    );

    it('rejects a different stored signature for the share', () => {
      expect(
        caught(() =>
          run([stored({ '1': blob(3).signed_exit_message.signature })]),
        ).code,
      ).toBe('EXIT_SIGNATURE_CONFLICT');
    });
  });

  it('rejects malformed input (PAYLOAD_INVALID)', () => {
    expect(
      caught(() =>
        verifyPartialExit({ cluster, payload: { share_idx: 1 } } as any),
      ).code,
    ).toBe('PAYLOAD_INVALID');
    expect(
      caught(() =>
        verifyPartialExit({
          cluster,
          payload: payloadFor(1, [blob(1)]),
          existing: [{ ...stored({}), epoch: '99999999999999999999' }],
        }),
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });
});

describe('exits.aggregate', () => {
  const root = exitSigningRoot(message, HOODI_CAPELLA, HOODI_GVR);
  const sig = (idx: number): string => blob(idx).signed_exit_message.signature;
  const validator = cluster.validators[0];
  const signed = {
    public_key: GROUP_PUBKEY,
    signed_exit_message: { message, signature: blsSign(GROUP_SECRET, root) },
  };

  it('threshold-aggregates a stored exit into the group signature', () => {
    const result = aggregate({
      validator,
      exit: stored({ '0': sig(1), '1': sig(2), '3': sig(4) }),
      threshold: 3,
      chainId: 560048,
    });
    expect(result).toEqual(signed);
  });

  it('skips a bad stored share and a missing one, using any threshold valid shares', () => {
    // Share 2 holds share 3's signature; share 3 is missing.
    const exit = stored({ '0': sig(1), '1': sig(3), '3': sig(4) });
    expect(
      caught(() =>
        aggregate({ validator, exit, threshold: 3, chainId: 560048 }),
      ).details,
    ).toMatchObject({ valid: [1, 4], invalid: [2] });
    const withThird = stored({
      '0': sig(1),
      '1': sig(3),
      '2': sig(3),
      '3': sig(4),
    });
    expect(
      aggregate({ validator, exit: withThird, threshold: 3, chainId: 560048 }),
    ).toEqual(signed);
  });

  it('skips a malformed stored signature', () => {
    const exit = stored({
      '0': '0x1234',
      '1': `0x${'ff'.repeat(96)}`,
      '2': sig(3),
      '3': sig(4),
    });
    const error = caught(() =>
      aggregate({ validator, exit, threshold: 3, chainId: 560048 }),
    );
    expect(error.code).toBe('EXIT_NOT_ENOUGH_SHARES');
    expect(error.details).toMatchObject({ valid: [3, 4], invalid: [1, 2] });
  });

  it('aggregates the API full exit response', () => {
    const result = aggregate({
      validator,
      exit: {
        epoch: '200',
        validator_index: '42',
        signatures: [null, sig(2), sig(3), sig(4)],
      },
      threshold: 3,
      chainId: 560048,
    });
    expect(result).toEqual(signed);
  });

  it('takes chainId from the client chain', () => {
    const exits = createExitsModule(fakeChain().context());
    const result = exits.aggregate({
      validator,
      exit: stored({ '0': sig(1), '1': sig(2), '2': sig(3) }),
      threshold: 3,
    });
    expect(result.signed_exit_message.signature).toBe(
      blsSign(GROUP_SECRET, root),
    );
  });

  it('rejects a stored exit of another validator (PAYLOAD_INVALID)', () => {
    expect(
      caught(() =>
        aggregate({
          validator: cluster.validators[1],
          exit: stored({ '0': sig(1) }),
          threshold: 1,
          chainId: 560048,
        }),
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it('rejects public shares that are not of the group key (EXIT_PARTIAL_SIGNATURE_INVALID)', () => {
    // Shares of the second validator, signing the first validator's message
    // root, verify one by one but do not aggregate to the first group key.
    const mixed = {
      distributedPublicKey: GROUP_PUBKEY,
      publicShares: cluster.validators[1].publicShares,
    };
    const second = (i: number): string =>
      blob(i, message, SECOND.secret(i)).signed_exit_message.signature;
    expect(
      caught(() =>
        aggregate({
          validator: mixed,
          exit: stored({ '0': second(1), '1': second(2), '2': second(3) }),
          threshold: 3,
          chainId: 560048,
        }),
      ).code,
    ).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
  });

  it.each([
    ['without a genesis validators root (Gnosis)', 100],
    ['unknown', 12345],
  ])('rejects a chain %s (UNSUPPORTED_CHAIN)', (_n, chainId) => {
    expect(
      caught(() =>
        aggregate({
          validator,
          exit: stored({ '0': sig(1) }),
          threshold: 1,
          chainId,
        }),
      ).code,
    ).toBe('UNSUPPORTED_CHAIN');
  });
});

describe('exits BLS helpers', () => {
  const msg = bytesToHex(new TextEncoder().encode('obol'));
  const partials = [1, 2, 3].map(index => ({
    index,
    signature: blsSign(shareSecret(index), hexToBytes(msg)),
  }));

  it('threshold aggregate and recovery give the group signature and key', () => {
    expect(blsVerify(GROUP_PUBKEY, msg, blsThresholdAggregate(partials))).toBe(
      true,
    );
    expect(
      blsRecoverPubkey(
        [2, 3, 4].map(index => ({ index, pubshare: pubshare(index) })),
      ),
    ).toBe(GROUP_PUBKEY);
  });

  it('rejects duplicate indices and bad points (PAYLOAD_INVALID)', () => {
    expect(
      caught(() =>
        blsThresholdAggregate([partials[0], { ...partials[1], index: 1 }]),
      ).code,
    ).toBe('PAYLOAD_INVALID');
    expect(
      caught(() =>
        blsRecoverPubkey([{ index: 1, pubshare: `0x${'ff'.repeat(48)}` }]),
      ).code,
    ).toBe('PAYLOAD_INVALID');
    expect(caught(() => blsAggregate([`0x${'ff'.repeat(96)}`])).code).toBe(
      'PAYLOAD_INVALID',
    );
    expect(
      caught(() => blsVerify('0x12', msg, partials[0].signature)).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it('blsVerify is false for a wrong signature', () => {
    expect(blsVerify(pubshare(1), msg, partials[1].signature)).toBe(false);
  });

  it('blsVerify uses the given backend (blst), with the same answers', () => {
    const group = blsThresholdAggregate(partials);
    const offCurve = `0x${'ff'.repeat(48)}` as Hex;
    const notG2 = `0x${'ff'.repeat(96)}` as Hex;
    for (const options of [{}, { bls: nobleBls }, { bls: blstBackend }]) {
      expect(blsVerify(GROUP_PUBKEY, msg, group, options)).toBe(true);
      expect(blsVerify(pubshare(1), msg, partials[1].signature, options)).toBe(
        false,
      );
      // Well-formed hex, not a point: false.
      expect(blsVerify(offCurve, msg, group, options)).toBe(false);
      expect(blsVerify(GROUP_PUBKEY, msg, notG2, options)).toBe(false);
      // Malformed hex: PAYLOAD_INVALID (2.x returned false).
      expect(
        caught(() => blsVerify(GROUP_PUBKEY, msg, '0x12', options)).code,
      ).toBe('PAYLOAD_INVALID');
    }
    let calls = 0;
    const counting = {
      ...nobleBls,
      verify: (...args: Parameters<typeof nobleBls.verify>) => {
        calls++;
        return nobleBls.verify(...args);
      },
    };
    expect(blsVerify(GROUP_PUBKEY, msg, group, { bls: counting })).toBe(true);
    expect(calls).toBe(1);
    expect(
      caught(() => blsVerify(GROUP_PUBKEY, msg, group, { bls: {} as never }))
        .code,
    ).toBe('PAYLOAD_INVALID');
  });
});
