// @ts-nocheck
import { jest } from '@jest/globals';

// Mock splitHelpers using unstable_mockModule
await jest.unstable_mockModule('../../src/splits/splitHelpers.js', () => ({
  __esModule: true,
  formatSplitRecipients: jest.fn(),
  predictSplitterAddress: jest.fn(),
  handleDeployOWRAndSplitter: jest.fn(),
  deploySplitterContract: jest.fn(),
  deploySplitterAndOWRContracts: jest.fn(),
  getOWRTranches: jest.fn(),
  multicall3: jest.fn(),
  formatRecipientsForSplitV2: jest.fn(),
  predictSplitV2Address: jest.fn(),
  isSplitV2Deployed: jest.fn(),
  deployOVMContract: jest.fn(),
  deployOVMAndSplitV2: jest.fn(),
  requestWithdrawalFromOVM: jest.fn(),
  depositWithMulticall3: jest.fn(),
}));

// Mock utils using unstable_mockModule
await jest.unstable_mockModule('../../src/utils.js', () => ({
  __esModule: true,
  hexWithout0x: jest.fn((hex: string) => hex.replace(/^0x/, '')),
  strToUint8Array: jest.fn((str: string) => new TextEncoder().encode(str)),
  definitionFlow: jest.fn(),
  findDeployedBytecode: jest.fn(),
  isContractAvailable: jest.fn(),
  getProvider: jest.fn(),
}));

// Mock ajv
await jest.unstable_mockModule('../../src/ajv.js', () => ({
  __esModule: true,
  VALID_DEPOSIT_AMOUNTS: [32000000000, 1000000000],
  VALID_NON_COMPOUNDING_AMOUNTS: [32000000000],
  validatePayload: jest.fn(data => data),
}));

const { Client } = await import('../../src/index.js');
const splitHelpers = await import('../../src/splits/splitHelpers.js');
const utils = await import('../../src/utils.js');
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type SignerType,
  type ProviderType,
} from '../../src/types.js';
import { CHAIN_CONFIGURATION } from '../../src/constants.js';
import { TEST_ADDRESSES } from '../fixtures';

// Type the mocked functions
const mockFormatRecipientsForSplitV2 = splitHelpers.formatRecipientsForSplitV2 as jest.MockedFunction<typeof splitHelpers.formatRecipientsForSplitV2>;
const mockPredictSplitV2Address = splitHelpers.predictSplitV2Address as jest.MockedFunction<typeof splitHelpers.predictSplitV2Address>;
const mockIsSplitV2Deployed = splitHelpers.isSplitV2Deployed as jest.MockedFunction<typeof splitHelpers.isSplitV2Deployed>;
const mockDeployOVMAndSplitV2 = splitHelpers.deployOVMAndSplitV2 as jest.MockedFunction<typeof splitHelpers.deployOVMAndSplitV2>;
const mockDeployOVMContract = splitHelpers.deployOVMContract as jest.MockedFunction<typeof splitHelpers.deployOVMContract>;
const mockRequestWithdrawalFromOVM = splitHelpers.requestWithdrawalFromOVM as any;
const mockdepositWithMulticall3 = splitHelpers.depositWithMulticall3 as any;
const mockIsContractAvailable = utils.isContractAvailable as any;

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

      // formatRecipientsForSplitV2 is called with the recipients plus retroactive funding
      expect(mockFormatRecipientsForSplitV2).toHaveBeenCalled();
      expect(mockPredictSplitV2Address).toHaveBeenCalled();
      expect(mockIsSplitV2Deployed).toHaveBeenCalledWith(
        expect.objectContaining({
          splitOwnerAddress: mockRewardsSplitPayload.splitOwnerAddress,
          recipients: expect.any(Array),
          chainId: 1,
        }),
      );
      expect(mockDeployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should handle when split is already deployed', async () => {
      mockFormatRecipientsForSplitV2.mockReturnValue([
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
        {
          address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
          percentAllocation: 1,
        },
      ]);
      mockPredictSplitV2Address.mockResolvedValue('0xExistingSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(true);
      mockIsContractAvailable.mockResolvedValue(true);
      mockDeployOVMContract.mockResolvedValue('0xOVMAddress');

      const result = await client.splits.createValidatorManagerAndRewardsSplit(
        mockRewardsSplitPayload,
      );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xExistingSplitAddress',
      });
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
      ).rejects.toThrow('Signer is required in createValidatorManagerAndRewardsSplit');
    });

    it('should throw error when unsupported chainId', async () => {
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
  });

  describe('createValidatorManagerAndTotalSplit', () => {
    const mockTotalSplitPayload: OVMTotalSplitPayload = {
      rewardSplitRecipients: [
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
      ],
      principalSplitRecipients: [
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_1, percentAllocation: 60 },
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_2, percentAllocation: 39 },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      distributorFeePercent: 0,
    };

    it('should create total split successfully', async () => {
      mockFormatRecipientsForSplitV2.mockReturnValue([
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_1, percentAllocation: 60 },
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_2, percentAllocation: 39 },
        {
          address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
          percentAllocation: 1,
        },
      ]);
      mockPredictSplitV2Address.mockResolvedValue('0xTotalSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(false);
      mockDeployOVMAndSplitV2.mockResolvedValue('0xOVMAddress');
      mockIsContractAvailable.mockResolvedValue(true);

      const result =
        await client.splits.createValidatorManagerAndTotalSplit(
          mockTotalSplitPayload,
        );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xTotalSplitAddress',
      });

      // formatRecipientsForSplitV2 is called twice: once with retroactive funding, once without
      expect(mockFormatRecipientsForSplitV2).toHaveBeenCalled();
      expect(mockPredictSplitV2Address).toHaveBeenCalled();
      expect(mockIsSplitV2Deployed).toHaveBeenCalledWith(
        expect.objectContaining({
          splitOwnerAddress: mockTotalSplitPayload.splitOwnerAddress,
          recipients: expect.any(Array),
          chainId: 1,
        }),
      );
      expect(mockDeployOVMAndSplitV2).toHaveBeenCalled();
    });

    it('should handle when split is already deployed', async () => {
      mockFormatRecipientsForSplitV2.mockReturnValue([
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_1, percentAllocation: 60 },
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_2, percentAllocation: 39 },
        {
          address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
          percentAllocation: 1,
        },
      ]);
      mockPredictSplitV2Address.mockResolvedValue('0xExistingSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(true);
      mockIsContractAvailable.mockResolvedValue(true);
      mockDeployOVMContract.mockResolvedValue('0xOVMAddress');

      const result = await client.splits.createValidatorManagerAndTotalSplit(mockTotalSplitPayload);

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xExistingSplitAddress',
      });
    });
  });

  describe('requestWithdrawal', () => {
    const mockOVMAddress = '0xOVMAddress123';
    const mockPubKeys = ['0xPubKey1', '0xPubKey2'];
    const mockAmounts = ['1000000000', '2000000000'];
    const mockWithdrawalFees = '100000000';

    it('should request withdrawal successfully', async () => {
      mockRequestWithdrawalFromOVM.mockResolvedValue({
        txHash: '0xtransactionHash123',
      });

      const result = await client.splits.requestWithdrawal({
        ovmAddress: mockOVMAddress,
        pubKeys: mockPubKeys,
        amounts: mockAmounts,
        withdrawalFees: mockWithdrawalFees,
      });

      expect(result).toEqual({
        txHash: '0xtransactionHash123',
      });

      expect(mockRequestWithdrawalFromOVM).toHaveBeenCalledWith({
        ovmAddress: mockOVMAddress,
        pubKeys: mockPubKeys,
        amounts: mockAmounts,
        withdrawalFees: mockWithdrawalFees,
        signer: mockSigner,
      });
    });

    it('should throw error when signer is not provided', async () => {
      const clientWithoutSigner = new Client(
        { chainId: 1 },
        undefined,
        mockProvider,
      );

      await expect(
        clientWithoutSigner.splits.requestWithdrawal({
          ovmAddress: mockOVMAddress,
          pubKeys: mockPubKeys,
          amounts: mockAmounts,
          withdrawalFees: mockWithdrawalFees,
        }),
      ).rejects.toThrow('Signer is required in requestWithdrawal');
    });
  });

  describe('deposit', () => {
    const mockOVMAddress = '0xOVMAddress123';
    const singleDeposit = [
      {
        pubkey:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        signature:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        deposit_data_root:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        amount: 32000000000,
        withdrawal_credentials:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    ];

    it('should deposit successfully', async () => {
      mockdepositWithMulticall3.mockResolvedValue({
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      });

      const result = await client.splits.deposit({
        ovmAddress: mockOVMAddress,
        deposits: singleDeposit,
      });

      expect(result).toEqual({
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      });

      expect(mockdepositWithMulticall3).toHaveBeenCalledWith({
        ovmAddress: mockOVMAddress,
        deposits: singleDeposit,
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
        clientWithoutSigner.splits.deposit({
          ovmAddress: mockOVMAddress,
          deposits: singleDeposit,
        }),
      ).rejects.toThrow('Signer is required in deposit');
    });

    it('should handle multiple deposits', async () => {
      const multipleDeposits = [...singleDeposit, ...singleDeposit];
      mockdepositWithMulticall3.mockResolvedValue({
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      });

      const result = await client.splits.deposit({
        ovmAddress: mockOVMAddress,
        deposits: multipleDeposits,
      });

      expect(result).toEqual({
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      });

      expect(mockdepositWithMulticall3).toHaveBeenCalledWith({
        ovmAddress: mockOVMAddress,
        deposits: multipleDeposits,
        signer: mockSigner,
        chainId: 1,
      });
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