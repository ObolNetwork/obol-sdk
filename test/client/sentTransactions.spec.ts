// @ts-nocheck
import { jest } from '@jest/globals';
import { TEST_ADDRESSES, mainnetDepositPayload } from '../fixtures.js';

// The write helpers build their contracts with `new Contract(...)`; replace it
// with an object whose methods each test controls.
const contract: Record<string, any> = {};
const actualEthers = await import('ethers');
// @ts-expect-error - ESM mocking requires top-level await
await jest.unstable_mockModule('ethers', () => ({
  ...actualEthers,
  Contract: jest.fn(() => contract),
}));

const { SentTransactions } = await import('../../src/sentTransactions.js');
const { TransactionSubmissionError } = await import('../../src/errors.js');
const { depositOVM, requestWithdrawalFromOVM } =
  await import('../../src/splits/splitHelpers.js');
const { submitEOABatchDeposit, submitEOAWithdrawalRequest } =
  await import('../../src/eoa/eoaHelpers.js');
const { claimIncentivesFromMerkleDistributor } =
  await import('../../src/incentives/incentiveHelpers.js');
const { OVMContract } = await import('../../src/abi/OVM.js');

const hash = (n: number): string => '0x' + n.toString(16).padStart(64, '0');
const OVM = TEST_ADDRESSES.REWARD_RECIPIENT_1;
const PUBKEY = '0x' + '11'.repeat(48);

/** A sent transaction whose receipt resolves, or whose wait() rejects. */
const sentTx = (n: number, waitError?: Error) => ({
  hash: hash(n),
  wait: jest.fn(async () => {
    if (waitError) throw waitError;
    return { hash: hash(n) };
  }),
});

const eoaSigner = (sendTransaction = jest.fn()) => ({
  provider: { getCode: jest.fn(async () => '0x') },
  getAddress: jest.fn(async () => TEST_ADDRESSES.REWARD_RECIPIENT_1),
  sendTransaction,
});

beforeEach(() => {
  for (const key of Object.keys(contract)) delete contract[key];
});

describe('SentTransactions', () => {
  it('reports each sent hash with its index and ignores callback errors', () => {
    const onSent = jest.fn(() => {
      throw new Error('ui error');
    });
    const sent = new SentTransactions({ onSent });

    sent.sent(hash(1));
    sent.mined(hash(1));
    sent.sent(hash(2));

    expect(onSent).toHaveBeenNthCalledWith(1, {
      hash: hash(1),
      index: 0,
      contractWallet: false,
    });
    expect(onSent).toHaveBeenNthCalledWith(2, {
      hash: hash(2),
      index: 1,
      contractWallet: false,
    });
    const error = sent.failure('failed', new Error('cause'), new Error('x'));
    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.txHashes).toEqual([hash(1)]);
    expect(error.pendingTxHash).toBe(hash(2));
    expect(error.code).toBe('TX_FAILED_AFTER_SEND');
  });

  it('returns the fallback when nothing was sent', () => {
    const fallback = new Error('before send');
    const sent = new SentTransactions(undefined);
    expect(sent.failure('failed', fallback, fallback)).toBe(fallback);
  });
});

describe('depositOVM', () => {
  const deposits = [1, 2, 3].map(() => mainnetDepositPayload.deposit);

  it('reports every hash and returns them in order', async () => {
    let n = 0;
    contract.deposit = jest.fn(async () => sentTx(++n));
    const onSent = jest.fn();

    const result = await depositOVM({
      ovmAddress: OVM,
      deposits,
      signer: eoaSigner(),
      options: { onSent },
    });

    expect(result).toEqual({ txHashes: [hash(1), hash(2), hash(3)] });
    expect(onSent).toHaveBeenCalledTimes(3);
  });

  it('keeps earlier hashes and the pending one when a receipt fails mid-loop', async () => {
    const cause = new Error('wait timeout');
    let n = 0;
    contract.deposit = jest.fn(async () => {
      n += 1;
      return sentTx(n, n === 2 ? cause : undefined);
    });

    const error = await depositOVM({
      ovmAddress: OVM,
      deposits,
      signer: eoaSigner(),
    }).catch(e => e);

    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.message).toBe('Failed to deposit to OVM: wait timeout');
    expect(error.txHashes).toEqual([hash(1)]);
    expect(error.pendingTxHash).toBe(hash(2));
    expect(error.cause).toBe(cause);
    expect(contract.deposit).toHaveBeenCalledTimes(2);
  });

  it('reports a later broadcast failure with the mined hashes and no pending one', async () => {
    let n = 0;
    contract.deposit = jest.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('user rejected');
      return sentTx(n);
    });

    const error = await depositOVM({
      ovmAddress: OVM,
      deposits,
      signer: eoaSigner(),
    }).catch(e => e);

    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.txHashes).toEqual([hash(1)]);
    expect(error.pendingTxHash).toBeUndefined();
  });

  it('throws the usual error when nothing was sent', async () => {
    contract.deposit = jest.fn(async () => {
      throw new Error('user rejected');
    });

    const error = await depositOVM({
      ovmAddress: OVM,
      deposits,
      signer: eoaSigner(),
    }).catch(e => e);

    expect(error).not.toBeInstanceOf(TransactionSubmissionError);
    expect(error.message).toBe('Failed to deposit to OVM: user rejected');
  });
});

describe('requestWithdrawalFromOVM', () => {
  it('passes excessFeeRecipient to the OVM and reports the hash', async () => {
    contract.withdraw = jest.fn(async () => sentTx(7));
    const onSent = jest.fn();

    const result = await requestWithdrawalFromOVM({
      ovmAddress: OVM,
      pubKeys: [PUBKEY],
      amounts: ['32000000000'],
      withdrawalFees: '2',
      excessFeeRecipient: TEST_ADDRESSES.SPLIT_OWNER,
      signer: eoaSigner(),
      options: { onSent },
    });

    expect(result).toEqual({ txHash: hash(7) });
    expect(contract.withdraw).toHaveBeenCalledWith(
      [PUBKEY],
      [BigInt('32000000000')],
      BigInt(2),
      TEST_ADDRESSES.SPLIT_OWNER,
      { value: BigInt(2) },
    );
    expect(onSent).toHaveBeenCalledWith(
      expect.objectContaining({ hash: hash(7), index: 0 }),
    );
  });

  it('carries the pending hash when the receipt fails', async () => {
    contract.withdraw = jest.fn(async () => sentTx(7, new Error('reverted')));

    const error = await requestWithdrawalFromOVM({
      ovmAddress: OVM,
      pubKeys: [PUBKEY],
      amounts: ['32000000000'],
      withdrawalFees: '2',
      excessFeeRecipient: TEST_ADDRESSES.SPLIT_OWNER,
      signer: eoaSigner(),
    }).catch(e => e);

    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.message).toBe(
      'Failed to request withdrawal from OVM: reverted',
    );
    expect(error.pendingTxHash).toBe(hash(7));
  });
});

describe('EOA helpers', () => {
  it('submitEOABatchDeposit carries the pending hash when the receipt fails', async () => {
    contract.batchDeposit = jest.fn(async () =>
      sentTx(3, new Error('dropped')),
    );
    const onSent = jest.fn();

    const error = await submitEOABatchDeposit({
      deposits: [mainnetDepositPayload.deposit],
      batchDepositContractAddress: TEST_ADDRESSES.SPLIT_OWNER,
      signer: eoaSigner(),
      options: { onSent },
    }).catch(e => e);

    expect(onSent).toHaveBeenCalledWith({
      hash: hash(3),
      index: 0,
      contractWallet: false,
    });
    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.message).toBe('Failed to submit batch deposit: dropped');
    expect(error.pendingTxHash).toBe(hash(3));
  });

  it('submitEOAWithdrawalRequest carries the pending hash when the receipt fails', async () => {
    const signer = eoaSigner(jest.fn(async () => sentTx(4, new Error('lost'))));
    const onSent = jest.fn();

    const error = await submitEOAWithdrawalRequest({
      pubkey: PUBKEY,
      allocation: 1,
      withdrawalAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
      withdrawalContractAddress: TEST_ADDRESSES.SPLIT_OWNER,
      requiredFee: '2',
      chainId: 1,
      signer,
      options: { onSent },
    }).catch(e => e);

    expect(onSent).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.pendingTxHash).toBe(hash(4));
  });

  it('submitEOAWithdrawalRequest rethrows errors before sending unchanged', async () => {
    const original = new Error('user rejected');
    const signer = eoaSigner(jest.fn(async () => Promise.reject(original)));

    const error = await submitEOAWithdrawalRequest({
      pubkey: PUBKEY,
      allocation: 1,
      withdrawalAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
      withdrawalContractAddress: TEST_ADDRESSES.SPLIT_OWNER,
      requiredFee: '2',
      chainId: 1,
      signer,
    }).catch(e => e);

    expect(error).toBe(original);
  });
});

describe('claimIncentivesFromMerkleDistributor', () => {
  it('reports the hash and carries it when the receipt fails', async () => {
    contract.claim = jest.fn(async () => sentTx(5, new Error('timeout')));
    const onSent = jest.fn();

    const error = await claimIncentivesFromMerkleDistributor({
      signer: eoaSigner(),
      contractAddress: TEST_ADDRESSES.SPLIT_OWNER,
      index: 0,
      operatorAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
      amount: '1',
      merkleProof: [],
      options: { onSent },
    }).catch(e => e);

    expect(onSent).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(TransactionSubmissionError);
    expect(error.message).toBe('Failed to claim incentives: timeout');
    expect(error.pendingTxHash).toBe(hash(5));
  });
});

describe('pendingStatus', () => {
  it('is reverted for a mined revert and unconfirmed otherwise', async () => {
    const revert = Object.assign(new Error('execution reverted'), {
      code: 'CALL_EXCEPTION',
      receipt: { status: 0, hash: hash(8) },
    });
    contract.withdraw = jest.fn(async () => sentTx(8, revert));

    const reverted = await requestWithdrawalFromOVM({
      ovmAddress: OVM,
      pubKeys: [PUBKEY],
      amounts: ['1'],
      withdrawalFees: '2',
      excessFeeRecipient: TEST_ADDRESSES.SPLIT_OWNER,
      signer: eoaSigner(),
    }).catch(e => e);
    expect(reverted.pendingStatus).toBe('reverted');

    contract.withdraw = jest.fn(async () => sentTx(9, new Error('timeout')));
    const unconfirmed = await requestWithdrawalFromOVM({
      ovmAddress: OVM,
      pubKeys: [PUBKEY],
      amounts: ['1'],
      withdrawalFees: '2',
      excessFeeRecipient: TEST_ADDRESSES.SPLIT_OWNER,
      signer: eoaSigner(),
    }).catch(e => e);
    expect(unconfirmed.pendingStatus).toBe('unconfirmed');
  });
});

describe('OVM writes from a contract wallet (Safe)', () => {
  const SAFE = '0xAbCdEf0123456789012345678901234567890AbC';
  const SAFE_TX_HASH = '0x' + 'aa'.repeat(32);
  const EXECUTED = '0x' + 'ee'.repeat(32);
  const SUCCESS_TOPIC = actualEthers.id('ExecutionSuccess(bytes32,uint256)');

  const safeSigner = () => {
    const provider = {
      getBlockNumber: jest.fn(async () => 100),
      getCode: jest.fn(async () => '0xabcdef'),
      estimateGas: jest.fn(async () => 21000n),
      getLogs: jest.fn(async () => [
        {
          address: SAFE,
          transactionHash: EXECUTED,
          topics: [SUCCESS_TOPIC, SAFE_TX_HASH],
          data: '0x',
        },
      ]),
      on: jest.fn(async () => {}),
      off: jest.fn(async () => {}),
    };
    return {
      provider,
      getAddress: jest.fn(async () => SAFE),
      sendUncheckedTransaction: jest.fn(async () => SAFE_TX_HASH),
      sendTransaction: jest.fn(),
    };
  };

  beforeEach(() => {
    contract.interface = new actualEthers.Interface(OVMContract.abi);
    contract.deposit = jest.fn();
    contract.withdraw = jest.fn();
  });

  it('depositOVM waits for the Safe execution instead of tx.wait()', async () => {
    const signer = safeSigner();
    const onSent = jest.fn();

    const result = await depositOVM({
      ovmAddress: OVM,
      deposits: [mainnetDepositPayload.deposit],
      signer,
      options: { onSent },
    });

    expect(result).toEqual({ txHashes: [EXECUTED] });
    expect(contract.deposit).not.toHaveBeenCalled();
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OVM,
        value: BigInt(mainnetDepositPayload.deposit.amount),
      }),
    );
    expect(onSent).toHaveBeenCalledWith({
      hash: SAFE_TX_HASH,
      index: 0,
      contractWallet: true,
    });
  });

  it('requestWithdrawalFromOVM waits for the Safe execution instead of tx.wait()', async () => {
    const signer = safeSigner();

    const result = await requestWithdrawalFromOVM({
      ovmAddress: OVM,
      pubKeys: [PUBKEY],
      amounts: ['32000000000'],
      withdrawalFees: '2',
      excessFeeRecipient: TEST_ADDRESSES.SPLIT_OWNER,
      signer,
    });

    expect(result).toEqual({ txHash: EXECUTED });
    expect(contract.withdraw).not.toHaveBeenCalled();
    const sentTx = signer.sendUncheckedTransaction.mock.calls[0][0];
    expect(sentTx.value).toBe(BigInt(2));
    expect(
      contract.interface.decodeFunctionData('withdraw', sentTx.data)[3],
    ).toBe(actualEthers.getAddress(TEST_ADDRESSES.SPLIT_OWNER));
  });
});
