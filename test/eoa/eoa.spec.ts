import { EOA } from '../../src/eoa/eoa';
import {
  submitEOAWithdrawalRequest,
  submitEOABatchDeposit,
} from '../../src/eoa/eoaHelpers';
import {
  type EOAWithdrawalPayload,
  type SignerType,
  type ProviderType,
} from '../../src/types';

// Mock the helper function
jest.mock('../../src/eoa/eoaHelpers', () => ({
  submitEOAWithdrawalRequest: jest.fn(),
  submitEOABatchDeposit: jest.fn(),
}));

describe('EOA', () => {
  let eoa: EOA;
  let mockSigner: SignerType;
  let mockProvider: ProviderType;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    mockSigner = {
      getAddress: jest
        .fn()
        .mockResolvedValue('0x1234567890123456789012345678901234567890'),
    } as unknown as SignerType;
    mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
    } as unknown as ProviderType;
    eoa = new EOA(mockSigner, 1, mockProvider);
  });

  describe('requestWithdrawal', () => {
    it('should successfully request withdrawal', async () => {
      const mockPayload: EOAWithdrawalPayload = {
        pubkey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        allocation: 32,
        requiredFee: '1',
      };

      const mockResult = {
        txHash:
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      };

      (
        submitEOAWithdrawalRequest as jest.MockedFunction<
          typeof submitEOAWithdrawalRequest
        >
      ).mockResolvedValue(mockResult);

      const result = await eoa.requestWithdrawal(mockPayload);

      expect(submitEOAWithdrawalRequest).toHaveBeenCalledWith({
        pubkey: mockPayload.pubkey,
        allocation: mockPayload.allocation,
        withdrawalAddress: '0x1234567890123456789012345678901234567890',
        withdrawalContractAddress: '0x00000961Ef480Eb55e80D19ad83579A64c007002',
        requiredFee: mockPayload.requiredFee,
        chainId: 1,
        signer: mockSigner,
        provider: mockProvider,
      });

      expect(result).toEqual(mockResult);
    });

    it('should throw error when signer is not provided', async () => {
      const eoaWithoutSigner = new EOA(undefined, 1, mockProvider);
      const mockPayload: EOAWithdrawalPayload = {
        pubkey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        allocation: 32,
        requiredFee: '1',
      };

      await expect(
        eoaWithoutSigner.requestWithdrawal(mockPayload),
      ).rejects.toThrow('Signer is required in requestWithdrawal');
    });

    it('should throw error when provider is not provided', async () => {
      const eoaWithoutProvider = new EOA(mockSigner, 1, null);
      const mockPayload: EOAWithdrawalPayload = {
        pubkey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        allocation: 32,
        requiredFee: '1',
      };

      await expect(
        eoaWithoutProvider.requestWithdrawal(mockPayload),
      ).rejects.toThrow('Provider is required in requestWithdrawal');
    });

    it('should throw error when EOA withdrawal contract is not configured for chain', async () => {
      const eoaUnsupportedChain = new EOA(mockSigner, 999, mockProvider);
      const mockPayload: EOAWithdrawalPayload = {
        pubkey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        allocation: 32,
        requiredFee: '1',
      };

      await expect(
        eoaUnsupportedChain.requestWithdrawal(mockPayload),
      ).rejects.toThrow(
        'EOA withdrawal contract is not configured for chain 999',
      );
    });

    it('should return null txHash when transaction receipt is null', async () => {
      const mockPayload: EOAWithdrawalPayload = {
        pubkey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        allocation: 32,
        requiredFee: '1',
      };

      const mockResult = { txHash: null };

      (
        submitEOAWithdrawalRequest as jest.MockedFunction<
          typeof submitEOAWithdrawalRequest
        >
      ).mockResolvedValue(mockResult);

      const result = await eoa.requestWithdrawal(mockPayload);

      expect(result).toEqual(mockResult);
    });
  });

  describe('deposit', () => {
    const mockDeposits = [
      {
        pubKey:
          '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
        withdrawalCredentials:
          '0x1234567890123456789012345678901234567890123456789012345678901234',
        signature:
          '0x121234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012000000000000000000',
        amount: '32000000000000000000', // 32 ETH in wei
      },
    ];

    it('should successfully deposit to batch contract', async () => {
      const mockPayload = {
        deposits: mockDeposits,
      };

      const mockResult = {
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      };

      (
        submitEOABatchDeposit as jest.MockedFunction<
          typeof submitEOABatchDeposit
        >
      ).mockResolvedValue(mockResult);

      const result = await eoa.deposit(mockPayload);

      expect(submitEOABatchDeposit).toHaveBeenCalledWith({
        deposits: mockDeposits,
        batchDepositContractAddress:
          '0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756',
        signer: mockSigner,
      });

      expect(result).toEqual(mockResult);
    });

    it('should throw error when signer is not provided', async () => {
      const eoaWithoutSigner = new EOA(undefined, 1, mockProvider);
      const mockPayload = {
        deposits: mockDeposits,
      };

      await expect(eoaWithoutSigner.deposit(mockPayload)).rejects.toThrow(
        'Signer is required in deposit',
      );
    });

    it('should throw error when batch deposit contract is not configured for chain', async () => {
      const eoaUnsupportedChain = new EOA(mockSigner, 999, mockProvider);
      const mockPayload = {
        deposits: mockDeposits,
      };

      await expect(eoaUnsupportedChain.deposit(mockPayload)).rejects.toThrow(
        'Batch deposit contract is not configured for chain 999',
      );
    });

    it('should handle multiple deposits', async () => {
      const multipleDeposits = [
        {
          pubKey:
            '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
          withdrawalCredentials:
            '0x1234567890123456789012345678901234567890123456789012345678901234',
          signature:
            '0x121234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012000000000000000000',
          amount: '32000000000000000000',
        },
        {
          pubKey:
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdcd',
          withdrawalCredentials:
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          signature:
            '0x121234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012000000000000000000',
          amount: '16000000000000000000',
        },
      ];

      const mockPayload = {
        deposits: multipleDeposits,
      };

      const mockResult = {
        txHashes: [
          '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        ],
      };

      (
        submitEOABatchDeposit as jest.MockedFunction<
          typeof submitEOABatchDeposit
        >
      ).mockResolvedValue(mockResult);

      const result = await eoa.deposit(mockPayload);

      expect(submitEOABatchDeposit).toHaveBeenCalledWith({
        deposits: multipleDeposits,
        batchDepositContractAddress:
          '0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756',
        signer: mockSigner,
      });

      expect(result).toEqual(mockResult);
    });
  });
});
