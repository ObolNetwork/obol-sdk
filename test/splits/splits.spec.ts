// @ts-nocheck
import { jest } from '@jest/globals';
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type SignerType,
  type ProviderType,
} from '../../src/types.js';
// import { CHAIN_CONFIGURATION } from '../../src/constants.js';
import { TEST_ADDRESSES } from '../fixtures.js';

// Mock splitHelpers using unstable_mockModule
// @ts-expect-error - ESM mocking requires top-level await
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
  depositOVM: jest.fn(),
}));

// Mock utils using unstable_mockModule
// @ts-expect-error - ESM mocking requires top-level await
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
// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/ajv.js', () => ({
  __esModule: true,
  VALID_DEPOSIT_AMOUNTS: [32000000000, 1000000000],
  VALID_NON_COMPOUNDING_AMOUNTS: [32000000000],
  validatePayload: jest.fn(data => data),
}));

const { Client } = await import('../../src/index.js');
const splitHelpers = await import('../../src/splits/splitHelpers.js');
const utils = await import('../../src/utils.js');

// Type the mocked functions
const mockFormatRecipientsForSplitV2 =
  splitHelpers.formatRecipientsForSplitV2 as jest.MockedFunction<
    typeof splitHelpers.formatRecipientsForSplitV2
  >;
const mockPredictSplitV2Address =
  splitHelpers.predictSplitV2Address as jest.MockedFunction<
    typeof splitHelpers.predictSplitV2Address
  >;
const mockIsSplitV2Deployed =
  splitHelpers.isSplitV2Deployed as jest.MockedFunction<
    typeof splitHelpers.isSplitV2Deployed
  >;
const mockDeployOVMAndSplitV2 =
  splitHelpers.deployOVMAndSplitV2 as jest.MockedFunction<
    typeof splitHelpers.deployOVMAndSplitV2
  >;
const mockDeployOVMContract =
  splitHelpers.deployOVMContract as jest.MockedFunction<
    typeof splitHelpers.deployOVMContract
  >;
const mockRequestWithdrawalFromOVM =
  splitHelpers.requestWithdrawalFromOVM as any;
const mockdepositOVM = splitHelpers.depositOVM as any;
const mockIsContractAvailable = utils.isContractAvailable as any;

// Global test variables
let client: Client;
let mockSigner: SignerType;
let mockProvider: ProviderType;

// Setup function to initialize variables
const setupTestVariables = () => {
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
};

describe('ObolSplits', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    setupTestVariables();
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
      ).rejects.toThrow(
        'Signer is required in createValidatorManagerAndRewardsSplit',
      );
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
      ).rejects.toThrow('createValidatorManagerAndRewardsSplit is not supported on chain 999');
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
        { address: TEST_ADDRESSES.TOTAL_RECIPIENT_2, percentAllocation: 40 },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      distributorFeePercent: 0,
    };

    it('should create total split successfully', async () => {
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
      mockPredictSplitV2Address.mockResolvedValue('0xTotalSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(false);
      mockDeployOVMAndSplitV2.mockResolvedValue('0xOVMAddress');
      mockIsContractAvailable.mockResolvedValue(true);

      const result = await client.splits.createValidatorManagerAndTotalSplit(
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
      mockPredictSplitV2Address.mockResolvedValue('0xExistingSplitAddress');
      mockIsSplitV2Deployed.mockResolvedValue(true);
      mockIsContractAvailable.mockResolvedValue(true);
      mockDeployOVMContract.mockResolvedValue('0xOVMAddress');

      const result = await client.splits.createValidatorManagerAndTotalSplit(
        mockTotalSplitPayload,
      );

      expect(result).toEqual({
        withdrawal_address: '0xOVMAddress',
        fee_recipient_address: '0xExistingSplitAddress',
      });

      expect(mockDeployOVMContract).toHaveBeenCalledWith({
        OVMOwnerAddress: mockTotalSplitPayload.OVMOwnerAddress,
        principalRecipient: '0xExistingSplitAddress',
        rewardRecipient: '0xExistingSplitAddress',
        principalThreshold: mockTotalSplitPayload.principalThreshold,
        signer: mockSigner,
        chainId: 1,
      });
    });
  });
});

describe('requestWithdrawal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupTestVariables();
  });

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
  beforeEach(() => {
    jest.clearAllMocks();
    setupTestVariables();
  });

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
    mockdepositOVM.mockResolvedValue({
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

    expect(mockdepositOVM).toHaveBeenCalledWith({
      ovmAddress: mockOVMAddress,
      deposits: singleDeposit,
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
      clientWithoutSigner.splits.deposit({
        ovmAddress: mockOVMAddress,
        deposits: singleDeposit,
      }),
    ).rejects.toThrow('Signer is required in deposit');
  });

  it('should handle multiple deposits', async () => {
    const multipleDeposits = [...singleDeposit, ...singleDeposit];
    mockdepositOVM.mockResolvedValue({
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

    expect(mockdepositOVM).toHaveBeenCalledWith({
      ovmAddress: mockOVMAddress,
      deposits: multipleDeposits,
      signer: mockSigner,
    });
  });
});

describe('constructor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupTestVariables();
  });

  it('should create Client instance with splits property', () => {
    const testClient = new Client({ chainId: 1 }, mockSigner, mockProvider);

    expect(testClient.splits).toBeDefined();
    expect(testClient.splits.chainId).toBe(1);
    expect(testClient.splits.provider).toBe(mockProvider);
  });
});
