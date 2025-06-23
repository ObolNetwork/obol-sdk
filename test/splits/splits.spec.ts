import { Client } from '../../src';
import { OVMRewardsSplitPayload, OVMTotalSplitPayload } from '../../src/types';
import { CHAIN_CONFIGURATION } from '../../src/constants';

// Mock the split helpers
jest.mock('../../src/splits/splitHelpers', () => ({
  formatRecipientsForSplitV2: jest.fn(),
  predictSplitV2Address: jest.fn(),
  isSplitV2Deployed: jest.fn(),
  deployOVMContract: jest.fn(),
  deployOVMAndSplitV2: jest.fn(),
}));

// Mock the utils
jest.mock('../../src/utils', () => ({
  isContractAvailable: jest.fn(),
}));

// Mock the validation
jest.mock('../../src/ajv', () => ({
  validatePayload: jest.fn((data) => data),
}));

describe('ObolSplits', () => {
  let client: Client;
  let mockSigner: any;
  let mockProvider: any;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    mockSigner = {
      provider: {
        getCode: jest.fn().mockResolvedValue('0x123456'),
      },
    };

    mockProvider = {
      getCode: jest.fn().mockResolvedValue('0x123456'),
    };

    client = new Client({ chainId: 1 }, mockSigner, mockProvider);
  });

  describe('createObolOVMAndPullSplit', () => {
    const mockRewardsSplitPayload: OVMRewardsSplitPayload = {
      rewardSplitRecipients: [
        { address: '0x1234567890123456789012345678901234567890', percentAllocation: 50 },
        { address: '0x2345678901234567890123456789012345678901', percentAllocation: 30 },
      ],
      ownerAddress: '0x3456789012345678901234567890123456789012',
      principalRecipient: '0x4567890123456789012345678901234567890123',
      distributorFeePercent: 0,
    };

    it('should create rewards-only split successfully', async () => {
      const { formatRecipientsForSplitV2, predictSplitV2Address, isSplitV2Deployed, deployOVMAndSplitV2 } = require('../../src/splits/splitHelpers');
      const { isContractAvailable } = require('../../src/utils');

      // Mock helper functions
      formatRecipientsForSplitV2.mockReturnValue([
        { address: '0x1234567890123456789012345678901234567890', percentAllocation: 50 },
        { address: '0x2345678901234567890123456789012345678901', percentAllocation: 30 },
        { address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d', percentAllocation: 1 },
      ]);
      predictSplitV2Address.mockResolvedValue('0xRewardsSplitAddress');
      isSplitV2Deployed.mockResolvedValue(false);
      deployOVMAndSplitV2.mockResolvedValue({
        ovmAddress: '0xOVMAddress',
        splitAddress: '0xRewardsSplitAddress',
      });
      isContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createObolOVMAndRewardPullSplit(mockRewardsSplitPayload);

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(formatRecipientsForSplitV2).toHaveBeenCalled();
      expect(predictSplitV2Address).toHaveBeenCalled();
      expect(isSplitV2Deployed).toHaveBeenCalled();
      expect(deployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should throw error when signer is not provided', async () => {
      const clientWithoutSigner = new Client({ chainId: 1 }, undefined, mockProvider);

      await expect(clientWithoutSigner.splits.createObolOVMAndRewardPullSplit(mockRewardsSplitPayload))
        .rejects.toThrow('Signer is required in createObolOVMAndRewardPullSplit');
    });

    it('should throw error when chain is not supported', async () => {
      const clientUnsupportedChain = new Client({ chainId: 999 }, mockSigner, mockProvider);

      await expect(clientUnsupportedChain.splits.createObolOVMAndRewardPullSplit(mockRewardsSplitPayload))
        .rejects.toThrow('Splitter configuration is not supported on 999 chain');
    });

    it('should throw error when OVM factory is not configured', async () => {
      // Mock chain configuration without OVM factory
      const originalConfig = CHAIN_CONFIGURATION[1];
      // Create a new config object without OVM_FACTORY_ADDRESS
      const configWithoutOVM = { ...originalConfig };
      delete (configWithoutOVM as any).OVM_FACTORY_ADDRESS;
      CHAIN_CONFIGURATION[1] = configWithoutOVM;

      await expect(client.splits.createObolOVMAndRewardPullSplit(mockRewardsSplitPayload))
        .rejects.toThrow('OVM contract factory is not configured for chain 1');

      // Restore original config
      CHAIN_CONFIGURATION[1] = originalConfig;
    });
  });

  describe('createObolOVMAndTotalPullSplit', () => {
    const mockTotalSplitPayload: OVMTotalSplitPayload = {
      rewardSplitRecipients: [
        { address: '0x1234567890123456789012345678901234567890', percentAllocation: 50 },
        { address: '0x2345678901234567890123456789012345678901', percentAllocation: 30 },
      ],
      principalSplitRecipients: [
        { address: '0x3456789012345678901234567890123456789012', percentAllocation: 60 },
        { address: '0x4567890123456789012345678901234567890123', percentAllocation: 40 },
      ],
      ownerAddress: '0x5678901234567890123456789012345678901234',
      distributorFeePercent: 0,
    };

    it('should create total split successfully', async () => {
      const { formatRecipientsForSplitV2, predictSplitV2Address, isSplitV2Deployed, deployOVMContract, deployOVMAndSplitV2 } = require('../../src/splits/splitHelpers');
      const { isContractAvailable } = require('../../src/utils');

      // Mock helper functions
      formatRecipientsForSplitV2
        .mockReturnValueOnce([ // rewards recipients
          { address: '0x1234567890123456789012345678901234567890', percentAllocation: 50 },
          { address: '0x2345678901234567890123456789012345678901', percentAllocation: 30 },
          { address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d', percentAllocation: 1 },
        ])
        .mockReturnValueOnce([ // principal recipients
          { address: '0x3456789012345678901234567890123456789012', percentAllocation: 60 },
          { address: '0x4567890123456789012345678901234567890123', percentAllocation: 40 },
        ]);

      predictSplitV2Address
        .mockResolvedValueOnce('0xRewardsSplitAddress')
        .mockResolvedValueOnce('0xPrincipalSplitAddress');

      isSplitV2Deployed
        .mockResolvedValueOnce(false) // rewards split not deployed
        .mockResolvedValueOnce(false); // principal split not deployed

      deployOVMAndSplitV2.mockResolvedValue({
        ovmAddress: '0xOVMAddress',
        splitAddress: '0xRewardsSplitAddress',
      });
      isContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createObolOVMAndTotalPullSplit(mockTotalSplitPayload);

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(formatRecipientsForSplitV2).toHaveBeenCalledTimes(2);
      expect(predictSplitV2Address).toHaveBeenCalledTimes(2);
      expect(isSplitV2Deployed).toHaveBeenCalledTimes(2);
      expect(deployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should handle case when both splits are already deployed', async () => {
      const { formatRecipientsForSplitV2, predictSplitV2Address, isSplitV2Deployed, deployOVMContract, deployOVMAndSplitV2 } = require('../../src/splits/splitHelpers');
      const { isContractAvailable } = require('../../src/utils');

      // Mock helper functions
      formatRecipientsForSplitV2
        .mockReturnValueOnce([ // rewards recipients
          { address: '0x1234567890123456789012345678901234567890', percentAllocation: 50 },
          { address: '0x2345678901234567890123456789012345678901', percentAllocation: 30 },
          { address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d', percentAllocation: 1 },
        ])
        .mockReturnValueOnce([ // principal recipients
          { address: '0x3456789012345678901234567890123456789012', percentAllocation: 60 },
          { address: '0x4567890123456789012345678901234567890123', percentAllocation: 40 },
        ]);

      predictSplitV2Address
        .mockResolvedValueOnce('0xRewardsSplitAddress')
        .mockResolvedValueOnce('0xPrincipalSplitAddress');

      isSplitV2Deployed
        .mockResolvedValueOnce(true) // rewards split deployed
        .mockResolvedValueOnce(true); // principal split deployed

      deployOVMContract.mockResolvedValue('0xOVMAddress');
      isContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createObolOVMAndTotalPullSplit(mockTotalSplitPayload);

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(deployOVMContract).toHaveBeenCalledWith({
        ownerAddress: mockTotalSplitPayload.ownerAddress,
        principalRecipient: '0xPrincipalSplitAddress',
        rewardRecipient: '0xRewardsSplitAddress',
        principalThreshold: mockTotalSplitPayload.principalThreshold,
        signer: mockSigner,
        chainId: 1,
      });
    });

    it('should throw error when signer is not provided', async () => {
      const clientWithoutSigner = new Client({ chainId: 1 }, undefined, mockProvider);

      await expect(clientWithoutSigner.splits.createObolOVMAndTotalPullSplit(mockTotalSplitPayload))
        .rejects.toThrow('Signer is required in createObolOVMAndTotalPullSplit');
    });

    it('should throw error when chain is not supported', async () => {
      const clientUnsupportedChain = new Client({ chainId: 999 }, mockSigner, mockProvider);

      await expect(clientUnsupportedChain.splits.createObolOVMAndTotalPullSplit(mockTotalSplitPayload))
        .rejects.toThrow('Splitter configuration is not supported on 999 chain');
    });
  });

  describe('constructor', () => {
    it('should create Client instance with splits property', () => {
      const testClient = new Client({ chainId: 1 }, mockSigner, mockProvider);

      expect(testClient.splits).toBeDefined();
      expect(testClient.splits.chainId).toBe(1);
      expect(testClient.splits.provider).toBe(mockProvider);
    });
  });
}); 