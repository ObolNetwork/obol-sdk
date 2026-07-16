// @ts-nocheck
import { jest } from '@jest/globals';
import { AbiCoder, id } from 'ethers';
import { submitViaContractWalletAndWait } from '../../src/splits/splitHelpers';
import { submitEOAWithdrawalRequest } from '../../src/eoa/eoaHelpers';
import { isContractWalletSigner } from '../../src/splits/splitHelpers';
import { SignerRequiredError } from '../../src/errors';

const SAFE_ADDRESS = '0xAbCdEf0123456789012345678901234567890AbC';
const SAFE_TX_HASH = '0x' + 'aa'.repeat(32);
const EXECUTED_TX_HASH = '0x' + 'ee'.repeat(32);
const SUCCESS_TOPIC = id('ExecutionSuccess(bytes32,uint256)');
const TARGET = '0x00000961Ef480Eb55e80D19ad83579A64c007002';

const executionSuccessLog = (safeTxHash: string, indexed = true) =>
  indexed
    ? {
        address: SAFE_ADDRESS,
        transactionHash: EXECUTED_TX_HASH,
        topics: [SUCCESS_TOPIC, safeTxHash],
        data: '0x',
      }
    : {
        address: SAFE_ADDRESS,
        transactionHash: EXECUTED_TX_HASH,
        topics: [SUCCESS_TOPIC],
        data: AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256'],
          [safeTxHash, 0],
        ),
      };

const makeSafeSigner = ({
  returnedHash = SAFE_TX_HASH,
  pastLogs = [],
  liveLog = null,
}: {
  returnedHash?: string;
  pastLogs?: unknown[];
  liveLog?: unknown;
}) => {
  let capturedListener: ((log: unknown) => void) | null = null;
  const provider = {
    getBlockNumber: jest.fn(async () => 100),
    getCode: jest.fn(async () => '0xabcdef'), // contract wallet
    getLogs: jest.fn(async () => pastLogs),
    on: jest.fn(async (_filter, listener) => {
      capturedListener = listener;
      if (liveLog) {
        // Deliver asynchronously like a real subscription.
        setTimeout(() => capturedListener?.(liveLog), 5);
      }
    }),
    off: jest.fn(async () => {}),
  };
  const signer = {
    provider,
    getAddress: jest.fn(async () => SAFE_ADDRESS),
    sendUncheckedTransaction: jest.fn(async () => returnedHash),
    sendTransaction: jest.fn(),
  };
  return { signer, provider };
};

describe('submitViaContractWalletAndWait', () => {
  it('resolves the executed tx hash from a live ExecutionSuccess (indexed hash)', async () => {
    const { signer } = makeSafeSigner({
      liveLog: executionSuccessLog(SAFE_TX_HASH),
    });

    const txHash = await submitViaContractWalletAndWait({
      signer,
      to: TARGET,
      data: '0x1234',
      value: 1n,
    });

    expect(txHash).toBe(EXECUTED_TX_HASH);
    expect(signer.sendUncheckedTransaction).toHaveBeenCalledWith({
      to: TARGET,
      data: '0x1234',
      value: 1n,
    });
  });

  it('resolves from a backfilled ExecutionSuccess (v1.3.0 data-word hash)', async () => {
    const { signer } = makeSafeSigner({
      pastLogs: [executionSuccessLog(SAFE_TX_HASH, false)],
    });

    const txHash = await submitViaContractWalletAndWait({
      signer,
      to: TARGET,
      data: '0x1234',
    });

    expect(txHash).toBe(EXECUTED_TX_HASH);
  });

  it('resolves when the wallet returned a real tx hash (1-of-1 Safe)', async () => {
    const log = {
      ...executionSuccessLog('0x' + 'bb'.repeat(32)),
      transactionHash: EXECUTED_TX_HASH,
    };
    const { signer } = makeSafeSigner({
      returnedHash: EXECUTED_TX_HASH,
      pastLogs: [log],
    });

    const txHash = await submitViaContractWalletAndWait({
      signer,
      to: TARGET,
      data: '0x1234',
    });

    expect(txHash).toBe(EXECUTED_TX_HASH);
  });

  it('ignores another submission’s ExecutionSuccess and times out', async () => {
    const { signer } = makeSafeSigner({
      pastLogs: [executionSuccessLog('0x' + 'cc'.repeat(32))],
    });

    await expect(
      submitViaContractWalletAndWait({
        signer,
        to: TARGET,
        data: '0x1234',
        timeoutMs: 50,
      }),
    ).rejects.toThrow('Timed out waiting for the Safe transaction');
  });
});

describe('submitEOAWithdrawalRequest signer branching', () => {
  it('uses the Safe path for contract-wallet signers (no tx.wait hang)', async () => {
    const { signer } = makeSafeSigner({
      liveLog: executionSuccessLog(SAFE_TX_HASH),
    });

    const { txHash } = await submitEOAWithdrawalRequest({
      pubkey: '0x' + '11'.repeat(48),
      allocation: 0,
      withdrawalAddress: SAFE_ADDRESS,
      withdrawalContractAddress: TARGET,
      requiredFee: '1',
      chainId: 560048,
      signer,
    });

    expect(txHash).toBe(EXECUTED_TX_HASH);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('keeps the legacy sendTransaction + wait path for EOAs', async () => {
    const wait = jest.fn(async () => ({ hash: EXECUTED_TX_HASH }));
    const signer = {
      provider: { getCode: jest.fn(async () => '0x') },
      getAddress: jest.fn(async () => '0x1111111111111111111111111111111111111111'),
      // No sendUncheckedTransaction => plain EOA signer.
      sendTransaction: jest.fn(async () => ({ wait })),
    };

    const { txHash } = await submitEOAWithdrawalRequest({
      pubkey: '0x' + '11'.repeat(48),
      allocation: 0,
      withdrawalAddress: '0x1111111111111111111111111111111111111111',
      withdrawalContractAddress: TARGET,
      requiredFee: '1',
      chainId: 560048,
      signer,
    });

    expect(txHash).toBe(EXECUTED_TX_HASH);
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});

describe('signer guards (SignerRequiredError, not raw TypeError)', () => {
  it('isContractWalletSigner throws SignerRequiredError on a nullish signer', async () => {
    await expect(
      isContractWalletSigner(null as unknown as never),
    ).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it('submitEOAWithdrawalRequest throws SignerRequiredError on a nullish signer', async () => {
    await expect(
      submitEOAWithdrawalRequest({
        pubkey: '0x' + '11'.repeat(48),
        allocation: 0,
        withdrawalAddress: SAFE_ADDRESS,
        withdrawalContractAddress: TARGET,
        requiredFee: '1',
        chainId: 560048,
        signer: null as unknown as never,
      }),
    ).rejects.toBeInstanceOf(SignerRequiredError);
  });
});
