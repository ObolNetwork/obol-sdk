// @ts-nocheck
import { jest } from '@jest/globals';
import {
  WITHDRAWAL_REQUEST_CONTRACT_ADDRESS,
  getWithdrawalRequestFee,
  resolveWithdrawalFee,
} from '../../src/withdrawalFee';

const feeWord = (fee: bigint): string =>
  '0x' + fee.toString(16).padStart(64, '0');

describe('getWithdrawalRequestFee', () => {
  it('reads the fee with an empty-calldata call to the predeploy', async () => {
    const provider = { call: jest.fn(async () => feeWord(BigInt(7))) };

    await expect(getWithdrawalRequestFee(provider)).resolves.toBe(BigInt(7));
    expect(provider.call).toHaveBeenCalledWith({
      to: WITHDRAWAL_REQUEST_CONTRACT_ADDRESS,
      data: '0x',
    });
  });

  it('throws when the call returns no data', async () => {
    const provider = { call: jest.fn(async () => '0x') };
    await expect(getWithdrawalRequestFee(provider)).rejects.toThrow(
      'Failed to read the withdrawal request fee',
    );
  });

  it('keeps the provider error as cause', async () => {
    const original = new Error('rpc down');
    const provider = { call: jest.fn(async () => Promise.reject(original)) };
    await expect(getWithdrawalRequestFee(provider)).rejects.toMatchObject({
      message: 'Failed to read the withdrawal request fee',
      cause: original,
    });
  });
});

describe('resolveWithdrawalFee', () => {
  const GWEI = BigInt(1_000_000_000);

  it('defaults to twice the current fee per request', () => {
    expect(resolveWithdrawalFee({ currentFee: BigInt(5) })).toBe(BigInt(10));
    expect(
      resolveWithdrawalFee({ currentFee: BigInt(5), requestCount: 3 }),
    ).toBe(BigInt(30));
  });

  it('accepts a caller fee between the current fee and the cap', () => {
    // Launchpad sends 100 wei while the on-chain fee is 1 wei.
    expect(
      resolveWithdrawalFee({ currentFee: BigInt(1), requestedFee: '100' }),
    ).toBe(BigInt(100));
    expect(
      resolveWithdrawalFee({
        currentFee: GWEI,
        requestedFee: (GWEI * BigInt(10)).toString(),
      }),
    ).toBe(GWEI * BigInt(10));
  });

  it('rejects a caller fee below the current fee', () => {
    expect(() =>
      resolveWithdrawalFee({ currentFee: BigInt(50), requestedFee: '49' }),
    ).toThrow('below the current withdrawal request fee of 50 wei');
    expect(() =>
      resolveWithdrawalFee({
        currentFee: BigInt(50),
        requestedFee: '99',
        requestCount: 2,
      }),
    ).toThrow('below the current withdrawal request fee of 100 wei');
  });

  it('rejects a caller fee far above the current fee', () => {
    expect(() =>
      resolveWithdrawalFee({
        currentFee: BigInt(1),
        requestedFee: (GWEI + BigInt(1)).toString(),
      }),
    ).toThrow('far above the current withdrawal request fee');
    expect(() =>
      resolveWithdrawalFee({
        currentFee: GWEI,
        requestedFee: (GWEI * BigInt(10) + BigInt(1)).toString(),
      }),
    ).toThrow('maximum accepted: 10000000000 wei');
  });
});
