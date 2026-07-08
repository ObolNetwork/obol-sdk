// @ts-nocheck
import { jest } from '@jest/globals';
import { ethers, JsonRpcProvider } from 'ethers';
import { Client, validateClusterLock, type SignerType } from '../../src/index';
import {
  clusterConfigV1X10,
  clusterLockV1X10,
  clusterLockV1X11,
  clusterLockWithCompoundingWithdrawals,
  clusterLockWithSafe,
  nullDepositAmountsClusterLockV1X8,
  clusterLockSoloV1X10
} from '../fixtures.js';
import { SDK_VERSION } from '../../src/constants.js';
import { Base } from '../../src/base.js';
import { hasUniqueDistributedKeys } from '../../src/verification/common.js';
import { clusterConfigOrDefinitionHash } from '../../src/verification/common.js';
import {
  blsRecoverDistributedPubkeyFromShares,
  blsVerifyExtraShares,
} from '../../src/blsUtils.js';
import { fromHexString } from '@chainsafe/ssz';

jest.setTimeout(20000);

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider(
  process.env.RPC_HOODI || 'https://ethereum-hoodi-rpc.publicnode.com',
);
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider) as unknown as SignerType;

// /* eslint no-new: 0 */
describe('Cluster Client', () => {
  const mockConfigHash =
    '0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd';

  const clientInstance = new Client(
    { baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech', chainId: 560048 },
    mockSigner,
  );

  test('createTermsAndConditions should return "successful authorization"', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(
        Promise.resolve({ message: 'successful authorization' }),
      );

    const isAuthorized =
      await clientInstance.acceptObolLatestTermsAndConditions();
    expect(isAuthorized).toEqual('successful authorization');
  });

  test('createClusterDefinition should return config_hash', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));

    const configHash =
      await clientInstance.createClusterDefinition(clusterConfigV1X10);
    expect(configHash).toEqual(mockConfigHash);
  });

  test('acceptClusterDefinition should return cluster definition', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X10.cluster_definition));

    const clusterDefinition = await clientInstance.acceptClusterDefinition(
      {
        enr: clusterLockV1X10.cluster_definition.operators[0].enr,
        version: clusterLockV1X10.cluster_definition.version,
      },
      clusterLockV1X10.cluster_definition.config_hash,
    );
    expect(clusterDefinition).toEqual(clusterLockV1X10.cluster_definition);
  });

  test('createClusterDefinition should throw an error on invalid operators', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));
    try {
      await clientInstance.createClusterDefinition({
        ...clusterConfigV1X10,
        operators: [],
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Validation failed: /operators must pass "validateUniqueAddresses" keyword validation, /operators must NOT have fewer than 4 items',
      );
    }
  });

  test('getClusterdefinition should return cluster definition if config hash exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X10.cluster_definition));

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X10.cluster_definition.config_hash,
    );

    expect(clusterDefinition.deposit_amounts).toBeDefined();

    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X10.cluster_definition.config_hash,
    );

    // Test for new fields
    expect(clusterDefinition.compounding).toBeDefined();
    expect(clusterDefinition.target_gas_limit).toBeDefined();
    expect(clusterDefinition.consensus_protocol).toBeDefined();
  });

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X10));

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X10.cluster_definition.config_hash,
    );
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X10.lock_hash);
  });

  test('request method should set user agent header', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'user-agent header exist' }),
    } as Response);

    class TestBase extends Base {
      async callProtectedRequest<T>(
        endpoint: string,
        options?: RequestInit,
      ): Promise<T> {
        return await this['request'](endpoint, options);
      }
    }
    const testBaseInstance = new TestBase({
      baseUrl: 'https://api.obol.tech',
    });

    const result: { message: string } =
      await testBaseInstance.callProtectedRequest('/v1/test', {
        method: 'GET',
      });
    expect(result?.message).toEqual('user-agent header exist');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.obol.tech/v1/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': `Obol-SDK/${SDK_VERSION}`,
        }),
      }),
    );
    fetchSpy.mockRestore();
  });
});

describe('Cluster Client without a signer', () => {
  const clientInstance = new Client({
    baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech',
    chainId: 560048,
  });

  beforeAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.resetModules();
  });

  test('createClusterDefinition should throw an error without signer', async () => {
    try {
      await clientInstance.createClusterDefinition(clusterConfigV1X10);
    } catch (err: any) {
      expect(err.message).toEqual(
        'Signer is required in createClusterDefinition',
      );
    }
  });

  test('acceptClusterDefinition should throw an error without signer', async () => {
    try {
      await clientInstance.acceptClusterDefinition(
        {
          enr: clusterLockV1X10.cluster_definition.operators[0].enr,
          version: clusterLockV1X10.cluster_definition.version,
        },
        clusterLockV1X10.cluster_definition.config_hash,
      );
    } catch (err: any) {
      expect(err.message).toEqual(
        'Signer is required in acceptClusterDefinition',
      );
    }
  });

  test('getClusterdefinition should return cluster definition if config hash exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X10.cluster_definition));

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X10.cluster_definition.config_hash,
    );
    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X10.cluster_definition.config_hash,
    );
  });

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X10));

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X10.cluster_definition.config_hash,
    );
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X10.lock_hash);
  });

  /**
   * IMPORTANT: These tests use REAL validation logic, NOT mocked functions!
   *
   * validateClusterLock performs the following REAL cryptographic validations:
   * 1. BLS signature verification (@chainsafe/bls) - verifies deposit data signatures
   * 2. ECDSA signature verification (elliptic) - verifies operator signatures
   * 3. SSZ hashing (@chainsafe/ssz) - hashes cluster definitions and locks
   * 4. ENR validation (@chainsafe/enr) - validates Ethereum Node Records
   * 5. Safe wallet signature verification (via RPC) - for Safe multisig addresses
   *
   * Therefore, when these tests return true, it's a REAL validation result!
   */
  const mainnetSafeRpcUrl =
    process.env.RPC_MAINNET || 'https://ethereum-rpc.publicnode.com';

  test.each([
    { version: 'v1.10.0 solo', clusterLock: clusterLockSoloV1X10 },
    {
      version: 'null deposit_amounts v1.8.0',
      clusterLock: nullDepositAmountsClusterLockV1X8,
    },
    { version: 'v1.10.0', clusterLock: clusterLockV1X10 },
    {
      version: 'v1.10.0 with compounding withdrawals',
      clusterLock: clusterLockWithCompoundingWithdrawals,
    },
    {
      version: 'Cluster with safe address v1.10.0',
      clusterLock: clusterLockWithSafe,
      // Mainnet Safe operator needs a live RPC; Jest does not load .env by default.
      safeRpcUrl: mainnetSafeRpcUrl,
    },
  ])(
    "$version: 'should return true on verified cluster lock'",
    async ({ clusterLock, safeRpcUrl }) => {
      const isValidLock: boolean = await validateClusterLock(
        clusterLock,
        safeRpcUrl,
      );
      expect(isValidLock).toEqual(true);
    },
  );

  test('should return true on verified cluster lock with Safe wallet and safe rpc url', async () => {
    process.env.RPC_HOODI = undefined;

    // Mainnet cluster - fourth operator 0x4d6c432b7E2F326B4DDf524ea9E56649e5A7C298 is the Safe wallet
    const isValidLock: boolean = await validateClusterLock(
      clusterLockWithSafe,
      mainnetSafeRpcUrl,
    );
    expect(isValidLock).toEqual(true);
  });

  test('validateCluster should return false for cluster with null deposit_amounts and incorrect partial_deposits', async () => {
    const partialDeposit =
      nullDepositAmountsClusterLockV1X8.distributed_validators[0]
        .partial_deposit_data[0];
    const isValidLock: boolean = await validateClusterLock({
      ...nullDepositAmountsClusterLockV1X8,
      distributed_validators: [
        {
          ...nullDepositAmountsClusterLockV1X8.distributed_validators[0],
          partial_deposit_data: [partialDeposit, partialDeposit],
        },
      ],
    });
    expect(isValidLock).toEqual(false);
  });

  test('clusterConfigOrDefinitionHash supports v1.11.0 signature lists', () => {
    // Real v1.11 cluster whose creator config_signature is a 2-of-N Safe multisig
    // (130 bytes = two 65-byte chunks), so this exercises the List[Bytes65,32]
    // splitting logic rather than a single-chunk Bytes65 value.
    const def = clusterLockV1X11.cluster_definition;

    const configHash = clusterConfigOrDefinitionHash(def, true);
    const definitionHash = clusterConfigOrDefinitionHash(def, false);

    // Golden values produced by charon + the dev API for this exact cluster.
    expect(configHash).toEqual(def.config_hash);
    expect(definitionHash).toEqual(def.definition_hash);

    // The v1.11 root must differ from the v1.10 hashing of the same-shaped data.
    expect(definitionHash).not.toEqual(
      clusterLockV1X10.cluster_definition.definition_hash,
    );
  });

  // Unit tests of the new lock-binding validators. These target the pure
  // helpers directly rather than driving through validateClusterLock —
  // tampered locks short-circuit at either the lock_hash integrity check or
  // the downstream signature_aggregate / node_signatures checks, so they
  // can't isolate the new branches without the original signing keys.

  describe('hasUniqueDistributedKeys', () => {
    const mkLock = (keys: string[]) =>
      ({
        distributed_validators: keys.map(k => ({ distributed_public_key: k })),
      } as any);

    test('returns true for unique distributed public keys', () => {
      expect(hasUniqueDistributedKeys(mkLock(['0xaa', '0xbb']))).toBe(true);
    });

    test('returns false for duplicate keys', () => {
      expect(hasUniqueDistributedKeys(mkLock(['0xaa', '0xaa']))).toBe(false);
    });

    test('treats mixed-case hex as the same key', () => {
      expect(hasUniqueDistributedKeys(mkLock(['0xAA', '0xaa']))).toBe(false);
    });

    test('returns true for an empty validator list', () => {
      expect(hasUniqueDistributedKeys(mkLock([]))).toBe(true);
    });
  });

  describe('blsRecoverDistributedPubkeyFromShares', () => {
    const validator0 = clusterLockV1X10.distributed_validators[0];
    const threshold = clusterLockV1X10.cluster_definition.threshold;
    const sharesBytes = validator0!.public_shares.map(s => fromHexString(s));
    const dkBytes = fromHexString(validator0!.distributed_public_key);

    test('reconstructs the distributed public key from the first threshold shares', () => {
      const recovered = blsRecoverDistributedPubkeyFromShares(
        sharesBytes,
        threshold,
      );
      expect(recovered).not.toBeNull();
      expect(Buffer.from(recovered!).equals(Buffer.from(dkBytes))).toBe(true);
    });

    test('returns a different key when shares are reversed', () => {
      // Wrong positional indices for the same shares => different polynomial.
      const reversed = [...sharesBytes].reverse();
      const recovered = blsRecoverDistributedPubkeyFromShares(
        reversed,
        threshold,
      );
      expect(recovered).not.toBeNull();
      expect(Buffer.from(recovered!).equals(Buffer.from(dkBytes))).toBe(false);
    });

    test('returns null when threshold > shares.length', () => {
      expect(
        blsRecoverDistributedPubkeyFromShares(sharesBytes, sharesBytes.length + 1),
      ).toBeNull();
    });

    test('returns null when threshold <= 0', () => {
      expect(blsRecoverDistributedPubkeyFromShares(sharesBytes, 0)).toBeNull();
    });
  });

  describe('blsVerifyExtraShares', () => {
    const validator0 = clusterLockV1X10.distributed_validators[0];
    const threshold = clusterLockV1X10.cluster_definition.threshold;
    const sharesBytes = validator0!.public_shares.map(s => fromHexString(s));
    const dkBytes = fromHexString(validator0!.distributed_public_key);

    test('returns true when every extra share lies on the polynomial', () => {
      expect(blsVerifyExtraShares(sharesBytes, threshold, dkBytes)).toBe(true);
    });

    test('returns false when an extra share is not on the polynomial', () => {
      // Replace share at index `threshold` (first extra) with the DV key:
      // a valid G1 point that does not lie on the share polynomial.
      const tampered = [...sharesBytes.slice(0, threshold), dkBytes];
      // Pad back up to the original length so the loop iterates the extra.
      while (tampered.length < sharesBytes.length) tampered.push(dkBytes);
      expect(blsVerifyExtraShares(tampered, threshold, dkBytes)).toBe(false);
    });

    test('returns true vacuously when there are no extras (threshold == n)', () => {
      expect(
        blsVerifyExtraShares(sharesBytes, sharesBytes.length, dkBytes),
      ).toBe(true);
    });

    test('returns false when shares.length < threshold (precondition guard)', () => {
      expect(
        blsVerifyExtraShares(sharesBytes, sharesBytes.length + 1, dkBytes),
      ).toBe(false);
    });

    test('returns false when threshold <= 0 (precondition guard)', () => {
      expect(blsVerifyExtraShares(sharesBytes, 0, dkBytes)).toBe(false);
    });
  });
});

/**
 * Note: Tests for createObolRewardsSplit and createObolTotalSplit are in the e2e test suite
 * See: test/sdk-package/cluster.spec.ts
 *
 * These methods require real blockchain interactions (contract deployments) which cannot be
 * effectively mocked in unit tests with Jest 29 + ESM. The e2e tests cover:
 *
 * createObolRewardsSplit:
 * - Deploy OWR and splitter with various configurations
 * - Tests: signer validation, chainId validation, recipient validation, ObolRAFSplit validation,
 *   contract deployment, address prediction, and tranches retrieval
 *
 * createObolTotalSplit:
 * - Deploy splitter contracts with various configurations
 * - Tests: same recipients return same addresses, different configs return different addresses,
 *   distributorFee and controllerAddress parameters
 */
