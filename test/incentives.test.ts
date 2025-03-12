import { ethers, JsonRpcProvider } from 'ethers';
import { Client } from '../src/index';
import * as utils from '../src/utils';
import * as incentivesHelpers from '../src/incentivesHalpers';
import { DEFAULT_BASE_VERSION } from '../src/constants';


const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider('https://ethereum-holesky.publicnode.com');
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider);

describe('Client.incentives', () => {
  let clientInstance: Client;
  const mockIncentivesData = {
    contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
    index: 5,
    operatorAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
    amount: '1000000000000000000',
    merkleProof: [
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clientInstance = new Client({ baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 17000 }, mockSigner);
  });

  test('claimIncentives should throw an error without signer', async () => {
    const clientWithoutSigner = new Client({ baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: 17000 });

    await expect(
      clientWithoutSigner.incentives.claimIncentives(mockIncentivesData)
    ).rejects.toThrow('Signer is required in claimIncentives');
  });

  test('claimIncentives should throw an error if contract is not available', async () => {
    jest.spyOn(utils, 'isContractAvailable').mockImplementation(
      async () => await Promise.resolve(false)
    );

    await expect(
      clientInstance.incentives.claimIncentives(mockIncentivesData)
    ).rejects.toThrow(
      `Merkle Distributor contract is not available at address ${mockIncentivesData.contractAddress}`
    );
  });

  test('claimIncentives should return txHash on successful claim', async () => {
    const mockTxHash = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    jest.spyOn(utils, 'isContractAvailable').mockImplementation(
      async () => await Promise.resolve(true)
    );

    jest.spyOn(incentivesHelpers, 'claimIncentivesFromMerkleDistributor').mockImplementation(
      async () => await Promise.resolve({ txHash: mockTxHash })
    );

    const result = await clientInstance.incentives.claimIncentives(mockIncentivesData);

    expect(result).toEqual({ txHash: mockTxHash });
    expect(incentivesHelpers.claimIncentivesFromMerkleDistributor).toHaveBeenCalledWith({
      signer: mockSigner,
      contractAddress: mockIncentivesData.contractAddress,
      index: mockIncentivesData.index,
      operatorAddress: mockIncentivesData.operatorAddress,
      amount: mockIncentivesData.amount,
      merkleProof: mockIncentivesData.merkleProof,
    });
  });

  test('claimIncentives should throw an error if helper function fails', async () => {
    jest.spyOn(utils, 'isContractAvailable').mockImplementation(
      async () => await Promise.resolve(true)
    );

    jest.spyOn(incentivesHelpers, 'claimIncentivesFromMerkleDistributor').mockImplementation(
      async () => { throw new Error('Helper function error'); }
    );

    await expect(
      clientInstance.incentives.claimIncentives(mockIncentivesData)
    ).rejects.toThrow('Failed to claim incentives: Helper function error');
  });

  test('incentives should be initialized with the same chainId as client', () => {
    const customChainId = 5;
    const clientWithCustomChain = new Client({ baseUrl: 'https://obol-api-dev.gcp.obol.tech', chainId: customChainId }, mockSigner);

    expect(clientWithCustomChain.incentives.chainId).toBe(customChainId);
  });

  test('isClaimed should return true when incentive is claimed', async () => {
    jest.spyOn(incentivesHelpers, 'isClaimedFromMerkleDistributor').mockImplementation(
      async () => await Promise.resolve(true)
    );

    const result = await clientInstance.incentives.isClaimed(
      mockIncentivesData.contractAddress,
      mockIncentivesData.index
    );

    expect(result).toBe(true);
    expect(incentivesHelpers.isClaimedFromMerkleDistributor).toHaveBeenCalledWith(
      clientInstance.incentives.chainId,
      mockIncentivesData.contractAddress,
      mockIncentivesData.index
    );
  });

  test('isClaimed should return false when incentive is not claimed', async () => {
    jest.spyOn(incentivesHelpers, 'isClaimedFromMerkleDistributor').mockImplementation(
      async () => await Promise.resolve(false)
    );

    const result = await clientInstance.incentives.isClaimed(
      mockIncentivesData.contractAddress,
      mockIncentivesData.index
    );

    expect(result).toBe(false);
  });

  test('isClaimed should throw an error if helper function fails', async () => {
    jest.spyOn(incentivesHelpers, 'isClaimedFromMerkleDistributor').mockImplementation(
      async () => { throw new Error('Helper function error'); }
    );

    await expect(
      clientInstance.incentives.isClaimed(
        mockIncentivesData.contractAddress,
        mockIncentivesData.index
      )
    ).rejects.toThrow('Helper function error');
  });

  test('isClaimed should work with a client without signer', async () => {
    // Create a client without a signer
    const clientWithoutSigner = new Client({
      baseUrl: 'https://obol-api-dev.gcp.obol.tech',
      chainId: 17000
    });

    jest.spyOn(incentivesHelpers, 'isClaimedFromMerkleDistributor').mockImplementation(
      async () => await Promise.resolve(true)
    );

    const result = await clientWithoutSigner.incentives.isClaimed(
      mockIncentivesData.contractAddress,
      mockIncentivesData.index
    );

    expect(result).toBe(true);
    expect(incentivesHelpers.isClaimedFromMerkleDistributor).toHaveBeenCalledWith(
      clientWithoutSigner.incentives.chainId,
      mockIncentivesData.contractAddress,
      mockIncentivesData.index
    );
  });

  test('should return incentives for a valid address', async () => {
    const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const mockIncentives = {
      operator_address: '0x8c00157cae72c4ed6a1f8bfb60205601f0252e26',
      amount: '100',
      index: 1,
      merkle_proof: ['hash1', 'hash2'],
      contract_address: '0xContract',
    };

    clientInstance.incentives['request'] = jest
      .fn()
      .mockReturnValue(Promise.resolve(mockIncentives));

    const incentives = await clientInstance.incentives.getIncentivesByAddress(mockAddress);
    expect(incentives).toEqual(mockIncentives);
  });

  test('should throw an error if address is not found', async () => {
    const invalidAddress = '0x0000000000000000000000000000000000000000';
    clientInstance.incentives['request'] = jest
      .fn()
      .mockRejectedValue(new Error('Not found'));

    await expect(
      clientInstance.incentives.getIncentivesByAddress(invalidAddress),
    ).rejects.toThrow('Not found');
  });

  test('should throw an error if request fails', async () => {
    const mockAddress = '0x1234567890abcdef1234567890abcdef12345678';
    clientInstance.incentives['request'] = jest
      .fn()
      .mockRejectedValue(new Error('Network error'));

    await expect(
      clientInstance.incentives.getIncentivesByAddress(mockAddress),
    ).rejects.toThrow('Network error');
  });
});