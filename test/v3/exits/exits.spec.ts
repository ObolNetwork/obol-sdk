import { readFileSync } from 'node:fs';
import { SignableENR } from '@chainsafe/enr';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { Exit } from '../../../src/exits/exit.js';
import { ObolError } from '../../../src/v3/errors.js';
import {
  aggregate,
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
  createExitsModule,
  verifyPartialExit,
  type ExistingExit,
  type ExitBlob,
} from '../../../src/v3/exits/index.js';
import {
  exitSigningRoot,
  partialExitsPayloadRoot,
} from '../../../src/v3/exits/ssz.js';
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

const { longSignatures: ls } = bls12_381;
const DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const blsSign = (secret: Hex, message: Uint8Array): Hex =>
  bytesToHex(
    ls.Signature.toBytes(ls.sign(ls.hash(message, DST), hexToBytes(secret))),
  );

const operatorKeys = [1, 2, 3, 4].map(() => secp256k1.keygen().secretKey);
const enrs = operatorKeys.map(k => SignableENR.createV4(k).encodeTxt());

const cluster = {
  operators: enrs.map(enr => ({ enr })),
  forkVersion: HOODI,
  threshold: 3,
  validators: [
    {
      distributedPublicKey: GROUP_PUBKEY,
      publicShares: [1, 2, 3, 4].map(pubshare),
    },
  ],
};

const message = { epoch: '200', validatorIndex: '42' };

const blob = (
  shareIdx: number,
  msg = message,
  gvr = HOODI_GVR,
  capella = HOODI_CAPELLA,
): ExitBlob => ({
  publicKey: GROUP_PUBKEY,
  signedExitMessage: {
    message: msg,
    signature: blsSign(
      shareSecret(shareIdx),
      exitSigningRoot(msg, capella, gvr),
    ),
  },
});

/** Signs the payload root like charon: r || s || v. */
const payloadFor = (
  shareIdx: number,
  partialExits: ExitBlob[],
  signer = operatorKeys[shareIdx - 1],
) => {
  const root = partialExitsPayloadRoot(partialExits, shareIdx);
  const recovered = secp256k1.sign(root, signer, {
    prehash: false,
    format: 'recovered',
  });
  const signature = bytesToHex(
    new Uint8Array([...recovered.slice(1), recovered[0]]),
  );
  return { shareIdx, partialExits, signature };
};

const caught = (fn: () => unknown): ObolError => {
  try {
    fn();
  } catch (e) {
    return e as ObolError;
  }
  throw new Error('expected a throw');
};

const existingWith = (
  signatures: Record<string, string>,
  msg = message,
): ExistingExit => ({
  publicKey: GROUP_PUBKEY,
  epoch: msg.epoch,
  validatorIndex: msg.validatorIndex,
  partialSignatures: signatures,
});

describe('exits SSZ', () => {
  it('payload root matches 2.x', () => {
    const blobs = [blob(2)];
    const legacy = (Exit as any).computeExitPayloadRoot({
      partial_exits: blobs.map(b => ({
        public_key: b.publicKey,
        signed_exit_message: {
          message: {
            epoch: b.signedExitMessage.message.epoch,
            validator_index: b.signedExitMessage.message.validatorIndex,
          },
          signature: b.signedExitMessage.signature,
        },
      })),
      share_idx: 2,
    });
    expect(bytesToHex(partialExitsPayloadRoot(blobs, 2))).toBe(`0x${legacy}`);
  });

  it('exit signing root matches 2.x verification', async () => {
    const b = blob(3);
    await expect(
      new Exit(560048, null).verifyPartialExitSignature(
        pubshare(3),
        {
          message: { epoch: '200', validator_index: '42' },
          signature: b.signedExitMessage.signature,
        },
        HOODI,
        HOODI_GVR,
      ),
    ).resolves.toBe(true);
  });
});

describe('exits.verifyPartialExit', () => {
  it('returns new valid blobs', () => {
    const blobs = [blob(2)];
    expect(
      verifyPartialExit({ cluster, payload: payloadFor(2, blobs) }),
    ).toEqual(blobs);
  });

  it('accepts a 64-byte payload signature', () => {
    const payload = payloadFor(2, [blob(2)]);
    payload.signature = payload.signature.slice(0, 130) as Hex;
    expect(verifyPartialExit({ cluster, payload })).toHaveLength(1);
  });

  it.each([0, 5])(
    'rejects shareIdx %d (EXIT_SHARE_INDEX_INVALID)',
    shareIdx => {
      const payload = { ...payloadFor(1, [blob(1)]), shareIdx };
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

  it('rejects a payload signature of the wrong length', () => {
    const payload = {
      ...payloadFor(2, [blob(2)]),
      signature: `0x${'11'.repeat(66)}`,
    };
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

  it('needs a genesis validators root for the fork (UNSUPPORTED_CHAIN)', () => {
    const gnosis = { ...cluster, forkVersion: '0x00000064' };
    const payload = payloadFor(1, [blob(1)]);
    expect(
      caught(() => verifyPartialExit({ cluster: gnosis, payload })).code,
    ).toBe('UNSUPPORTED_CHAIN');
    const gvr = `0x${'42'.repeat(32)}`;
    const signed = [blob(1, message, gvr, '0x03000064')];
    expect(
      verifyPartialExit({
        cluster: gnosis,
        payload: payloadFor(1, signed),
        genesisValidatorsRoot: gvr,
      }),
    ).toEqual(signed);
  });

  it('rejects a validator that is not in the cluster', () => {
    const other = { ...blob(1), publicKey: pubshare(4) };
    expect(
      caught(() =>
        verifyPartialExit({ cluster, payload: payloadFor(1, [other]) }),
      ).code,
    ).toBe('EXIT_VALIDATOR_NOT_IN_CLUSTER');
  });

  it('rejects a validator without a public share at shareIdx', () => {
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

  describe('against an existing exit', () => {
    const mine = blob(2);
    const run = (existing: ExistingExit, blobs = [mine]) =>
      verifyPartialExit({ cluster, payload: payloadFor(2, blobs), existing });

    it('drops the blob already stored', () => {
      expect(
        run(
          existingWith({
            '1': mine.signedExitMessage.signature
              .toUpperCase()
              .replace('0X', '0x'),
          }),
        ),
      ).toEqual([]);
    });

    it('keeps a share not stored yet at the same epoch', () => {
      expect(
        run(existingWith({ '0': blob(1).signedExitMessage.signature })),
      ).toEqual([mine]);
    });

    it('keeps a higher epoch', () => {
      expect(
        run(existingWith({ '1': 'x' }, { ...message, epoch: '199' })),
      ).toEqual([mine]);
    });

    it('rejects a different validator index', () => {
      expect(
        caught(() =>
          run(existingWith({}, { ...message, validatorIndex: '43' })),
        ).code,
      ).toBe('EXIT_VALIDATOR_INDEX_MISMATCH');
    });

    it('rejects a lower epoch', () => {
      expect(
        caught(() => run(existingWith({}, { ...message, epoch: '201' }))).code,
      ).toBe('EXIT_EPOCH_REGRESSION');
    });

    it('rejects a different signature for the share at the same epoch', () => {
      expect(
        caught(() =>
          run(existingWith({ '1': blob(3).signedExitMessage.signature })),
        ).code,
      ).toBe('EXIT_SIGNATURE_CONFLICT');
    });
  });

  it('rejects malformed input (PAYLOAD_INVALID)', () => {
    expect(
      caught(() =>
        verifyPartialExit({ cluster, payload: { shareIdx: 1 } } as any),
      ).code,
    ).toBe('PAYLOAD_INVALID');
    const huge = blob(1, {
      epoch: '99999999999999999999',
      validatorIndex: '1',
    });
    expect(
      caught(() =>
        verifyPartialExit({
          cluster,
          payload: payloadFor(1, [blob(1)]),
          existing: {
            ...existingWith({}),
            epoch: huge.signedExitMessage.message.epoch,
          },
        }),
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });
});

describe('exits.aggregate', () => {
  const root = exitSigningRoot(message, HOODI_CAPELLA, HOODI_GVR);
  const sig = (idx: number): string => blob(idx).signedExitMessage.signature;

  it('threshold-aggregates into the group signature', () => {
    const result = aggregate({
      existing: existingWith({
        '0': sig(1),
        '1': sig(2),
        '2': '',
        '3': sig(4),
      }),
      threshold: 3,
      forkVersion: HOODI,
    });
    expect(result).toEqual({
      publicKey: GROUP_PUBKEY,
      signedExitMessage: { message, signature: blsSign(GROUP_SECRET, root) },
    });
  });

  it('uses the first threshold shares by index', () => {
    // Share 4's entry is wrong; it is not among the first three.
    const result = aggregate({
      existing: existingWith({
        '3': sig(1),
        '2': sig(3),
        '1': sig(2),
        '0': sig(1),
      }),
      threshold: 3,
      forkVersion: HOODI,
    });
    expect(result.signedExitMessage.signature).toBe(
      blsSign(GROUP_SECRET, root),
    );
  });

  it('defaults forkVersion to the client chain', () => {
    const exits = createExitsModule(fakeChain().context());
    const result = exits.aggregate({
      existing: existingWith({ '0': sig(1), '1': sig(2), '2': sig(3) }),
      threshold: 3,
    });
    expect(result.signedExitMessage.signature).toBe(
      blsSign(GROUP_SECRET, root),
    );
  });

  it.each([
    ['not 96 bytes', '0x1234'],
    ['not a curve point', `0x${'ff'.repeat(96)}`],
  ])('rejects a stored signature %s (EXIT_SIGNATURE_MALFORMED)', (_n, bad) => {
    const error = caught(() =>
      aggregate({
        existing: existingWith({ '0': sig(1), '1': bad, '2': sig(3) }),
        threshold: 3,
        forkVersion: HOODI,
      }),
    );
    expect(error.code).toBe('EXIT_SIGNATURE_MALFORMED');
  });

  it('needs threshold shares (EXIT_NOT_ENOUGH_SHARES)', () => {
    expect(
      caught(() =>
        aggregate({
          existing: existingWith({ '0': sig(1), '1': sig(2), '2': '' }),
          threshold: 3,
          forkVersion: HOODI,
        }),
      ).code,
    ).toBe('EXIT_NOT_ENOUGH_SHARES');
  });

  it('rejects a result that does not verify (EXIT_PARTIAL_SIGNATURE_INVALID)', () => {
    expect(
      caught(() =>
        aggregate({
          existing: existingWith({ '0': sig(1), '1': sig(3), '2': sig(2) }),
          threshold: 3,
          forkVersion: HOODI,
        }),
      ).code,
    ).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
  });

  it('needs a known fork (UNSUPPORTED_CHAIN)', () => {
    expect(
      caught(() =>
        aggregate({
          existing: existingWith({ '0': sig(1) }),
          threshold: 1,
          forkVersion: '0x12345678',
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
});
