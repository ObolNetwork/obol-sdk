// @ts-nocheck
// claimIncentives from a contract wallet (a Safe): the wallet returns its
// own safeTxHash, so the claim is submitted unchecked and resolved from the
// Safe's ExecutionSuccess log instead of waiting on that hash.
import { jest } from '@jest/globals';
import { id, Interface } from 'ethers';
import { claimIncentivesFromMerkleDistributor } from '../../src/incentives/incentiveHelpers';
import { MerkleDistributorABI } from '../../src/abi/MerkleDistributorWithDeadline';
import { TransactionSubmissionError } from '../../src/errors';
import { TEST_ADDRESSES } from '../fixtures';

const SAFE_ADDRESS = TEST_ADDRESSES.OVM_OWNER;
const DISTRIBUTOR = TEST_ADDRESSES.MERKLE_DISTRIBUTOR;
const OPERATOR = TEST_ADDRESSES.REWARD_RECIPIENT_1;
const SAFE_TX_HASH = '0x' + 'aa'.repeat(32);
const EXECUTED_TX_HASH = '0x' + 'ee'.repeat(32);
const SUCCESS_TOPIC = id('ExecutionSuccess(bytes32,uint256)');

const claim = {
  contractAddress: DISTRIBUTOR,
  index: 3,
  operatorAddress: OPERATOR,
  amount: '1000000000000000000',
  merkleProof: ['0x' + '11'.repeat(32)],
};
const claimData = new Interface(MerkleDistributorABI.abi).encodeFunctionData(
  'claim',
  [BigInt(claim.index), OPERATOR, BigInt(claim.amount), claim.merkleProof],
);

const makeSafeSigner = (pastLogs: unknown[]) => {
  const provider = {
    getBlockNumber: jest.fn(async () => 100),
    getCode: jest.fn(async () => '0xabcdef'), // the signer is a contract
    estimateGas: jest.fn(async () => 90000n),
    getLogs: jest.fn(async () => pastLogs),
    on: jest.fn(async () => {}),
    off: jest.fn(async () => {}),
  };
  const signer = {
    provider,
    getAddress: jest.fn(async () => SAFE_ADDRESS),
    sendUncheckedTransaction: jest.fn(async () => SAFE_TX_HASH),
    sendTransaction: jest.fn(),
  };
  return { signer, provider };
};

describe('claimIncentivesFromMerkleDistributor with a contract wallet', () => {
  it('submits unchecked and returns the executed transaction hash', async () => {
    const { signer } = makeSafeSigner([
      {
        address: SAFE_ADDRESS,
        transactionHash: EXECUTED_TX_HASH,
        topics: [SUCCESS_TOPIC, SAFE_TX_HASH],
        data: '0x',
      },
    ]);
    const onSent = jest.fn();

    const result = await claimIncentivesFromMerkleDistributor({
      ...claim,
      signer,
      options: { onSent },
    });

    expect(result).toEqual({ txHash: EXECUTED_TX_HASH });
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith({
      to: DISTRIBUTOR,
      data: claimData,
      gasLimit: 90000n,
    });
    // The checked path would wait on the safeTxHash forever.
    expect(signer.sendTransaction).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith({
      hash: SAFE_TX_HASH,
      index: 0,
      contractWallet: true,
    });
  });

  it('reads through the given provider when the signer has none', async () => {
    const { signer, provider } = makeSafeSigner([
      {
        address: SAFE_ADDRESS,
        transactionHash: EXECUTED_TX_HASH,
        topics: [SUCCESS_TOPIC, SAFE_TX_HASH],
        data: '0x',
      },
    ]);
    signer.provider = null;

    const result = await claimIncentivesFromMerkleDistributor({
      ...claim,
      signer,
      provider,
    });

    expect(result).toEqual({ txHash: EXECUTED_TX_HASH });
    expect(provider.getCode).toHaveBeenCalledWith(SAFE_ADDRESS);
  });

  it('reports the Safe hash when the wallet call fails after submission', async () => {
    const { signer, provider } = makeSafeSigner([]);
    provider.getLogs = jest.fn(async () => {
      throw new Error('rpc down');
    });

    const err = await claimIncentivesFromMerkleDistributor({
      ...claim,
      signer,
    }).catch(e => e);

    expect(err).toBeInstanceOf(TransactionSubmissionError);
    expect(err.pendingTxHash).toBe(SAFE_TX_HASH);
    expect(err.pendingStatus).toBe('unconfirmed');
  });
});

describe('claimIncentivesFromMerkleDistributor with an EOA signer', () => {
  it('sends a checked transaction as before', async () => {
    const wait = jest.fn(async () => ({ hash: EXECUTED_TX_HASH, status: 1 }));
    const signer = {
      provider: {
        getCode: jest.fn(async () => '0x'),
        getTransactionReceipt: jest.fn(async () => ({
          hash: EXECUTED_TX_HASH,
          status: 1,
          logs: [],
          confirmations: async () => 1,
        })),
      },
      getAddress: jest.fn(async () => OPERATOR),
      sendUncheckedTransaction: jest.fn(),
      sendTransaction: jest.fn(async () => ({ hash: EXECUTED_TX_HASH, wait })),
    };
    const onSent = jest.fn();

    const result = await claimIncentivesFromMerkleDistributor({
      ...claim,
      signer,
      options: { onSent },
    });

    expect(result).toEqual({ txHash: EXECUTED_TX_HASH });
    expect(signer.sendUncheckedTransaction).not.toHaveBeenCalled();
    expect(signer.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: DISTRIBUTOR, data: claimData }),
    );
    expect(onSent).toHaveBeenCalledWith({
      hash: EXECUTED_TX_HASH,
      index: 0,
      contractWallet: false,
    });
  });
});
