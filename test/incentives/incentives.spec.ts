// @ts-nocheck
import {
  concat,
  ethers,
  getBytes,
  hexlify,
  Interface,
  JsonRpcProvider,
  keccak256,
  solidityPackedKeccak256,
} from 'ethers';
import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { type Client } from '../../src/index.js';
import {
  DEFAULT_BASE_VERSION,
  MERKLE_DISTRIBUTOR_RUNTIME,
  OBOL_TOKEN_ADDRESS,
} from '../../src/constants.js';
import { MerkleDistributorABI } from '../../src/abi/MerkleDistributorWithDeadline.js';
import { merkleDistributorRuntimeCode, TEST_ADDRESSES } from '../fixtures.js';

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider(
  process.env.RPC_HOODI || 'https://ethereum-hoodi-rpc.publicnode.com',
);
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider);
const baseUrl = 'https://obol-api-nonprod-dev.dev.obol.tech';

// Fix the type error by properly typing the mock function
global.fetch = jest.fn() as any;

// Merkle tree with four claims; the first one (index 0) is the operator's.
const HOODI_CHAIN_ID = 560048;
const operatorAddress = TEST_ADDRESSES.REWARD_RECIPIENT_1;
const claimAmount = '1000000000000000000';
const hashPair = (a: string, b: string): string =>
  BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
const leaves = [
  [0, operatorAddress, claimAmount],
  [1, TEST_ADDRESSES.REWARD_RECIPIENT_2, '2000'],
  [2, TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1, '3000'],
  [3, TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2, '4000'],
].map(leaf => solidityPackedKeccak256(['uint256', 'address', 'uint256'], leaf));
const merkleRoot = hashPair(
  hashPair(leaves[0], leaves[1]),
  hashPair(leaves[2], leaves[3]),
);
const validIncentivesData = {
  operator_address: operatorAddress,
  amount: claimAmount,
  index: 0,
  merkle_proof: [leaves[1], hashPair(leaves[2], leaves[3])],
  contract_address: TEST_ADDRESSES.MERKLE_DISTRIBUTOR,
};
const NOW = 1_800_000_000;
const distributorInterface = new Interface(MerkleDistributorABI.abi);

const makeDistributorProvider = (
  overrides: {
    code?: string;
    root?: string;
    token?: string;
    endTime?: number;
    claimed?: boolean;
    timestamp?: number;
  } = {},
) => {
  const state = {
    code: merkleDistributorRuntimeCode,
    root: merkleRoot,
    token: OBOL_TOKEN_ADDRESS[HOODI_CHAIN_ID],
    endTime: NOW + 3600,
    claimed: false,
    timestamp: NOW,
    ...overrides,
  };
  return {
    getCode: jest.fn().mockResolvedValue(state.code),
    getBlock: jest.fn().mockResolvedValue({ timestamp: state.timestamp }),
    call: jest.fn().mockImplementation(async ({ data }) => {
      const { name } = distributorInterface.parseTransaction({ data });
      const value = {
        merkleRoot: state.root,
        token: state.token,
        endTime: state.endTime,
        isClaimed: state.claimed,
      }[name];
      return distributorInterface.encodeFunctionResult(name, [value]);
    }),
  };
};

// Mock module functions
let mockClaimIncentivesFromMerkleDistributor: jest.Mock;
let mockIsClaimedFromMerkleDistributor: jest.Mock;

describe('Client.incentives', () => {
  let clientInstance: Client;
  const mockIncentivesData = {
    contract_address: '0x1234567890abcdef1234567890abcdef12345678',
    index: 5,
    operator_address: '0xabcdef1234567890abcdef1234567890abcdef12',
    amount: '1000000000000000000',
    merkle_proof: [
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock utils and incentiveHelpers at module level
    mockClaimIncentivesFromMerkleDistributor = jest.fn();
    mockIsClaimedFromMerkleDistributor = jest.fn();

    // @ts-expect-error - ESM mocking requires top-level await
    await jest.unstable_mockModule('../../src/utils.js', () => ({
      __esModule: true,
      isContractAvailable: jest.fn(),
      hexWithout0x: (hex: string) => hex.replace(/^0x/, ''),
      strToUint8Array: (str: string) => new TextEncoder().encode(str),
      definitionFlow: jest.fn(),
      findDeployedBytecode: jest.fn(),
      getProvider: jest.fn(),
      assertSignerChain: jest.fn(async () => undefined),
    }));

    // @ts-expect-error - ESM mocking requires top-level await
    await jest.unstable_mockModule(
      '../../src/incentives/incentiveHelpers.js',
      () => ({
        __esModule: true,
        claimIncentivesFromMerkleDistributor:
          mockClaimIncentivesFromMerkleDistributor,
        isClaimedFromMerkleDistributor: mockIsClaimedFromMerkleDistributor,
      }),
    );

    // Re-import after mocking
    const { Client: ClientClass } = await import('../../src/index.js');
    clientInstance = new ClientClass({ baseUrl, chainId: 560048 }, mockSigner);
    (global.fetch as jest.Mock).mockReset();
  });

  test('claimIncentives should throw an error without signer', async () => {
    const { Client: ClientClass } = await import('../../src/index.js');
    const clientWithoutSigner = new ClientClass({
      baseUrl,
      chainId: 560048,
    });

    await expect(
      clientWithoutSigner.incentives.claimIncentives(
        mockIncentivesData.operator_address,
      ),
    ).rejects.toThrow('Signer is required in claimIncentives');
  });

  test('incentives should be initialized with the same chainId as client', async () => {
    const { Client: ClientClass } = await import('../../src/index.js');
    const customChainId = 1;
    const clientWithCustomChain = new ClientClass(
      { baseUrl, chainId: customChainId },
      mockSigner,
    );

    expect(clientWithCustomChain.incentives.chainId).toBe(customChainId);
  });

  test('isClaimed should return true when incentive is claimed', async () => {
    mockIsClaimedFromMerkleDistributor.mockResolvedValue(true);

    const result = await clientInstance.incentives.isClaimed(
      mockIncentivesData.contract_address,
      mockIncentivesData.index,
    );

    expect(result).toBe(true);
    expect(mockIsClaimedFromMerkleDistributor).toHaveBeenCalledWith(
      mockIncentivesData.contract_address,
      mockIncentivesData.index,
      {},
    );
  });

  test('isClaimed should return false when incentive is not claimed', async () => {
    mockIsClaimedFromMerkleDistributor.mockResolvedValue(false);

    const result = await clientInstance.incentives.isClaimed(
      mockIncentivesData.contract_address,
      mockIncentivesData.index,
    );

    expect(result).toBe(false);
  });

  test('isClaimed should throw an error if helper function fails', async () => {
    mockIsClaimedFromMerkleDistributor.mockRejectedValue(
      new Error('Helper function error'),
    );

    await expect(
      clientInstance.incentives.isClaimed(
        mockIncentivesData.contract_address,
        mockIncentivesData.index,
      ),
    ).rejects.toThrow('Helper function error');
  });

  test('isClaimed should work with a provider and a without signer', async () => {
    const { Client: ClientClass } = await import('../../src/index.js');
    const clientWithoutSigner = new ClientClass(
      {
        baseUrl,
        chainId: 560048,
      },
      undefined,
      provider,
    );

    mockIsClaimedFromMerkleDistributor.mockResolvedValue(true);

    const result = await clientWithoutSigner.incentives.isClaimed(
      mockIncentivesData.contract_address,
      mockIncentivesData.index,
    );

    expect(result).toBe(true);
    expect(mockIsClaimedFromMerkleDistributor).toHaveBeenCalledWith(
      mockIncentivesData.contract_address,
      mockIncentivesData.index,
      provider,
    );
  });

  test('getIncentivesByAddress should make the correct API request', async () => {
    const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const mockIncentives = {
      operator_address: '0x8c00157cae72c4ed6a1f8bfb60205601f0252e26',
      amount: '100',
      index: 1,
      merkle_proof: ['hash1', 'hash2'],
      contract_address: '0xContract',
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockIncentives,
      headers: new Headers(),
    });

    const result =
      await clientInstance.incentives.getIncentivesByAddress(mockAddress);

    expect(result).toEqual(mockIncentives);

    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/${DEFAULT_BASE_VERSION}/address/incentives/hoodi/${mockAddress}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('getIncentivesByAddress rejects malformed addresses before fetching', async () => {
    for (const address of [
      '0xContract',
      '../../definition/0x00',
      '1234567890abcdef1234567890abcdef12345678',
    ]) {
      await expect(
        clientInstance.incentives.getIncentivesByAddress(address),
      ).rejects.toThrow('Invalid address');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('getIncentivesByAddress should handle API errors', async () => {
    const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    await expect(
      clientInstance.incentives.getIncentivesByAddress(mockAddress),
    ).rejects.toThrow();

    expect(global.fetch).toHaveBeenCalled();
  });
  describe('preflightClaim and claimIncentives checks', () => {
    const makeClient = async (
      distributorProvider,
      chainId = HOODI_CHAIN_ID,
      signer = mockSigner,
    ) => {
      const { Client: ClientClass } = await import('../../src/index.js');
      return new ClientClass({ baseUrl, chainId }, signer, distributorProvider);
    };

    const preflight = async (
      providerOverrides = {},
      incentivesData = validIncentivesData,
      chainId = HOODI_CHAIN_ID,
    ) => {
      const distributorProvider = makeDistributorProvider(providerOverrides);
      const client = await makeClient(distributorProvider, chainId);
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(incentivesData);
      const result = await client.incentives.preflightClaim(operatorAddress);
      return { result, distributorProvider };
    };

    const codes = result => result.issues.map(issue => issue.code);

    test('passes for a valid claim', async () => {
      const { result } = await preflight();
      expect(result).toEqual({ ok: true, issues: [] });
    });

    test('accepts the operator address in a different case', async () => {
      const { result } = await preflight(
        {},
        {
          ...validIncentivesData,
          operator_address: operatorAddress.toUpperCase().replace('0X', '0x'),
        },
      );
      expect(result.ok).toBe(true);
    });

    test('accepts a distributor with different immutables', async () => {
      const code = getBytes(merkleDistributorRuntimeCode);
      for (const offset of MERKLE_DISTRIBUTOR_RUNTIME.immutableOffsets) {
        code.fill(0xaa, offset, offset + 32);
      }
      code.fill(0xbb, code.length - 40, code.length - 10);
      const { result } = await preflight({ code: hexlify(code) });
      expect(result.ok).toBe(true);
    });

    test('reports issues with code, message and hint', async () => {
      const { result } = await preflight({ claimed: true });
      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        {
          code: 'ALREADY_CLAIMED',
          message: expect.any(String),
          hint: expect.any(String),
        },
      ]);
    });

    test('rejects a proof that does not fold to the root', async () => {
      const { result } = await preflight(
        {},
        {
          ...validIncentivesData,
          merkle_proof: [leaves[2], hashPair(leaves[2], leaves[3])],
        },
      );
      expect(codes(result)).toEqual(['INVALID_PROOF']);
    });

    test('rejects an amount that is not in the tree', async () => {
      const { result } = await preflight(
        {},
        { ...validIncentivesData, amount: '1000000000000000001' },
      );
      expect(codes(result)).toEqual(['INVALID_PROOF']);
    });

    test('rejects when the on-chain root differs', async () => {
      const { result } = await preflight({ root: leaves[0] });
      expect(codes(result)).toEqual(['INVALID_PROOF']);
    });

    test('reports an already claimed index', async () => {
      const { result } = await preflight({ claimed: true });
      expect(codes(result)).toEqual(['ALREADY_CLAIMED']);
    });

    test('reports a closed claim window', async () => {
      const { result } = await preflight({ endTime: NOW - 1 });
      expect(codes(result)).toEqual(['CLAIM_WINDOW_CLOSED']);
    });

    test('allows a claim in the last second of the window', async () => {
      const { result } = await preflight({ endTime: NOW });
      expect(result.ok).toBe(true);
    });

    test('rejects a distributor paying out another token', async () => {
      const { result } = await preflight({
        token: TEST_ADDRESSES.OVM_OWNER,
      });
      expect(codes(result)).toEqual(['UNEXPECTED_TOKEN']);
    });

    test('rejects the mainnet OBOL token on Hoodi', async () => {
      const { result } = await preflight({ token: OBOL_TOKEN_ADDRESS[1] });
      expect(codes(result)).toEqual(['UNEXPECTED_TOKEN']);
    });

    test('reports chains without a known OBOL token', async () => {
      // The Client only accepts mainnet and Hoodi, so call the check directly.
      const { preflightIncentivesClaim } =
        await import('../../src/incentives/incentivesPreflight.js');
      const result = await preflightIncentivesClaim({
        requestedAddress: operatorAddress,
        incentivesData: validIncentivesData,
        chainId: 11155111,
        provider: makeDistributorProvider(),
      });
      expect(codes(result)).toEqual(['UNSUPPORTED_CHAIN']);
    });

    test('rejects contract code that differs from the reference build', async () => {
      const code = getBytes(merkleDistributorRuntimeCode);
      code[100] ^= 0xff;
      const { result, distributorProvider } = await preflight({
        code: hexlify(code),
      });
      expect(codes(result)).toEqual(['UNKNOWN_DISTRIBUTOR']);
      expect(distributorProvider.call).not.toHaveBeenCalled();
    });

    test('rejects contract code of a different length', async () => {
      const { result } = await preflight({
        code: merkleDistributorRuntimeCode + '00',
      });
      expect(codes(result)).toEqual(['UNKNOWN_DISTRIBUTOR']);
    });

    test('reports a missing contract', async () => {
      const { result } = await preflight({ code: '0x' });
      expect(codes(result)).toEqual(['CONTRACT_NOT_DEPLOYED']);
    });

    test('rejects data for a different operator address', async () => {
      const { result, distributorProvider } = await preflight(
        {},
        {
          ...validIncentivesData,
          operator_address: TEST_ADDRESSES.REWARD_RECIPIENT_2,
        },
      );
      expect(codes(result)).toEqual(['OPERATOR_ADDRESS_MISMATCH']);
      expect(distributorProvider.getCode).not.toHaveBeenCalled();
    });

    test('rejects malformed incentives data', async () => {
      const { result } = await preflight(
        {},
        {
          ...validIncentivesData,
          index: -1,
          amount: '1e18',
          merkle_proof: ['0x1234'],
        },
      );
      expect(codes(result)).toEqual([
        'INVALID_INCENTIVES_DATA',
        'INVALID_INCENTIVES_DATA',
        'INVALID_INCENTIVES_DATA',
      ]);
    });

    test('reports a 404 as INCENTIVES_NOT_FOUND', async () => {
      const { NotFoundError } = await import('../../src/index.js');
      const client = await makeClient(makeDistributorProvider());
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockRejectedValue(
          new NotFoundError({ status: 404, endpoint: '/v1/address' }),
        );
      const result = await client.incentives.preflightClaim(operatorAddress);
      expect(codes(result)).toEqual(['INCENTIVES_NOT_FOUND']);
    });

    test('reports other API errors as INCENTIVES_FETCH_FAILED', async () => {
      const client = await makeClient(makeDistributorProvider());
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'unavailable' }),
        text: async () => '{"message":"unavailable"}',
      }));
      const result = await client.incentives.preflightClaim(operatorAddress);
      expect(codes(result)).toEqual(['INCENTIVES_FETCH_FAILED']);
      expect(result.issues[0].message).toContain('unavailable');
    });

    describe('address without incentives', () => {
      // What the API returns (HTTP 200) for an address with no incentives.
      const noIncentives = {
        operator_address: operatorAddress,
        amount: '0',
        index: -1,
        merkle_proof: [],
        contract_address: '',
      };

      test('preflightClaim reports NO_INCENTIVES without touching the chain', async () => {
        const { result, distributorProvider } = await preflight(
          {},
          noIncentives,
        );
        expect(codes(result)).toEqual(['NO_INCENTIVES']);
        expect(result.ok).toBe(false);
        expect(distributorProvider.getCode).not.toHaveBeenCalled();
      });

      test('claimIncentives throws IncentivesPreflightError and does not claim', async () => {
        const consoleSpy = jest.spyOn(console, 'log');
        const client = await makeClient(makeDistributorProvider());
        jest
          .spyOn(client.incentives, 'getIncentivesByAddress')
          .mockResolvedValue(noIncentives);

        const error = await client.incentives
          .claimIncentives(operatorAddress)
          .catch(e => e);
        const { IncentivesPreflightError } = await import('../../src/index.js');
        expect(error).toBeInstanceOf(IncentivesPreflightError);
        expect(error.issues.map(i => i.code)).toEqual(['NO_INCENTIVES']);
        expect(error.message).toContain('No incentives found');
        expect(mockClaimIncentivesFromMerkleDistributor).not.toHaveBeenCalled();
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      });

      test('isClaimed rejects the empty contract address and a negative index', async () => {
        const { InvalidArgumentError } = await import('../../src/index.js');
        const client = await makeClient(makeDistributorProvider());
        await expect(client.incentives.isClaimed('', -1)).rejects.toThrow(
          InvalidArgumentError,
        );
        await expect(
          client.incentives.isClaimed(TEST_ADDRESSES.MERKLE_DISTRIBUTOR, -1),
        ).rejects.toThrow('Invalid index');
        expect(mockIsClaimedFromMerkleDistributor).not.toHaveBeenCalled();
      });
    });

    test('claimIncentives claims for an account other than the signer', async () => {
      const mockTxHash =
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const client = await makeClient(makeDistributorProvider());
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);
      mockClaimIncentivesFromMerkleDistributor.mockResolvedValue({
        txHash: mockTxHash,
      });

      expect(mockSigner.address).not.toEqual(operatorAddress);
      const result = await client.incentives.claimIncentives(operatorAddress);

      expect(result).toEqual({ txHash: mockTxHash });
      expect(mockClaimIncentivesFromMerkleDistributor).toHaveBeenCalledWith({
        signer: mockSigner,
        contractAddress: validIncentivesData.contract_address,
        index: validIncentivesData.index,
        operatorAddress,
        amount: validIncentivesData.amount,
        merkleProof: validIncentivesData.merkle_proof,
      });
    });

    test('claimIncentives throws and does not claim when a check fails', async () => {
      const client = await makeClient(
        makeDistributorProvider({ root: leaves[0] }),
      );
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);

      const error = await client.incentives
        .claimIncentives(operatorAddress)
        .catch(e => e);
      expect(error.message).toMatch(
        /^Failed to claim incentives: \[INVALID_PROOF\]/,
      );
      const { IncentivesPreflightError, ObolSdkError } =
        await import('../../src/index.js');
      expect(error).toBeInstanceOf(IncentivesPreflightError);
      expect(error).toBeInstanceOf(ObolSdkError);
      expect(error.code).toBe('INCENTIVES_PREFLIGHT_FAILED');
      expect(error.issues.map(i => i.code)).toEqual(['INVALID_PROOF']);
      expect(typeof error.hint).toBe('string');
      expect(mockClaimIncentivesFromMerkleDistributor).not.toHaveBeenCalled();
    });

    test('claimIncentives keeps the contract not available message', async () => {
      const client = await makeClient(makeDistributorProvider({ code: '0x' }));
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);

      await expect(
        client.incentives.claimIncentives(operatorAddress),
      ).rejects.toThrow(
        `Merkle Distributor contract is not available at address ${validIncentivesData.contract_address}`,
      );
    });

    test('claimIncentives returns a null txHash when already claimed', async () => {
      const client = await makeClient(
        makeDistributorProvider({ claimed: true, endTime: NOW - 1 }),
      );
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);

      const result = await client.incentives.claimIncentives(operatorAddress);

      expect(result).toEqual({ txHash: null });
      expect(mockClaimIncentivesFromMerkleDistributor).not.toHaveBeenCalled();
    });

    test('claimIncentives throws on a closed claim window', async () => {
      const client = await makeClient(
        makeDistributorProvider({ endTime: NOW - 1 }),
      );
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);

      await expect(
        client.incentives.claimIncentives(operatorAddress),
      ).rejects.toThrow('[CLAIM_WINDOW_CLOSED]');
      expect(mockClaimIncentivesFromMerkleDistributor).not.toHaveBeenCalled();
    });

    test('claimIncentives surfaces claim transaction errors', async () => {
      const client = await makeClient(makeDistributorProvider());
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);
      mockClaimIncentivesFromMerkleDistributor.mockRejectedValue(
        new Error('Helper function error'),
      );

      await expect(
        client.incentives.claimIncentives(operatorAddress),
      ).rejects.toThrow('Failed to claim incentives: Helper function error');
    });

    test('claimIncentives passes onSent through and keeps TransactionSubmissionError', async () => {
      const { TransactionSubmissionError } =
        await import('../../src/errors.js');
      const client = await makeClient(makeDistributorProvider());
      jest
        .spyOn(client.incentives, 'getIncentivesByAddress')
        .mockResolvedValue(validIncentivesData);
      const failure = new TransactionSubmissionError(
        'Failed to claim incentives: timeout',
        {
          txHashes: [],
          pendingTxHash: '0xpending',
          cause: new Error('timeout'),
        },
      );
      mockClaimIncentivesFromMerkleDistributor.mockRejectedValue(failure);
      const onSent = jest.fn();

      const error = await client.incentives
        .claimIncentives(operatorAddress, { onSent })
        .catch(e => e);

      expect(error).toBe(failure);
      expect(error.pendingTxHash).toBe('0xpending');
      expect(mockClaimIncentivesFromMerkleDistributor).toHaveBeenCalledWith(
        expect.objectContaining({ options: { onSent } }),
      );
    });
  });
});
