import { ethers, JsonRpcProvider } from 'ethers';
import { Client, validateClusterLock } from '../src/index';
import {
  clusterConfigV1X7,
  clusterConfigV1X8,
  clusterLockV1X6,
  clusterLockV1X7,
  clusterLockV1X8,
  nullDepositAmountsClusterLockV1X8,
} from './fixtures.js';
import { SDK_VERSION } from '../src/constants';
import { Base } from '../src/base';
import { validatePayload } from '../src/ajv';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { hashTermsAndConditions } from '../src/verification/termsAndConditions';
import * as utils from '../src/utils';
import * as splitsHelpers from '../src/splitHelpers';

/* eslint no-new: 0 */
describe('Cluster Client', () => {
  const mockConfigHash =
    '0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd';
  const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
  const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
  const provider = new JsonRpcProvider(
    'https://ethereum-holesky.publicnode.com',
  );
  const wallet = new ethers.Wallet(privateKey, provider);
  const mockSigner = wallet.connect(provider);

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
      await clientInstance.createClusterDefinition(clusterConfigV1X8);
    expect(configHash).toEqual(mockConfigHash);
  });

  test('acceptClusterDefinition should return cluster definition', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X8.cluster_definition));

    const clusterDefinition = await clientInstance.acceptClusterDefinition(
      {
        enr: clusterLockV1X8.cluster_definition.operators[0].enr,
        version: clusterLockV1X8.cluster_definition.version,
      },
      clusterLockV1X8.cluster_definition.config_hash,
    );
    expect(clusterDefinition).toEqual(clusterLockV1X8.cluster_definition);
  });

  test('createClusterDefinition should throw an error on invalid operators', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));
    try {
      await clientInstance.createClusterDefinition({
        ...clusterConfigV1X8,
        operators: [],
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        "Schema compilation errors', must NOT have fewer than 4 items",
      );
    }
  });

  // cause we default to 32000000000
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
        'Schema compilation errors\', must pass "validDepositAmounts" keyword validation',
      );
    }
  });

  test('validatePayload should throw an error on empty schema', async () => {
    try {
      validatePayload({ ...clusterConfigV1X8, operators: [] }, '');
    } catch (error: any) {
      expect(error.message).toEqual('schema must be object or boolean');
    }
  });

  test('getClusterdefinition should return cluster definition if config hash exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X8.cluster_definition));

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X8.cluster_definition.config_hash,
    );

    expect(clusterDefinition.deposit_amounts?.length).toEqual(
      clusterLockV1X8.cluster_definition.deposit_amounts.length,
    );

    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X8.cluster_definition.config_hash,
    );
  });

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X8));

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X8.cluster_definition.config_hash,
    );
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X8.lock_hash);
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

  test('createClusterDefinition should throw an error without signer', async () => {
    try {
      await clientInstance.createClusterDefinition(clusterConfigV1X8);
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
          enr: clusterLockV1X8.cluster_definition.operators[0].enr,
          version: clusterLockV1X8.cluster_definition.version,
        },
        clusterLockV1X8.cluster_definition.config_hash,
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
      .mockReturnValue(Promise.resolve(clusterLockV1X8.cluster_definition));

    const clusterDefinition = await clientInstance.getClusterDefinition(
      clusterLockV1X8.cluster_definition.config_hash,
    );
    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X8.cluster_definition.config_hash,
    );
  });

  test('getClusterLock should return lockFile if exist', async () => {
    clientInstance['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(clusterLockV1X8));

    const clusterLock = await clientInstance.getClusterLock(
      clusterLockV1X8.cluster_definition.config_hash,
    );
    expect(clusterLock.lock_hash).toEqual(clusterLockV1X8.lock_hash);
  });

  test.each([
    { version: 'v1.6.0', clusterLock: clusterLockV1X6 },
    { version: 'v1.7.0', clusterLock: clusterLockV1X7 },
    { version: 'v1.8.0', clusterLock: clusterLockV1X8 },
    {
      version: 'null deposit_amounts v1.8.0',
      clusterLock: nullDepositAmountsClusterLockV1X8,
    },
  ])(
    "$version: 'should return true on verified cluster lock'",
    async ({ clusterLock }) => {
      const isValidLock: boolean = await validateClusterLock(clusterLock);
      expect(isValidLock).toEqual(true);
    },
  );

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
    const termsAndConditionsHash = await hashTermsAndConditions();
    expect(termsAndConditionsHash).toEqual(
      '0xd33721644e8f3afab1495a74abe3523cec12d48b8da6cb760972492ca3f1a273',
    );
  });
});

describe('createObolRewardSplit', () => {
  jest
    .spyOn(utils, 'isContractAvailable')
    .mockImplementation(async () => await Promise.resolve(true));
  jest
    .spyOn(splitsHelpers, 'predictSplitterAddress')
    .mockImplementation(
      async () => await Promise.resolve('0xPredictedAddress'),
    );
  jest.spyOn(splitsHelpers, 'handleDeployOWRAndSplitter').mockImplementation(
    async () =>
      await Promise.resolve({
        withdrawalAddress: '0xWithdrawalAddress',
        feeRecipientAddress: '0xFeeRecipientAddress',
      }),
  );

  const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
  const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
  const provider = new JsonRpcProvider(
    'https://ethereum-holesky.publicnode.com',
  );
  const wallet = new ethers.Wallet(privateKey, provider);
  const mockSigner = wallet.connect(provider);

  const clientInstance = new Client(
    { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 17000 },
    mockSigner,
  );

  const clientInstanceWithourSigner = new Client({
    baseUrl: 'https://obol-api-dev.gcp.obol.tech',
    chainId: 17000,
  });
  const mockSplitRecipients = [
    {
      account: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      percentAllocation: 99,
    },
  ];
  const mockPrincipalRecipient = '0x86B8145c98e5BD25BA722645b15eD65f024a87EC';
  const mockValidatorsSize = 2;

  it('should throw an error if signer is not defined', async () => {
    await expect(
      clientInstanceWithourSigner.createObolRewardSplit({
        splitRecipients: mockSplitRecipients,
        principalRecipient: mockPrincipalRecipient,
        validatorsSize: mockValidatorsSize,
      }),
    ).rejects.toThrow('Signer is required in createObolRewardSplit');
  });

  it('should throw an error if chainId is not supported', async () => {
    const unsupportedSplitterChainClient = new Client(
      { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 100 },
      mockSigner,
    );

    try {
      await unsupportedSplitterChainClient.createObolRewardSplit({
        splitRecipients: mockSplitRecipients,
        principalRecipient: mockPrincipalRecipient,
        validatorsSize: mockValidatorsSize,
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Splitter configuration is not supported on 100 chain',
      );
    }
  });

  test('should throw an error on invalid recipients', async () => {
    try {
      await clientInstance.createObolRewardSplit({
        splitRecipients: [
          {
            account: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
            percentAllocation: 22,
          },
        ],
        principalRecipient: mockPrincipalRecipient,
        validatorsSize: mockValidatorsSize,
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Schema compilation errors\', must pass "validateSplitRecipients" keyword validation',
      );
    }
  });

  test('should throw an error if ObolRAFSplit is less than 1', async () => {
    try {
      await clientInstance.createObolRewardSplit({
        splitRecipients: mockSplitRecipients,
        principalRecipient: mockPrincipalRecipient,
        validatorsSize: mockValidatorsSize,
        ObolRAFSplit: 0.5
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Schema compilation errors\', must be >= 1',
      );
    }
  });

  it('should return the correct withdrawal and fee recipient addresses', async () => {
    const result = await clientInstance.createObolRewardSplit({
      splitRecipients: mockSplitRecipients,
      principalRecipient: mockPrincipalRecipient,
      validatorsSize: mockValidatorsSize,
    });

    expect(result).toEqual({
      withdrawalAddress: '0xWithdrawalAddress',
      feeRecipientAddress: '0xFeeRecipientAddress',
    });
  });
});

describe('createObolTotalSplit', () => {
  jest
    .spyOn(utils, 'isContractAvailable')
    .mockImplementation(async () => await Promise.resolve(true));
  jest
    .spyOn(splitsHelpers, 'predictSplitterAddress')
    .mockImplementation(
      async () => await Promise.resolve('0xPredictedAddress'),
    );
  jest.spyOn(splitsHelpers, 'deploySplitterContract').mockImplementation(
    async () =>
      await Promise.resolve(
        '0xSplitterAddress',
      ),
  );

  const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
  const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
  const provider = new JsonRpcProvider(
    'https://ethereum-holesky.publicnode.com',
  );
  const wallet = new ethers.Wallet(privateKey, provider);
  const mockSigner = wallet.connect(provider);

  const clientInstance = new Client(
    { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 17000 },
    mockSigner,
  );

  const clientInstanceWithourSigner = new Client({
    baseUrl: 'https://obol-api-dev.gcp.obol.tech',
    chainId: 17000,
  });
  const mockSplitRecipients = [
    {
      account: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
      percentAllocation: 99.9,
    },
  ];

  it('should throw an error if signer is not defined', async () => {
    await expect(
      clientInstanceWithourSigner.createObolTotalSplit({
        splitRecipients: mockSplitRecipients,
      }),
    ).rejects.toThrow('Signer is required in createObolTotalSplit');
  });

  it('should throw an error if chainId is not supported', async () => {
    const unsupportedSplitterChainClient = new Client(
      { baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 100 },
      mockSigner,
    );

    try {
      await unsupportedSplitterChainClient.createObolTotalSplit({
        splitRecipients: mockSplitRecipients,
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Splitter configuration is not supported on 100 chain',
      );
    }
  });

  test('should throw an error on invalid recipients', async () => {
    try {
      await clientInstance.createObolTotalSplit({
        splitRecipients: [
          {
            account: '0x86B8145c98e5BD25BA722645b15eD65f024a87EC',
            percentAllocation: 22,
          },
        ],
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Schema compilation errors\', must pass "validateSplitRecipients" keyword validation',
      );
    }
  });

  test('should throw an error if ObolRAFSplit is less than 0.1', async () => {
    try {
      await clientInstance.createObolTotalSplit({
        splitRecipients: mockSplitRecipients,
        ObolRAFSplit: 0.05
      });
    } catch (error: any) {
      expect(error.message).toEqual(
        'Schema compilation errors\', must be >= 0.1',
      );
    }
  });

  it('should return the correct withdrawal and fee recipient addresses and ObolRAFSplit', async () => {
    const result = await clientInstance.createObolTotalSplit({
      splitRecipients: mockSplitRecipients,
      ObolRAFSplit: 0.5
    });

    //0xPredictedAddress and not 0xSplitterAddress since were mocking isContractAvailable response to be true
    expect(result).toEqual({
      withdrawalAddress: '0xPredictedAddress',
      feeRecipientAddress: '0xPredictedAddress',
    });
  });

  it('should return the correct withdrawal and fee recipient addresses without passing ObolRAFSplit', async () => {
    const result = await clientInstance.createObolTotalSplit({
      splitRecipients: mockSplitRecipients,
    });

    //0xPredictedAddress and not 0xSplitterAddress since were mocking isContractAvailable response to be true
    expect(result).toEqual({
      withdrawalAddress: '0xPredictedAddress',
      feeRecipientAddress: '0xPredictedAddress',
    });
  });
});
