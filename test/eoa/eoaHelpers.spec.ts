// @ts-nocheck
import { jest } from '@jest/globals';
import {
  submitEOAWithdrawalRequest,
  submitEOABatchDeposit,
} from '../../src/eoa/eoaHelpers';
import { TEST_ADDRESSES, mainnetDepositPayload } from '../fixtures';

const WITHDRAWAL_CONTRACT = '0x00000961Ef480Eb55e80D19ad83579A64c007002';
const PUBKEY = '0x' + '11'.repeat(48);

const makeEOASigner = (sendTransaction = jest.fn()) => ({
  provider: { getCode: jest.fn(async () => '0x') },
  getAddress: jest.fn(async () => TEST_ADDRESSES.REWARD_RECIPIENT_1),
  sendTransaction,
});

describe('submitEOAWithdrawalRequest amount encoding', () => {
  const sendAndCapture = async (allocation: number) => {
    const sendTransaction = jest.fn(async () => ({
      wait: jest.fn(async () => ({ hash: '0xhash' })),
    }));
    await submitEOAWithdrawalRequest({
      pubkey: PUBKEY,
      allocation,
      withdrawalAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
      withdrawalContractAddress: WITHDRAWAL_CONTRACT,
      requiredFee: '2',
      chainId: 1,
      signer: makeEOASigner(sendTransaction),
    });
    const tx = sendTransaction.mock.calls[0][0];
    expect(tx.value).toBe(BigInt(2));
    return BigInt('0x' + tx.data.slice(2 + 96));
  };

  it.each([
    [32, BigInt('32000000000')],
    [0, BigInt(0)],
    // 0.3 is 0.29999999999999998... as a double; multiplying by 1e9 and
    // flooring gave 299999999 gwei.
    [0.1 + 0.2, BigInt('300000000')],
    [1.000000001, BigInt('1000000001')],
  ])('encodes %p ETH as %p gwei', async (allocation, expected) => {
    await expect(sendAndCapture(allocation)).resolves.toBe(expected);
  });
});

describe('submitEOABatchDeposit errors', () => {
  it('wraps a failed batch deposit and keeps the original error as cause', async () => {
    const original = new Error('execution reverted');
    const signer = makeEOASigner(jest.fn(async () => Promise.reject(original)));

    const error = await submitEOABatchDeposit({
      deposits: [mainnetDepositPayload.deposit],
      batchDepositContractAddress: TEST_ADDRESSES.SPLIT_OWNER,
      signer,
    }).catch(e => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      'Failed to submit batch deposit: execution reverted',
    );
    expect(error.cause).toBe(original);
  });
});
