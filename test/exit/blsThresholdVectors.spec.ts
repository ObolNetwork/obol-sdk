// Runs the BLS threshold test vectors from ObolNetwork/distributed-validator-specs
// (test/fixtures/spec/bls_threshold.json, see test/fixtures/spec/README.md)
// against the SDK's threshold signature aggregation and exit recombination.
import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ContainerType, fromHexString, UintNumberType } from '@chainsafe/ssz';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import {
  blsAggregateSignatures,
  blsThresholdAggregateSignatures,
  blsVerify,
} from '../../src/blsUtils.js';
import { Exit } from '../../src/exits/exit.js';
import {
  computeDomain,
  signingRoot,
} from '../../src/exits/verificationHelpers.js';
import { ExitRecombineError, InvalidArgumentError } from '../../src/errors.js';
import type {
  ExistingExitValidationBlobData,
  RecombineExitBlobsOptions,
} from '../../src/types.js';

type Partial = {
  name: string;
  input: { share_idx: number; secret_hex: string };
  pubshare_hex: string;
  signature_hex: string;
};

type AggregateCase = {
  name: string;
  input: { share_indices: number[] };
  signature_hex: string;
};

const vectors = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/spec/bls_threshold.json',
    ),
    'utf8',
  ),
) as {
  message_hex: string;
  group_pubkey_hex: string;
  group_signature_hex: string;
  partials: Partial[];
  threshold_aggregates: AggregateCase[];
  plain_aggregate: AggregateCase[];
};

const message = fromHexString(vectors.message_hex);
const groupPubkey = fromHexString(vectors.group_pubkey_hex);
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const partialByShareIdx = new Map(
  vectors.partials.map(p => [p.input.share_idx, p]),
);

const partialFor = (shareIdx: number): Partial => {
  const partial = partialByShareIdx.get(shareIdx);
  if (!partial) throw new Error(`no partial for share ${shareIdx}`);
  return partial;
};

const signaturesFor = (shareIndices: number[]): Map<number, Uint8Array> =>
  new Map(
    shareIndices.map(idx => [
      idx,
      fromHexString(partialFor(idx).signature_hex),
    ]),
  );

describe('bls_threshold spec vectors', () => {
  it('has threshold aggregate cases', () => {
    expect(vectors.threshold_aggregates.length).toBeGreaterThan(0);
  });

  it.each(vectors.partials.map(p => [p.name, p] as const))(
    'partial %s verifies against its public share',
    (_name, partial) => {
      expect(
        blsVerify(
          fromHexString(partial.pubshare_hex),
          message,
          fromHexString(partial.signature_hex),
        ),
      ).toBe(true);
    },
  );

  describe('blsThresholdAggregateSignatures', () => {
    it.each(vectors.threshold_aggregates.map(c => [c.name, c] as const))(
      '%s',
      (_name, testCase) => {
        const sig = blsThresholdAggregateSignatures(
          signaturesFor(testCase.input.share_indices),
        );
        expect(toHex(sig)).toBe(testCase.signature_hex);
        expect(blsVerify(groupPubkey, message, sig)).toBe(true);
      },
    );

    it('is independent of insertion order', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([4, 1, 3]));
      expect(toHex(sig)).toBe(vectors.group_signature_hex);
    });

    it('recovers the group signature from all four shares', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([1, 2, 3, 4]));
      expect(toHex(sig)).toBe(vectors.group_signature_hex);
    });

    it('does not verify with fewer than threshold shares', () => {
      const sig = blsThresholdAggregateSignatures(signaturesFor([1, 2]));
      expect(blsVerify(groupPubkey, message, sig)).toBe(false);
    });

    it('does not verify when a share is assigned the wrong index', () => {
      const sigs = signaturesFor([1, 2, 3]);
      const wrong = new Map([
        [1, sigs.get(1) as Uint8Array],
        [2, sigs.get(2) as Uint8Array],
        [4, sigs.get(3) as Uint8Array],
      ]);
      const sig = blsThresholdAggregateSignatures(wrong);
      expect(blsVerify(groupPubkey, message, sig)).toBe(false);
    });

    it('differs from plain aggregation, which does not verify', () => {
      for (const testCase of vectors.plain_aggregate) {
        const plain = blsAggregateSignatures([
          ...signaturesFor(testCase.input.share_indices).values(),
        ]);
        expect(toHex(plain)).toBe(testCase.signature_hex);
        expect(toHex(plain)).not.toBe(vectors.group_signature_hex);
        expect(blsVerify(groupPubkey, message, plain)).toBe(false);
      }
    });

    it.each([0, -1, 1.5, Number.NaN])('rejects share index %p', idx => {
      const sigs = signaturesFor([1, 2]);
      sigs.set(idx, fromHexString(partialFor(3).signature_hex));
      expect(() => blsThresholdAggregateSignatures(sigs)).toThrow(
        'invalid share index',
      );
    });

    it('rejects an empty set', () => {
      expect(() => blsThresholdAggregateSignatures(new Map())).toThrow(
        'empty signature set',
      );
    });

    it('rejects a signature that is not a G2 point', () => {
      const sigs = signaturesFor([1, 2]);
      sigs.set(3, new Uint8Array(96).fill(0xff));
      expect(() => blsThresholdAggregateSignatures(sigs)).toThrow();
    });
  });

  describe('Exit.recombineExitBlobs', () => {
    const exit = new Exit(1, null);

    it.each(vectors.threshold_aggregates.map(c => [c.name, c] as const))(
      '%s',
      async (_name, testCase) => {
        // shares_exit_data is keyed by 0-based operator index
        const shares: Record<string, { partial_exit_signature: string }> = {};
        for (const idx of testCase.input.share_indices) {
          shares[String(idx - 1)] = {
            partial_exit_signature: '0x' + partialFor(idx).signature_hex,
          };
        }
        const result = await exit.recombineExitBlobs({
          public_key: '0x' + vectors.group_pubkey_hex,
          epoch: '1',
          validator_index: '1',
          shares_exit_data: [shares],
        });
        const sig = result.signed_exit_message.signature;
        expect(sig).toBe('0x' + testCase.signature_hex);
        expect(blsVerify(groupPubkey, message, fromHexString(sig))).toBe(true);
      },
    );
  });

  describe('Exit.recombineExitBlobs with verification options', () => {
    const exit = new Exit(1, null);
    const ls = bls12_381.longSignatures;
    const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
    const MAINNET_GVR =
      '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95';
    const THRESHOLD = 3;
    const EPOCH = '194048';
    const VALIDATOR_INDEX = '1234';

    // The voluntary exit signing root on mainnet (Capella fork, EIP-7044),
    // computed here independently of Exit.
    const exitRoot = (epoch: string): Uint8Array => {
      const messageRoot = new ContainerType({
        epoch: new UintNumberType(8),
        validator_index: new UintNumberType(8),
      }).hashTreeRoot({
        epoch: Number(epoch),
        validator_index: Number(VALIDATOR_INDEX),
      });
      return signingRoot(
        computeDomain(
          fromHexString('04000000'),
          '0x03000000',
          fromHexString(MAINNET_GVR),
        ),
        Buffer.from(messageRoot),
      );
    };

    // Partial exit signature of share `shareIdx` from its spec vector secret.
    const signExit = (shareIdx: number, epoch = EPOCH): string =>
      '0x' +
      toHex(
        ls.Signature.toBytes(
          ls.sign(
            ls.hash(exitRoot(epoch), ETH2_DST),
            fromHexString(partialFor(shareIdx).input.secret_hex),
          ),
        ),
      );

    const groupKey = '0x' + vectors.group_pubkey_hex;
    const clusterConfig: RecombineExitBlobsOptions['clusterConfig'] = {
      definition: { fork_version: '0x00000000', threshold: THRESHOLD },
      distributed_validators: [
        {
          distributed_public_key: groupKey,
          public_shares: [1, 2, 3, 4].map(
            i => '0x' + partialFor(i).pubshare_hex,
          ),
        },
      ],
    };
    const options: RecombineExitBlobsOptions = {
      clusterConfig,
      genesisValidatorsRoot: MAINNET_GVR,
    };

    // shares_exit_data keyed by 0-based operator index
    const blobWith = (
      signatures: Record<number, string>,
      publicKey = groupKey,
    ): ExistingExitValidationBlobData => ({
      public_key: publicKey,
      epoch: EPOCH,
      validator_index: VALIDATOR_INDEX,
      shares_exit_data: [
        Object.fromEntries(
          Object.entries(signatures).map(([shareIdx, sig]) => [
            String(Number(shareIdx) - 1),
            { partial_exit_signature: sig },
          ]),
        ),
      ],
    });

    const verifies = (signature: string): boolean =>
      blsVerify(
        fromHexString(groupKey),
        exitRoot(EPOCH),
        fromHexString(signature),
      );

    const rejection = async (
      promise: Promise<unknown>,
    ): Promise<ExitRecombineError> => {
      const err = await promise.then(
        () => {
          throw new Error('expected a rejection');
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ExitRecombineError);
      return err as ExitRecombineError;
    };

    it.each([[[1, 2, 3]], [[2, 3, 4]], [[1, 3, 4]], [[1, 2, 3, 4]]])(
      'threshold met with shares %p: the result verifies',
      async shares => {
        const result = await exit.recombineExitBlobs(
          blobWith(Object.fromEntries(shares.map(i => [i, signExit(i)]))),
          options,
        );
        expect(result.public_key).toBe(groupKey);
        expect(result.signed_exit_message.message).toEqual({
          epoch: EPOCH,
          validator_index: VALIDATOR_INDEX,
        });
        expect(verifies(result.signed_exit_message.signature)).toBe(true);
      },
    );

    it('below threshold: throws EXIT_NOT_ENOUGH_SHARES', async () => {
      const err = await rejection(
        exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2) }),
          options,
        ),
      );
      expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
      expect(err.validShares).toEqual([1, 2]);
      expect(err.invalidShares).toEqual([]);
      expect(err.message).toContain('2 valid partial exit signatures');
    });

    it('without options, below threshold still returns an unverified signature', async () => {
      const result = await exit.recombineExitBlobs(
        blobWith({ 1: signExit(1), 2: signExit(2) }),
      );
      expect(verifies(result.signed_exit_message.signature)).toBe(false);
    });

    it.each([
      ['for another epoch', () => signExit(2, '1')],
      ['by another share', () => signExit(3)],
      ['not a G2 point', () => '0x' + 'ff'.repeat(96)],
    ])(
      'one invalid partial (%s) among enough valid ones: aggregates the valid ones',
      async (_name, invalidSignature) => {
        const result = await exit.recombineExitBlobs(
          blobWith({
            1: signExit(1),
            2: invalidSignature(),
            3: signExit(3),
            4: signExit(4),
          }),
          options,
        );
        expect(verifies(result.signed_exit_message.signature)).toBe(true);
      },
    );

    it('one invalid partial leaving fewer than threshold valid ones: throws', async () => {
      const err = await rejection(
        exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2, '1'), 3: signExit(3) }),
          options,
        ),
      );
      expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
      expect(err.validShares).toEqual([1, 3]);
      expect(err.invalidShares).toEqual([2]);
      expect(err.message).toContain('(invalid: shares 2)');
    });

    it('a partial without a public share is invalid', async () => {
      const err = await rejection(
        exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2), 5: signExit(3) }),
          options,
        ),
      );
      expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
      expect(err.invalidShares).toEqual([5]);
    });

    it('aggregate mismatch: throws EXIT_PARTIAL_SIGNATURE_INVALID', async () => {
      // The partials verify against the public shares, but the shares are
      // not those of the validator key the exit is for.
      const otherKey = '0x' + partialFor(1).pubshare_hex;
      const err = await rejection(
        exit.recombineExitBlobs(
          blobWith(
            { 1: signExit(1), 2: signExit(2), 3: signExit(3) },
            otherKey,
          ),
          {
            ...options,
            clusterConfig: {
              ...clusterConfig,
              distributed_validators: [
                {
                  ...clusterConfig.distributed_validators[0],
                  distributed_public_key: otherKey,
                },
              ],
            },
          },
        ),
      );
      expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
      expect(err.validShares).toEqual([1, 2, 3]);
    });

    it('reads the genesis validators root from beaconNodeApiUrl', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: async () => ({
          data: { genesis_validators_root: MAINNET_GVR },
        }),
      } as Response);
      try {
        const result = await exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2), 4: signExit(4) }),
          { clusterConfig, beaconNodeApiUrl: 'http://localhost:5052' },
        );
        expect(verifies(result.signed_exit_message.signature)).toBe(true);
        expect(fetchSpy).toHaveBeenCalledWith(
          'http://localhost:5052/eth/v1/beacon/genesis',
          { method: 'GET' },
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('a wrong genesis validators root fails every partial', async () => {
      const err = await rejection(
        exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2), 3: signExit(3) }),
          { clusterConfig, genesisValidatorsRoot: '0x' + '00'.repeat(32) },
        ),
      );
      expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
      expect(err.invalidShares).toEqual([1, 2, 3]);
    });

    it.each([
      ['neither root nor beacon URL', { clusterConfig }],
      [
        'both root and beacon URL',
        {
          clusterConfig,
          genesisValidatorsRoot: MAINNET_GVR,
          beaconNodeApiUrl: 'http://localhost:5052',
        },
      ],
      [
        'a zero threshold',
        {
          clusterConfig: {
            ...clusterConfig,
            definition: { ...clusterConfig.definition, threshold: 0 },
          },
          genesisValidatorsRoot: MAINNET_GVR,
        },
      ],
      [
        'a validator not in the cluster',
        {
          clusterConfig: { ...clusterConfig, distributed_validators: [] },
          genesisValidatorsRoot: MAINNET_GVR,
        },
      ],
    ])('rejects options with %s', async (_name, badOptions) => {
      await expect(
        exit.recombineExitBlobs(
          blobWith({ 1: signExit(1), 2: signExit(2), 3: signExit(3) }),
          badOptions as RecombineExitBlobsOptions,
        ),
      ).rejects.toBeInstanceOf(InvalidArgumentError);
    });
  });
});
