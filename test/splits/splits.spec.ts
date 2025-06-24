import { Client } from '../../src';
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type SignerType,
  type ProviderType,
} from '../../src/types';
import { CHAIN_CONFIGURATION } from '../../src/constants';
import {
  formatRecipientsForSplitV2,
  predictSplitV2Address,
  isSplitV2Deployed,
  deployOVMAndSplitV2,
  deployOVMContract,
} from '../../src/splits/splitHelpers';
import { isContractAvailable } from '../../src/utils';
import { TEST_ADDRESSES } from '../fixtures';

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
  validatePayload: jest.fn(data => data),
}));

// Type the mocked functions
const mockFormatRecipientsForSplitV2 =
  formatRecipientsForSplitV2 as jest.MockedFunction<
    typeof formatRecipientsForSplitV2
  >;
const mockPredictSplitV2Address = predictSplitV2Address as jest.MockedFunction<
  typeof predictSplitV2Address
>;
const mockIsSplitV2Deployed = isSplitV2Deployed as jest.MockedFunction<
  typeof isSplitV2Deployed
>;
const mockDeployOVMAndSplitV2 = deployOVMAndSplitV2 as jest.MockedFunction<
  typeof deployOVMAndSplitV2
>;
const mockDeployOVMContract = deployOVMContract as jest.MockedFunction<
  typeof deployOVMContract
>;
const mockIsContractAvailable = isContractAvailable as jest.MockedFunction<
  typeof isContractAvailable
>;

describe('ObolSplits', () => {
  let client: Client;
  let mockSigner: SignerType;
  let mockProvider: ProviderType;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    mockSigner = {
      getAddress: jest
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890'),
      signTypedData: jest.fn().mockResolvedValue('0xsigned'),
      provider: {
        getCode: jest.fn().mockResolvedValue('0x123456'),
      },
    } as unknown as SignerType;

    mockProvider = {
      getCode: jest.fn().mockResolvedValue('0x123456'),
    } as unknown as ProviderType;

    client = new Client({ chainId: 1 }, mockSigner, mockProvider);
  });

  describe('createValidatorManagerAndRewardsSplit', () => {
    const mockRewardsSplitPayload: OVMRewardsSplitPayload = {
      rewardSplitRecipients: [
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      distributorFeePercent: 0,
    };

    it('should create rewards-only split successfully', async () => {
      // Mock helper functions
      mockFormatRecipientsForSplitV2.mockReturnValue([
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
        {
          address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
          percentAllocation: 1,
        },
      ]);
      mockPredictSplitV2Address.mockResolvedValue('0xRewardsSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(false);
      mockDeployOVMAndSplitV2.mockResolvedValue('0xOVMAddress');
      mockIsContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createValidatorManagerAndRewardsSplit(
        mockRewardsSplitPayload,
      );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(mockFormatRecipientsForSplitV2).toHaveBeenCalled();
      expect(mockPredictSplitV2Address).toHaveBeenCalled();
      expect(mockIsSplitV2Deployed).toHaveBeenCalled();
      expect(mockDeployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should throw error when signer is not provided', async () => {
      const clientWithoutSigner = new Client(
        { chainId: 1 },
        undefined,
        mockProvider,
      );

      await expect(
        clientWithoutSigner.splits.createValidatorManagerAndRewardsSplit(
          mockRewardsSplitPayload,
        ),
      ).rejects.toThrow(
        'Signer is required in createValidatorManagerAndRewardsSplit',
      );
    });

    it('should throw error when chain is not supported', async () => {
      const clientUnsupportedChain = new Client(
        { chainId: 999 },
        mockSigner,
        mockProvider,
      );

      await expect(
        clientUnsupportedChain.splits.createValidatorManagerAndRewardsSplit(
          mockRewardsSplitPayload,
        ),
      ).rejects.toThrow('Splitter configuration is not supported on 999 chain');
    });

    it('should throw error when OVM factory is not configured', async () => {
      // Mock chain configuration without OVM factory
      const originalConfig = CHAIN_CONFIGURATION[1];
      // Create a new config object without OVM_FACTORY_ADDRESS
      const configWithoutOVM = { ...originalConfig };
      delete configWithoutOVM.OVM_FACTORY_ADDRESS;
      CHAIN_CONFIGURATION[1] = configWithoutOVM;

      await expect(
        client.splits.createValidatorManagerAndRewardsSplit(
          mockRewardsSplitPayload,
        ),
      ).rejects.toThrow('OVM contract factory is not configured for chain 1');

      // Restore original config
      CHAIN_CONFIGURATION[1] = originalConfig;
    });
  });

  describe('createValidatorManagerAndTotalSplit', () => {
    const mockTotalSplitPayload: OVMTotalSplitPayload = {
      rewardSplitRecipients: [
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
      ],
      principalSplitRecipients: [
        {
          address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
          percentAllocation: 60,
        },
        {
          address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
          percentAllocation: 40,
        },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      distributorFeePercent: 0,
    };

    it('should create total split successfully', async () => {
      // Mock helper functions
      mockFormatRecipientsForSplitV2
        .mockReturnValueOnce([
          // rewards recipients
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
          {
            address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
            percentAllocation: 1,
          },
        ])
        .mockReturnValueOnce([
          // principal recipients
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 60,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 40,
          },
        ]);

      mockPredictSplitV2Address
        .mockResolvedValueOnce('0xRewardsSplitAddress')
        .mockResolvedValueOnce('0xPrincipalSplitAddress');

      mockIsSplitV2Deployed
        .mockResolvedValueOnce(false) // rewards split not deployed
        .mockResolvedValueOnce(false); // principal split not deployed

      mockDeployOVMAndSplitV2.mockResolvedValue('0xOVMAddress');
      mockIsContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createValidatorManagerAndTotalSplit(
        mockTotalSplitPayload,
      );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(mockFormatRecipientsForSplitV2).toHaveBeenCalledTimes(2);
      expect(mockPredictSplitV2Address).toHaveBeenCalledTimes(2);
      expect(mockIsSplitV2Deployed).toHaveBeenCalledTimes(2);
      expect(mockDeployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should handle case when both splits are already deployed', async () => {
      // Mock helper functions
      mockFormatRecipientsForSplitV2
        .mockReturnValueOnce([
          // rewards recipients
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
          {
            address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
            percentAllocation: 1,
          },
        ])
        .mockReturnValueOnce([
          // principal recipients
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 60,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 40,
          },
        ]);

      mockPredictSplitV2Address
        .mockResolvedValueOnce('0xRewardsSplitAddress')
        .mockResolvedValueOnce('0xPrincipalSplitAddress');

      mockIsSplitV2Deployed
        .mockResolvedValueOnce(true) // rewards split deployed
        .mockResolvedValueOnce(true); // principal split deployed

      mockDeployOVMContract.mockResolvedValue('0xOVMAddress');
      mockIsContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createValidatorManagerAndTotalSplit(
        mockTotalSplitPayload,
      );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xRewardsSplitAddress',
      });

      expect(mockDeployOVMContract).toHaveBeenCalledWith({
        OVMOwnerAddress: mockTotalSplitPayload.OVMOwnerAddress,
        principalRecipient: '0xPrincipalSplitAddress',
        rewardRecipient: '0xRewardsSplitAddress',
        principalThreshold: mockTotalSplitPayload.principalThreshold,
        signer: mockSigner,
        chainId: 1,
      });
    });

    it('should throw error when signer is not provided', async () => {
      const clientWithoutSigner = new Client(
        { chainId: 1 },
        undefined,
        mockProvider,
      );

      await expect(
        clientWithoutSigner.splits.createValidatorManagerAndTotalSplit(
          mockTotalSplitPayload,
        ),
      ).rejects.toThrow(
        'Signer is required in createValidatorManagerAndTotalSplit',
      );
    });

    it('should throw error when chain is not supported', async () => {
      const clientUnsupportedChain = new Client(
        { chainId: 999 },
        mockSigner,
        mockProvider,
      );

      await expect(
        clientUnsupportedChain.splits.createValidatorManagerAndTotalSplit(
          mockTotalSplitPayload,
        ),
      ).rejects.toThrow('Splitter configuration is not supported on 999 chain');
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
