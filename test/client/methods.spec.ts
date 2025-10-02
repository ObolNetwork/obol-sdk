// @ts-nocheck
import { jest } from '@jest/globals';
import { ethers, JsonRpcProvider } from 'ethers';
import { Client, validateClusterLock, type SignerType } from '../../src/index';
import { hashTermsAndConditions } from '../../src/verification/termsAndConditions';
import {
  clusterConfigV1X7,
  clusterConfigV1X10,
  clusterLockV1X10,
  clusterLockV1X6,
  clusterLockV1X7,
  clusterLockV1X8,
  clusterLockWithCompoundingWithdrawals,
  clusterLockWithSafe,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures.js';
import { SDK_VERSION } from '../../src/constants.js';
import { Base } from '../../src/base.js';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

jest.setTimeout(20000);

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider(
  'https://eth-holesky.g.alchemy.com/v2/taBm2YkxMubBs-p-LosN6ICX5lH5l3xc',
);
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider) as unknown as SignerType;

// /* eslint no-new: 0 */
describe('Cluster Client', () => {
  const mockConfigHash =
    '0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd';

  const clientInstance = new Client(
    { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 17000 },
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

  // cause we default to null
  test('createClusterDefinition should accept a configuration without deposit_amounts', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));

    const configHash = await clientInstance.createClusterDefinition({
      ...clusterConfigV1X7,
    });

    expect(configHash).toEqual(mockConfigHash);
  });

  test('createClusterDefinition should throw on not valid deposit_amounts ', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));
    try {
      await clientInstance.createClusterDefinition({
        ...clusterConfigV1X7,
        deposit_amounts: ['34000000'],
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Validation failed: /deposit_amounts/0 must be equal to one of the allowed values, /deposit_amounts must match "then" schema',
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
    const server = setupServer(
      http.get('http://testexample.com/test', ({ request }) => {
        // Check if the request contains specific headers
        if (request.headers.get('User-Agent') === `Obol-SDK/${SDK_VERSION}`) {
          return HttpResponse.json({ message: 'user-agent header exist' });
        }
      }),
    );
    server.listen();
    class TestBase extends Base {
      async callProtectedRequest<T>(
        endpoint: string,
        options?: RequestInit,
      ): Promise<T> {
        return await this['request'](endpoint, options);
      }
    }
    const testBaseInstance = new TestBase({
      baseUrl: 'http://testExample.com',
    });

    const result: { message: string } =
      await testBaseInstance.callProtectedRequest('/test', {
        method: 'GET',
      });
    expect(result?.message).toEqual('user-agent header exist');
    server.close();
  });
});

describe('Cluster Client without a signer', () => {
  const clientInstance = new Client({
    baseUrl: 'https://obol-api-dev.gcp.obol.tech',
    chainId: 17000,
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
  test.each([
    { version: 'v1.6.0', clusterLock: clusterLockV1X6 },
    { version: 'v1.7.0', clusterLock: clusterLockV1X7 },
    { version: 'v1.8.0', clusterLock: clusterLockV1X8 },
    {
      version: 'null deposit_amounts v1.8.0',
      clusterLock: nullDepositAmountsClusterLockV1X8,
    },
    {
      version: 'Cluster with safe address v1.8.0',
      clusterLock: clusterLockWithSafe,
    },
    { version: 'v1.10.0', clusterLock: clusterLockV1X10 },
    {
      version: 'v1.10.0 with compunding withdrawals',
      clusterLock: clusterLockWithCompoundingWithdrawals,
    },
  ])(
    "$version: 'should return true on verified cluster lock'",
    async ({ clusterLock }) => {
      const isValidLock: boolean = await validateClusterLock(clusterLock);
      expect(isValidLock).toEqual(true);
    },
  );

  test('should return true on verified cluster lock with Safe wallet and safe rpc url', async () => {
    process.env.RPC_HOLESKY = undefined;

    const safeRpcUrl = 'https://holesky.gateway.tenderly.co';
    const isValidLock: boolean = await validateClusterLock(
      clusterLockWithSafe,
      safeRpcUrl,
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
  test('Finds the hash of the latest version of terms and conditions', async () => {
    // This test validates that hashTermsAndConditions:
    // 1. Fetches the REAL PDF from https://obol.org/terms.pdf (network call)
    // 2. Processes it through REAL pdf-parse library (extracts text)
    // 3. Computes the REAL SSZ hash using @chainsafe/ssz
    // NO MOCKING - this is a full end-to-end test of the function!
    const termsAndConditionsHash = await hashTermsAndConditions();
    expect(termsAndConditionsHash).toEqual(
      '0xd33721644e8f3afab1495a74abe3523cec12d48b8da6cb760972492ca3f1a273',
    );
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
