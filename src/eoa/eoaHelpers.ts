import {
  type SignerType,
  type ProviderType,
  type WriteOptions,
} from '../types.js';
import { Contract, parseUnits } from 'ethers';
import { BatchDepositContract } from '../abi/BatchDeposit.js';
import { SignerRequiredError } from '../errors.js';
import { SentTransactions } from '../sentTransactions.js';
import {
  isContractWalletSigner,
  submitViaContractWalletAndWait,
  type UncheckedTransactionSigner,
} from '../splits/splitHelpers.js';

// Safe wallets return an internal safeTxHash from sendTransaction, so
// tx.wait() hangs forever (the hash never appears on-chain). Contract-wallet
// signers submit unchecked and resolve via the Safe's ExecutionSuccess log.
// This is the first dereference on both write flows, so it guards the signer.
const isSafeLikeSigner = async (
  signer: SignerType,
  provider?: ProviderType | null,
): Promise<boolean> => {
  if (!signer) {
    throw new SignerRequiredError('submitEOATransaction');
  }
  // isContractWalletSigner is false for signers without
  // sendUncheckedTransaction (local Wallets), without a chain read.
  return await isContractWalletSigner(signer, provider);
};

const MAX_UINT64 = BigInt('0xffffffffffffffff');

/**
 * Helper function to submit withdrawal request for EOA
 */
export async function submitEOAWithdrawalRequest({
  pubkey,
  allocation,
  withdrawalAddress,
  withdrawalContractAddress,
  requiredFee,
  chainId,
  signer,
  provider,
  options,
}: {
  pubkey: string;
  allocation: number;
  withdrawalAddress: string;
  withdrawalContractAddress: string;
  requiredFee: string;
  chainId: number;
  signer: SignerType;
  provider?: ProviderType | null;
  options?: WriteOptions;
}): Promise<{ txHash: string | null }> {
  if (!withdrawalAddress) {
    throw new Error('No withdrawal address provided');
  }
  if (allocation === undefined || allocation === null) {
    throw new Error('No allocation provided');
  }

  // allocation is in ETH; round to whole gwei without float multiplication.
  const amountInGwei = parseUnits(Number(allocation).toFixed(9), 'gwei');
  if (amountInGwei < BigInt(0) || amountInGwei > MAX_UINT64) {
    throw new Error('Allocation out of range');
  }
  const data = `0x${pubkey.slice(2)}${amountInGwei.toString(16).padStart(16, '0')}`;

  const contractWallet = await isSafeLikeSigner(signer, provider);
  const sent = new SentTransactions(options, contractWallet);
  try {
    if (contractWallet) {
      const txHash = await submitViaContractWalletAndWait({
        signer: signer as UncheckedTransactionSigner,
        to: withdrawalContractAddress,
        data,
        value: BigInt(requiredFee),
        provider,
        onSubmitted: hash => {
          sent.sent(hash);
        },
      });
      return { txHash };
    }

    const tx = await signer.sendTransaction({
      to: withdrawalContractAddress,
      chainId,
      value: BigInt(requiredFee),
      data: data as `0x${string}`,
    });
    sent.sent(tx.hash);

    const receipt = await tx.wait();
    if (!receipt) return { txHash: null };
    return { txHash: receipt.hash };
  } catch (error) {
    throw sent.failure(
      error instanceof Error ? error.message : 'Withdrawal request failed',
      error,
      error as Error,
    );
  }
}

/**
 * Helper function to submit batch deposit request for EOA
 */
export async function submitEOABatchDeposit({
  deposits,
  batchDepositContractAddress,
  signer,
  provider,
  options,
}: {
  deposits: Array<{
    pubkey: string;
    withdrawal_credentials: string;
    signature: string;
    deposit_data_root: string;
    amount: string;
  }>;
  batchDepositContractAddress: string;
  signer: SignerType;
  provider?: ProviderType | null;
  options?: WriteOptions;
}): Promise<{ txHashes: string[] }> {
  if (!deposits || deposits.length === 0) {
    throw new Error('No deposits provided');
  }

  // Create contract instance
  const batchDepositContract = new Contract(
    batchDepositContractAddress,
    BatchDepositContract.abi,
    signer,
  );

  const useContractWallet = await isSafeLikeSigner(signer, provider);

  const BATCH_SIZE = 500;
  const sent = new SentTransactions(options, useContractWallet);

  try {
    // Process deposits in batches of 500
    for (let i = 0; i < deposits.length; i += BATCH_SIZE) {
      const batchDeposits = deposits.slice(i, i + BATCH_SIZE);

      // Calculate total value needed for this batch
      const totalValue = batchDeposits.reduce(
        (sum, deposit) => sum + BigInt(deposit.amount),
        BigInt(0),
      );

      // Prepare deposit data for this batch
      const depositData = batchDeposits.map(deposit => ({
        pubKey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawal_credentials,
        signature: deposit.signature,
        depositDataRoot: deposit.deposit_data_root,
        amount: BigInt(deposit.amount),
      }));

      if (useContractWallet) {
        const txHash = await submitViaContractWalletAndWait({
          signer: signer as UncheckedTransactionSigner,
          to: batchDepositContractAddress,
          data: batchDepositContract.interface.encodeFunctionData(
            'batchDeposit',
            [depositData],
          ),
          value: totalValue,
          provider,
          onSubmitted: hash => {
            sent.sent(hash);
          },
        });
        sent.mined(txHash);
        continue;
      }

      // Execute batch deposit for this batch
      const tx = await batchDepositContract.batchDeposit(depositData, {
        value: totalValue,
      });
      sent.sent(tx.hash as string);

      const receipt = await tx.wait();
      if (receipt?.hash) {
        sent.mined(receipt.hash as string);
      }
    }
    return { txHashes: sent.hashes };
  } catch (error: any) {
    // Keep the actionable Safe timeout message ("retry to continue").
    if (error instanceof Error && error.message.includes('Safe transaction')) {
      throw sent.failure(error.message, error, error);
    }
    const message = `Failed to submit batch deposit${error instanceof Error ? `: ${error.message}` : ''}`;
    throw sent.failure(
      message,
      error,
      Object.assign(new Error(message), { cause: error }),
    );
  }
}
