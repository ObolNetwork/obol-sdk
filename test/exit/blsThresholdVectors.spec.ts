// Runs the BLS threshold test vectors from ObolNetwork/distributed-validator-specs
// (test/fixtures/spec/bls_threshold.json, see test/fixtures/spec/README.md)
// against the SDK's threshold signature aggregation and exit recombination.
import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  ContainerType,
  fromHexString,
  UintBigintType,
  UintNumberType,
} from '@chainsafe/ssz';
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
import {
  ExitRecombineError,
  InvalidArgumentError,
  UnsupportedChainError,
} from '../../src/errors.js';
import {
  CAPELLA_FORK_MAPPING,
  EXIT_NETWORKS,
  SUPPORTED_CHAIN_IDS,
} from '../../src/constants.js';
import {
  FORK_MAPPING,
  type ExistingExitValidationBlobData,
  type RecombineExitBlobsOptions,
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
    const ls = bls12_381.longSignatures;
    const ETH2_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
    const MAINNET = EXIT_NETWORKS[1];
    const HOODI = EXIT_NETWORKS[560048];
    const THRESHOLD = 3;
    const EPOCH = '194048';
    const VALIDATOR_INDEX = '1234';

    const exit = new Exit(1, null);

    // The voluntary exit signing root (Capella fork, EIP-7044), computed here
    // independently of Exit.
    const exitRoot = (epoch: string, network = MAINNET): Uint8Array => {
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
          network.capellaForkVersion,
          fromHexString(network.genesisValidatorsRoot),
        ),
        Buffer.from(messageRoot),
      );
    };

    // Partial exit signature of share `shareIdx` from its spec vector secret.
    const signExit = (
      shareIdx: number,
      epoch = EPOCH,
      network = MAINNET,
    ): string =>
      '0x' +
      toHex(
        ls.Signature.toBytes(
          ls.sign(
            ls.hash(exitRoot(epoch, network), ETH2_DST),
            fromHexString(partialFor(shareIdx).input.secret_hex),
          ),
        ),
      );

    const groupKey = '0x' + vectors.group_pubkey_hex;
    const clusterConfig: NonNullable<
      RecombineExitBlobsOptions['clusterConfig']
    > = {
      definition: { fork_version: MAINNET.forkVersion, threshold: THRESHOLD },
      distributed_validators: [
        {
          distributed_public_key: groupKey,
          public_shares: [1, 2, 3, 4].map(
            i => '0x' + partialFor(i).pubshare_hex,
          ),
        },
      ],
    };
    const hoodiClusterConfig = {
      ...clusterConfig,
      definition: { fork_version: HOODI.forkVersion, threshold: THRESHOLD },
    };

    // shares_exit_data keyed by 0-based operator index
    const blobWith = (
      signatures: Record<number, string>,
      overrides: {
        public_key?: string;
        epoch?: string;
        validator_index?: string;
      } = {},
    ): ExistingExitValidationBlobData => ({
      public_key: groupKey,
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
      ...overrides,
    });

    const signed = (
      shares: number[],
      network = MAINNET,
    ): Record<number, string> =>
      Object.fromEntries(shares.map(i => [i, signExit(i, EPOCH, network)]));

    const verifies = (signature: string, network = MAINNET): boolean =>
      blsVerify(
        fromHexString(groupKey),
        exitRoot(EPOCH, network),
        fromHexString(signature),
      );

    // What recombineExitBlobs returned before 2.16.0: the threshold aggregate
    // of every provided partial, unchecked.
    const legacyAggregate = (signatures: Record<number, string>): string =>
      '0x' +
      toHex(
        blsThresholdAggregateSignatures(
          new Map(
            Object.entries(signatures).map(([shareIdx, sig]) => [
              Number(shareIdx),
              fromHexString(sig),
            ]),
          ),
        ),
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

    describe('chain constants', () => {
      it.each(Object.entries(EXIT_NETWORKS))(
        'chain %s agrees with the fork mappings',
        (chainId, network) => {
          expect(FORK_MAPPING[network.forkVersion as any]).toBe(
            Number(chainId),
          );
          expect(CAPELLA_FORK_MAPPING[network.forkVersion]).toBe(
            network.capellaForkVersion,
          );
          expect(network.genesisValidatorsRoot).toMatch(/^0x[0-9a-f]{64}$/);
        },
      );

      it('covers every supported chain', () => {
        expect(Object.keys(EXIT_NETWORKS).map(Number).sort()).toEqual(
          [...SUPPORTED_CHAIN_IDS].sort(),
        );
      });
    });

    describe('without options (default)', () => {
      it.each(vectors.threshold_aggregates.map(c => [c.name, c] as const))(
        'spec vector %s: returns the bytes it returned before 2.16.0',
        async (_name, testCase) => {
          const signatures = signed(testCase.input.share_indices);
          const result = await exit.recombineExitBlobs(blobWith(signatures));
          expect(result).toEqual({
            public_key: groupKey,
            signed_exit_message: {
              message: { epoch: EPOCH, validator_index: VALIDATOR_INDEX },
              signature: legacyAggregate(signatures),
            },
          });
          expect(verifies(result.signed_exit_message.signature)).toBe(true);
        },
      );

      it('threshold, more than threshold and all shares give the same signature, with and without clusterConfig', async () => {
        const results = new Set<string>();
        for (const shares of [
          [1, 2, 3],
          [2, 3, 4],
          [1, 3, 4],
          [1, 2, 4],
          [1, 2, 3, 4],
        ]) {
          const signatures = signed(shares);
          const plain = await exit.recombineExitBlobs(blobWith(signatures));
          const checked = await exit.recombineExitBlobs(blobWith(signatures), {
            clusterConfig,
          });
          expect(plain).toEqual(checked);
          expect(plain.signed_exit_message.signature).toBe(
            legacyAggregate(signatures),
          );
          results.add(plain.signed_exit_message.signature);
        }
        expect(results.size).toBe(1);
      });

      it.each(Object.entries(EXIT_NETWORKS))(
        'verifies on chain %s with its constants',
        async (chainId, network) => {
          const result = await new Exit(
            Number(chainId),
            null,
          ).recombineExitBlobs(blobWith(signed([1, 2, 3], network)));
          expect(verifies(result.signed_exit_message.signature, network)).toBe(
            true,
          );
        },
      );

      it('keeps the caller form of public_key', async () => {
        const upper = vectors.group_pubkey_hex.toUpperCase();
        const result = await exit.recombineExitBlobs(
          blobWith(signed([1, 2, 3]), { public_key: upper }),
        );
        expect(result.public_key).toBe(upper);
      });

      it('below threshold: throws instead of returning an invalid signature', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(blobWith(signed([1, 2]))),
        );
        expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
        expect(err.publicKey).toBe(groupKey);
        expect(err.providedShares).toEqual([1, 2]);
        expect(err.validShares).toEqual([]);
        expect(err.invalidShares).toEqual([]);
        expect(err.message).toContain(
          'aggregated from shares 1, 2 does not verify',
        );
        expect(err.message).toContain('chain 1 (mainnet)');
        expect(err.hint).toContain(
          "fewer partial signatures than the cluster's threshold",
        );
        expect(err.hint).toContain('options.clusterConfig');
      });

      it.each([
        ['for another epoch', () => signExit(2, '1')],
        ['by another share', () => signExit(3)],
      ])('one invalid partial (%s): throws', async (_name, invalid) => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith({ ...signed([1, 3, 4]), 2: invalid() }),
          ),
        );
        expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
        expect(err.hint).toContain('an invalid partial signature');
      });

      it('a partial that is not a G2 point: throws ExitRecombineError', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith({ ...signed([1, 3, 4]), 2: '0x' + 'ff'.repeat(96) }),
          ),
        );
        expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
        expect(err.message).toContain(
          'Failed to threshold-aggregate partial signatures',
        );
      });

      it('wrong chain: an exit signed for mainnet does not verify on Hoodi, and the hint says so', async () => {
        const err = await rejection(
          new Exit(560048, null).recombineExitBlobs(
            blobWith(signed([1, 2, 3, 4])),
          ),
        );
        expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
        expect(err.message).toContain('chain 560048 (hoodi)');
        expect(err.hint).toContain(
          'the validator is not on chain 560048 (hoodi)',
        );
        expect(err.hint).not.toContain('Wait for more operators');
      });

      it('another epoch or validator index than the one signed: throws', async () => {
        for (const overrides of [
          { epoch: '194049' },
          { validator_index: '1' },
        ]) {
          const err = await rejection(
            exit.recombineExitBlobs(blobWith(signed([1, 2, 3]), overrides)),
          );
          expect(err.hint).toContain(
            'epoch or validator_index are not the ones the operators signed',
          );
        }
      });

      it('another validator key: throws', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith(signed([1, 2, 3]), {
              public_key: '0x' + partialFor(1).pubshare_hex,
            }),
          ),
        );
        expect(err.code).toBe('EXIT_PARTIAL_SIGNATURE_INVALID');
      });

      it('unknown chain: throws UnsupportedChainError, verification is not skipped', async () => {
        const unknown = new Exit(31337, null);
        const blob = blobWith(signed([1, 2, 3]));
        for (const options of [
          undefined,
          {},
          { clusterConfig },
          { genesisValidatorsRoot: MAINNET.genesisValidatorsRoot },
          {
            clusterConfig: {
              ...clusterConfig,
              definition: { fork_version: '0x12345678', threshold: THRESHOLD },
            },
            genesisValidatorsRoot: MAINNET.genesisValidatorsRoot,
          },
        ]) {
          const err = await unknown
            .recombineExitBlobs(blob, options)
            .catch((e: unknown) => e);
          expect(err).toBeInstanceOf(UnsupportedChainError);
          expect((err as Error).message).toContain(
            'exit.recombineExitBlobs is not supported on chain 31337',
          );
          expect((err as Error).message).toContain('options.clusterConfig');
          expect((err as Error).message).toContain(
            'options.genesisValidatorsRoot',
          );
        }
      });

      it.each([
        ['public_key', { public_key: '0xzz' + 'ab'.repeat(47) }],
        ['public_key', { public_key: '0x1234' }],
        ['epoch', { epoch: '0x10' }],
        ['epoch', { epoch: ' 194048' }],
        ['epoch', { epoch: '' }],
        ['epoch', { epoch: '-1' }],
        ['epoch', { epoch: '18446744073709551616' }],
        ['validator_index', { validator_index: '1e3' }],
        ['validator_index', { validator_index: '12 ' }],
      ])('rejects a malformed %s (%p)', async (field, overrides) => {
        const err = await exit
          .recombineExitBlobs(blobWith(signed([1, 2, 3]), overrides))
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InvalidArgumentError);
        expect((err as InvalidArgumentError).argument).toBe(
          `exitBlob.${field}`,
        );
      });

      it('accepts leading zeros and returns canonical decimals', async () => {
        const result = await exit.recombineExitBlobs(
          blobWith(signed([1, 2, 3]), {
            epoch: '00' + EPOCH,
            validator_index: '0' + VALIDATOR_INDEX,
          }),
        );
        expect(result.signed_exit_message.message).toEqual({
          epoch: EPOCH,
          validator_index: VALIDATOR_INDEX,
        });
        expect(verifies(result.signed_exit_message.signature)).toBe(true);
      });
    });

    describe('with clusterConfig', () => {
      const options: RecombineExitBlobsOptions = { clusterConfig };

      it.each([[[1, 2, 3]], [[2, 3, 4]], [[1, 3, 4]], [[1, 2, 3, 4]]])(
        'threshold met with shares %p: the result verifies',
        async shares => {
          const result = await exit.recombineExitBlobs(
            blobWith(signed(shares)),
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

      it('below threshold: throws EXIT_NOT_ENOUGH_SHARES and says to wait', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(blobWith(signed([1, 2])), options),
        );
        expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
        expect(err.providedShares).toEqual([1, 2]);
        expect(err.validShares).toEqual([1, 2]);
        expect(err.invalidShares).toEqual([]);
        expect(err.message).toContain('2 valid partial exit signatures');
        expect(err.hint).toBe(
          'Wait for more operators to submit partial exits.',
        );
      });

      it.each([
        ['for another epoch', () => signExit(2, '1')],
        ['by another share', () => signExit(3)],
        ['not a G2 point', () => '0x' + 'ff'.repeat(96)],
      ])(
        'one invalid partial (%s) among enough valid ones: aggregates the valid ones',
        async (_name, invalidSignature) => {
          const result = await exit.recombineExitBlobs(
            blobWith({ ...signed([1, 3, 4]), 2: invalidSignature() }),
            options,
          );
          expect(verifies(result.signed_exit_message.signature)).toBe(true);
          expect(result.signed_exit_message.signature).toBe(
            legacyAggregate(signed([1, 3, 4])),
          );
        },
      );

      it('one invalid partial leaving fewer than threshold valid ones: names it', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith({ ...signed([1, 3]), 2: signExit(2, '1') }),
            options,
          ),
        );
        expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
        expect(err.validShares).toEqual([1, 3]);
        expect(err.invalidShares).toEqual([2]);
        expect(err.message).toContain('(invalid: shares 2)');
        expect(err.hint).toContain('re-collect the invalid shares (2)');
      });

      it('a partial without a public share is invalid', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith({ ...signed([1, 2]), 5: signExit(3) }),
            options,
          ),
        );
        expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
        expect(err.invalidShares).toEqual([5]);
      });

      it('no partial verifies (exit signed for another epoch): the hint names the inputs, not the operators', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith(signed([1, 2, 3]), { epoch: '194049' }),
            options,
          ),
        );
        expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
        expect(err.validShares).toEqual([]);
        expect(err.invalidShares).toEqual([1, 2, 3]);
        expect(err.hint).toContain(
          'points at the inputs rather than the operators',
        );
        expect(err.hint).toContain('chain 1 (mainnet)');
        expect(err.hint).toContain('cluster lock of this validator');
        expect(err.hint).toContain('epoch and validator_index');
        expect(err.hint).not.toContain('Wait for more operators');
      });

      it('wrong network: a Hoodi cluster and exit on a mainnet client fails on the fork version, not on the partials', async () => {
        const err = await exit
          .recombineExitBlobs(blobWith(signed([1, 2, 3], HOODI)), {
            clusterConfig: hoodiClusterConfig,
          })
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InvalidArgumentError);
        expect((err as InvalidArgumentError).argument).toBe(
          'options.clusterConfig.definition.fork_version',
        );
        expect((err as Error).message).toContain(
          "the cluster's fork_version 0x10000910 is not 0x00000000 of chain 1 (mainnet)",
        );
      });

      it('wrong network: a mainnet-labelled cluster whose exit was signed for Hoodi gets the wrong-input hint', async () => {
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith(signed([1, 2, 3, 4], HOODI)),
            options,
          ),
        );
        expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
        expect(err.invalidShares).toEqual([1, 2, 3, 4]);
        expect(err.hint).toContain(
          'Check that the validator is on chain 1 (mainnet)',
        );
        expect(err.hint).not.toContain('Wait for more operators');
      });

      it('aggregate mismatch: throws EXIT_PARTIAL_SIGNATURE_INVALID', async () => {
        // The partials verify against the public shares, but the shares are
        // not those of the validator key the exit is for.
        const otherKey = '0x' + partialFor(1).pubshare_hex;
        const err = await rejection(
          exit.recombineExitBlobs(
            blobWith(signed([1, 2, 3]), { public_key: otherKey }),
            {
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
        expect(err.hint).toContain(
          'the public shares are not those of this validator public key',
        );
      });

      it.each([
        [
          'a zero threshold',
          {
            clusterConfig: {
              ...clusterConfig,
              definition: { ...clusterConfig.definition, threshold: 0 },
            },
          },
        ],
        [
          'a validator not in the cluster',
          { clusterConfig: { ...clusterConfig, distributed_validators: [] } },
        ],
      ])('rejects options with %s', async (_name, badOptions) => {
        await expect(
          exit.recombineExitBlobs(blobWith(signed([1, 2, 3])), badOptions),
        ).rejects.toBeInstanceOf(InvalidArgumentError);
      });
    });

    describe('genesis validators root options', () => {
      const mockGenesis = (root: unknown): jest.SpiedFunction<typeof fetch> =>
        jest.spyOn(globalThis, 'fetch').mockResolvedValue({
          json: async () => ({ data: { genesis_validators_root: root } }),
        } as Response);

      it('on a known chain, a matching root or beacon node changes nothing', async () => {
        const blob = blobWith(signed([1, 2, 4]));
        const expected = await exit.recombineExitBlobs(blob);
        expect(
          await exit.recombineExitBlobs(blob, {
            genesisValidatorsRoot: MAINNET.genesisValidatorsRoot
              .slice(2)
              .toUpperCase(),
          }),
        ).toEqual(expected);

        const fetchSpy = mockGenesis(MAINNET.genesisValidatorsRoot);
        try {
          expect(
            await exit.recombineExitBlobs(blob, {
              clusterConfig,
              beaconNodeApiUrl: 'http://localhost:5052',
            }),
          ).toEqual(expected);
          expect(fetchSpy).toHaveBeenCalledWith(
            'http://localhost:5052/eth/v1/beacon/genesis',
            { method: 'GET' },
          );
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('on a known chain, a root of another network is refused', async () => {
        const err = await exit
          .recombineExitBlobs(blobWith(signed([1, 2, 3])), {
            clusterConfig,
            genesisValidatorsRoot: HOODI.genesisValidatorsRoot,
          })
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InvalidArgumentError);
        expect((err as InvalidArgumentError).argument).toBe(
          'options.genesisValidatorsRoot',
        );
        expect((err as Error).message).toContain('of chain 1 (mainnet)');
      });

      it('on a known chain, a beacon node of another network is refused', async () => {
        const fetchSpy = mockGenesis(HOODI.genesisValidatorsRoot);
        try {
          const err = await exit
            .recombineExitBlobs(blobWith(signed([1, 2, 3])), {
              beaconNodeApiUrl: 'http://localhost:5052',
            })
            .catch((e: unknown) => e);
          expect(err).toBeInstanceOf(InvalidArgumentError);
          expect((err as InvalidArgumentError).argument).toBe(
            'options.beaconNodeApiUrl',
          );
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('a beacon node without a genesis validators root is an error', async () => {
        const fetchSpy = mockGenesis(undefined);
        const errorSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        try {
          await expect(
            exit.recombineExitBlobs(blobWith(signed([1, 2, 3])), {
              beaconNodeApiUrl: 'http://localhost:5052',
            }),
          ).rejects.toThrow('Could not retrieve genesis validators root.');
        } finally {
          fetchSpy.mockRestore();
          errorSpy.mockRestore();
        }
      });

      it.each([
        [
          'both a root and a beacon URL',
          {
            genesisValidatorsRoot: MAINNET.genesisValidatorsRoot,
            beaconNodeApiUrl: 'http://localhost:5052',
          },
        ],
        ['a malformed root', { genesisValidatorsRoot: '0x1234' }],
      ])('rejects %s', async (_name, badOptions) => {
        await expect(
          exit.recombineExitBlobs(blobWith(signed([1, 2, 3])), badOptions),
        ).rejects.toBeInstanceOf(InvalidArgumentError);
      });

      describe('on a chain without constants', () => {
        const unknown = new Exit(31337, null);

        it('clusterConfig and a root supply the exit domain', async () => {
          const signatures = signed([1, 2, 3], HOODI);
          const result = await unknown.recombineExitBlobs(
            blobWith(signatures),
            {
              clusterConfig: hoodiClusterConfig,
              genesisValidatorsRoot: HOODI.genesisValidatorsRoot,
            },
          );
          expect(result.signed_exit_message.signature).toBe(
            legacyAggregate(signatures),
          );
          expect(verifies(result.signed_exit_message.signature, HOODI)).toBe(
            true,
          );
        });

        it('clusterConfig and a beacon node supply the exit domain', async () => {
          const fetchSpy = mockGenesis(HOODI.genesisValidatorsRoot);
          try {
            const result = await unknown.recombineExitBlobs(
              blobWith(signed([2, 3, 4], HOODI)),
              {
                clusterConfig: hoodiClusterConfig,
                beaconNodeApiUrl: 'http://localhost:5052',
              },
            );
            expect(verifies(result.signed_exit_message.signature, HOODI)).toBe(
              true,
            );
          } finally {
            fetchSpy.mockRestore();
          }
        });

        it('a wrong genesis validators root fails every partial, with the wrong-input hint', async () => {
          const err = await rejection(
            unknown.recombineExitBlobs(blobWith(signed([1, 2, 3], HOODI)), {
              clusterConfig: hoodiClusterConfig,
              genesisValidatorsRoot: '0x' + '00'.repeat(32),
            }),
          );
          expect(err.code).toBe('EXIT_NOT_ENOUGH_SHARES');
          expect(err.invalidShares).toEqual([1, 2, 3]);
          expect(err.hint).toContain(
            'points at the inputs rather than the operators',
          );
          expect(err.hint).toContain(
            'fork version 0x10000910, the given genesis validators root',
          );
          expect(err.hint).not.toContain('Wait for more operators');
        });
      });
    });
  });

  describe('Exit uint64 fields', () => {
    const exit = new Exit(1, null);
    const ls = bls12_381.longSignatures;
    const MAINNET = EXIT_NETWORKS[1];
    const share = partialFor(1);
    const MAX_UINT64 = '18446744073709551615';

    // Signs the exit of validator 7 at `epoch` with share 1, hashing the
    // message as uint64 (bigint), independently of Exit.
    const sign = (epoch: string): string => {
      const messageRoot = new ContainerType({
        epoch: new UintBigintType(8),
        validator_index: new UintBigintType(8),
      }).hashTreeRoot({ epoch: BigInt(epoch), validator_index: BigInt(7) });
      const root = signingRoot(
        computeDomain(
          fromHexString('04000000'),
          MAINNET.capellaForkVersion,
          fromHexString(MAINNET.genesisValidatorsRoot),
        ),
        Buffer.from(messageRoot),
      );
      return (
        '0x' +
        toHex(
          ls.Signature.toBytes(
            ls.sign(
              ls.hash(root, 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_'),
              fromHexString(share.input.secret_hex),
            ),
          ),
        )
      );
    };

    const verify = async (
      signedEpoch: string,
      epoch: string,
    ): Promise<boolean> =>
      await exit.verifyPartialExitSignature(
        '0x' + share.pubshare_hex,
        {
          message: { epoch, validator_index: '7' },
          signature: sign(signedEpoch),
        },
        MAINNET.forkVersion,
        MAINNET.genesisValidatorsRoot,
      );

    it('epochs above 2^53 are hashed exactly', async () => {
      expect(await verify(MAX_UINT64, MAX_UINT64)).toBe(true);
      // As JavaScript numbers these hashed like the epoch they round to.
      expect(await verify(MAX_UINT64, '0')).toBe(false);
      expect(await verify('9007199254740993', '9007199254740993')).toBe(true);
      expect(await verify('9007199254740993', '9007199254740992')).toBe(false);
    });

    it.each(['0x10', ' 16', '16\n', '+16', '1e1', ''])(
      'verifyPartialExitSignature rejects the non-decimal epoch %p',
      async epoch => {
        await expect(verify('16', epoch)).rejects.toBeInstanceOf(
          InvalidArgumentError,
        );
      },
    );
  });
});
