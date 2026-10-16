// @ts-nocheck
import { jest } from '@jest/globals';
import {
  type EOAWithdrawalPayload,
  type SignerType,
  type ProviderType,
} from '../../src/types.js';
import { TEST_ADDRESSES, mainnetDepositPayload } from '../fixtures.js';
// ESM-safe mocking: mock helpers before importing the module under test
// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('../../src/eoa/eoaHelpers.js', () => ({
  __esModule: true,
  submitEOAWithdrawalRequest: jest.fn(),
  submitEOABatchDeposit: jest.fn(),
}));
// @ts-expect-error - ESM dynamic import returns promise
const { EOA } = await import('../../src/eoa/eoa.js');
// @ts-expect-error - ESM dynamic import returns promise
const { submitEOAWithdrawalRequest, submitEOABatchDeposit } =
  await import('../../src/eoa/eoaHelpers.js');

// helpers are mocked via unstable_mockModule above

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
      sendTransaction: jest.fn().mockResolvedValue({
        hash: '0xhash',
        wait: jest.fn().mockResolvedValue({ status: 1 }),
      }),
    } as unknown as SignerType;
    mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
      // EIP-7002 fee read: 1 wei
      call: jest.fn().mockResolvedValue('0x' + '1'.padStart(64, '0')),
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
      ).mockResolvedValue?.(mockResult);
      (
        submitEOAWithdrawalRequest as jest.MockedFunction<
          typeof submitEOAWithdrawalRequest
        >
      ).mockResolvedValue?.(mockResult);

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
      ).rejects.toThrow('EOA requestWithdrawal is not supported on chain 999');
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
      ).mockResolvedValue?.(mockResult);
      (
        submitEOAWithdrawalRequest as jest.MockedFunction<
          typeof submitEOAWithdrawalRequest
        >
      ).mockResolvedValue?.(mockResult);

      const result = await eoa.requestWithdrawal(mockPayload);

      expect(result).toEqual(mockResult);
    });

    describe('withdrawal fee', () => {
      const pubkey = '0x' + '12'.repeat(48);
      const mockFee = (fee: bigint): void => {
        (mockProvider.call as jest.Mock).mockResolvedValue(
          '0x' + fee.toString(16).padStart(64, '0'),
        );
      };

      beforeEach(() => {
        (submitEOAWithdrawalRequest as jest.Mock).mockResolvedValue({
          txHash: '0xhash',
        });
      });

      it('reads the fee from the withdrawal request contract when omitted, without headroom (no refund)', async () => {
        mockFee(BigInt(3));

        await eoa.requestWithdrawal({ pubkey, allocation: 1 });

        expect(mockProvider.call).toHaveBeenCalledWith({
          to: '0x00000961Ef480Eb55e80D19ad83579A64c007002',
          data: '0x',
        });
        expect(submitEOAWithdrawalRequest).toHaveBeenCalledWith(
          expect.objectContaining({ requiredFee: '3' }),
        );
      });

      it('rejects a requiredFee below the current fee', async () => {
        mockFee(BigInt(5));

        await expect(
          eoa.requestWithdrawal({ pubkey, allocation: 1, requiredFee: '4' }),
        ).rejects.toThrow('below the current withdrawal request fee');
        expect(submitEOAWithdrawalRequest).not.toHaveBeenCalled();
      });

      it('rejects a requiredFee far above the current fee', async () => {
        mockFee(BigInt(1));

        await expect(
          eoa.requestWithdrawal({
            pubkey,
            allocation: 1,
            requiredFee: '1000000000000000000',
          }),
        ).rejects.toThrow('far above the current withdrawal request fee');
        expect(submitEOAWithdrawalRequest).not.toHaveBeenCalled();
      });
    });
  });

  describe('deposit', () => {
    const mockDeposits = [mainnetDepositPayload.deposit];

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
      ).mockResolvedValue?.(mockResult);
      (
        submitEOABatchDeposit as jest.MockedFunction<
          typeof submitEOABatchDeposit
        >
      ).mockResolvedValue?.(mockResult);

      const result = await eoa.deposit(mockPayload);

      expect(submitEOABatchDeposit).toHaveBeenCalledWith({
        deposits: mockDeposits,
        batchDepositContractAddress:
          '0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756',
        signer: mockSigner,
        provider: mockProvider,
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
        'EOA deposit is not supported on chain 999',
      );
    });

    it('should handle multiple deposits', async () => {
      const multipleDeposits = [
        mainnetDepositPayload.deposit,
        mainnetDepositPayload.deposit,
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
      ).mockResolvedValue?.(mockResult);
      (
        submitEOABatchDeposit as jest.MockedFunction<
          typeof submitEOABatchDeposit
        >
      ).mockResolvedValue?.(mockResult);

      const result = await eoa.deposit(mockPayload);

      expect(submitEOABatchDeposit).toHaveBeenCalledWith({
        deposits: multipleDeposits,
        batchDepositContractAddress:
          '0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756',
        signer: mockSigner,
        provider: mockProvider,
      });

      expect(result).toEqual(mockResult);
    });
    describe('deposit data checks', () => {
      const deposit = mainnetDepositPayload.deposit;

      beforeEach(() => {
        (submitEOABatchDeposit as jest.Mock).mockResolvedValue({
          txHashes: ['0xhash'],
        });
      });

      it('accepts deposits for the expected withdrawal address', async () => {
        await eoa.deposit({
          deposits: [deposit],
          expectedWithdrawalAddress: mainnetDepositPayload.withdrawalAddress,
        });
        expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);
      });

      it.each([
        [
          'wrong withdrawal credentials',
          {
            deposits: [deposit],
            expectedWithdrawalAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
          },
          'withdrawal credentials do not point at',
        ],
        [
          'a bad deposit_data_root',
          {
            deposits: [
              { ...deposit, deposit_data_root: '0x' + '22'.repeat(32) },
            ],
          },
          'deposit_data_root does not match',
        ],
        [
          'an amount below 1 ETH',
          { deposits: [{ ...deposit, amount: '100000000000000000' }] },
          'at least 1 ETH',
        ],
        [
          'an amount above 32 ETH for 0x01 credentials',
          { deposits: [{ ...deposit, amount: '64000000000000000000' }] },
          'exceeds 32 ETH',
        ],
      ])('rejects %s before sending', async (_label, payload, message) => {
        await expect(eoa.deposit(payload)).rejects.toThrow(message);
        expect(submitEOABatchDeposit).not.toHaveBeenCalled();
      });

      it('rejects a signature for another chain', async () => {
        const hoodiEoa = new EOA(mockSigner, 560048, mockProvider);
        await expect(hoodiEoa.deposit({ deposits: [deposit] })).rejects.toThrow(
          'invalid deposit signature for chain 560048',
        );
        expect(submitEOABatchDeposit).not.toHaveBeenCalled();
      });

      it('skips the signature check for top-ups when asked', async () => {
        const hoodiEoa = new EOA(mockSigner, 560048, mockProvider);
        await hoodiEoa.deposit({
          deposits: [deposit],
          kind: 'topUp',
        });
        expect(submitEOABatchDeposit).toHaveBeenCalledTimes(1);
      });
    });
  });
});
