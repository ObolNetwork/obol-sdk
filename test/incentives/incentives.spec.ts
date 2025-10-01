// @ts-nocheck
import { ethers, JsonRpcProvider } from 'ethers';
import { jest, describe, beforeEach, test, expect } from '@jest/globals';
import { Client } from '../../src/index.js';
import { DEFAULT_BASE_VERSION } from '../../src/constants.js';

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider('https://holesky.gateway.tenderly.co');
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider);
const baseUrl = 'https://obol-api-dev.gcp.obol.tech';

// Fix the type error by properly typing the mock function
global.fetch = jest.fn() as any;

// Mock module functions
let mockIsContractAvailable: jest.Mock;
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
    mockIsContractAvailable = jest.fn();
    mockClaimIncentivesFromMerkleDistributor = jest.fn();
    mockIsClaimedFromMerkleDistributor = jest.fn();

    await jest.unstable_mockModule('../../src/utils.js', () => ({
      __esModule: true,
      isContractAvailable: mockIsContractAvailable,
      hexWithout0x: (hex: string) => hex.replace(/^0x/, ''),
      strToUint8Array: (str: string) => new TextEncoder().encode(str),
      definitionFlow: jest.fn(),
      findDeployedBytecode: jest.fn(),
      getProvider: jest.fn(),
    }));

    await jest.unstable_mockModule('../../src/incentives/incentiveHelpers.js', () => ({
      __esModule: true,
      claimIncentivesFromMerkleDistributor: mockClaimIncentivesFromMerkleDistributor,
      isClaimedFromMerkleDistributor: mockIsClaimedFromMerkleDistributor,
    }));

    // Re-import after mocking
    const { Client: ClientClass } = await import('../../src/index.js');
    clientInstance = new ClientClass({ baseUrl, chainId: 17000 }, mockSigner);
    (global.fetch as jest.Mock).mockReset();
  });

  test('claimIncentives should throw an error without signer', async () => {
    const { Client: ClientClass } = await import('../../src/index.js');
    const clientWithoutSigner = new ClientClass({
      baseUrl,
      chainId: 17000,
    });

    await expect(
      clientWithoutSigner.incentives.claimIncentives(
        mockIncentivesData.operator_address,
      ),
    ).rejects.toThrow('Signer is required in claimIncentives');
  });

  test('claimIncentives should throw an error if contract is not available', async () => {
    jest
      .spyOn(clientInstance.incentives, 'getIncentivesByAddress')
      .mockResolvedValue(mockIncentivesData);

    jest.spyOn(clientInstance.incentives, 'isClaimed').mockResolvedValue(false);

    mockIsContractAvailable.mockResolvedValue(false);

    await expect(
      clientInstance.incentives.claimIncentives(
        mockIncentivesData.operator_address,
      ),
    ).rejects.toThrow(
      `Merkle Distributor contract is not available at address ${mockIncentivesData.contract_address}`,
    );
  });

  test('claimIncentives should return txHash on successful claim', async () => {
    const mockTxHash =
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    jest
      .spyOn(clientInstance.incentives, 'getIncentivesByAddress')
      .mockResolvedValue(mockIncentivesData);

    jest.spyOn(clientInstance.incentives, 'isClaimed').mockResolvedValue(false);

    mockIsContractAvailable.mockResolvedValue(true);
    mockClaimIncentivesFromMerkleDistributor.mockResolvedValue({ txHash: mockTxHash });

    const result = await clientInstance.incentives.claimIncentives(
      mockIncentivesData.operator_address,
    );

    expect(result).toEqual({ txHash: mockTxHash });
    expect(mockClaimIncentivesFromMerkleDistributor).toHaveBeenCalledWith({
      signer: mockSigner,
      contractAddress: mockIncentivesData.contract_address,
      index: mockIncentivesData.index,
      operatorAddress: mockIncentivesData.operator_address,
      amount: mockIncentivesData.amount,
      merkleProof: mockIncentivesData.merkle_proof,
    });
  });

  test('claimIncentives should return txHash as null when incentives are already claimed', async () => {
    jest
      .spyOn(clientInstance.incentives, 'getIncentivesByAddress')
      .mockResolvedValue(mockIncentivesData);

    jest.spyOn(clientInstance.incentives, 'isClaimed').mockResolvedValue(true);
    
    mockIsContractAvailable.mockResolvedValue(true);

    const result = await clientInstance.incentives.claimIncentives(
      mockIncentivesData.operator_address,
    );

    expect(result).toEqual({ txHash: null });
    expect(mockClaimIncentivesFromMerkleDistributor).not.toHaveBeenCalled();
  });

  test('claimIncentives should throw an error if no incentives found for address', async () => {
    jest
      .spyOn(clientInstance.incentives, 'getIncentivesByAddress')
      .mockRejectedValue(new Error('No incentives found for address'));

    await expect(
      clientInstance.incentives.claimIncentives(
        mockIncentivesData.operator_address,
      ),
    ).rejects.toThrow(
      'Failed to claim incentives: No incentives found for address',
    );
  });

  test('claimIncentives should throw an error if helper function fails', async () => {
    jest
      .spyOn(clientInstance.incentives, 'getIncentivesByAddress')
      .mockResolvedValue(mockIncentivesData);

    jest.spyOn(clientInstance.incentives, 'isClaimed').mockResolvedValue(false);

    mockIsContractAvailable.mockResolvedValue(true);
    mockClaimIncentivesFromMerkleDistributor.mockRejectedValue(new Error('Helper function error'));

    await expect(
      clientInstance.incentives.claimIncentives(
        mockIncentivesData.operator_address,
      ),
    ).rejects.toThrow('Failed to claim incentives: Helper function error');
  });

  test('incentives should be initialized with the same chainId as client', async () => {
    const { Client: ClientClass } = await import('../../src/index.js');
    const customChainId = 5;
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
    mockIsClaimedFromMerkleDistributor.mockRejectedValue(new Error('Helper function error'));

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
        chainId: 17000,
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
      `${baseUrl}/${DEFAULT_BASE_VERSION}/address/incentives/holesky/${mockAddress}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('getIncentivesByAddress should handle API errors', async () => {
    const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    await expect(
      clientInstance.incentives.getIncentivesByAddress(mockAddress),
    ).rejects.toThrow();

    expect(global.fetch).toHaveBeenCalled();
  });
});