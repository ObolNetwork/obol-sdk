import { ETHER_TO_GWEI } from '../constants.js';
import { type SignerType, type ProviderType } from '../types.js';
import { Contract, type JsonRpcSigner } from 'ethers';
import { BatchDepositContract } from '../abi/BatchDeposit.js';
import { SignerRequiredError } from '../errors.js';
import {
  isContractWalletSigner,
  submitViaContractWalletAndWait,
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
  return (
    'sendUncheckedTransaction' in signer &&
    (await isContractWalletSigner(signer, provider))
  );
};

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
}: {
  pubkey: string;
  allocation: number;
  withdrawalAddress: string;
  withdrawalContractAddress: string;
  requiredFee: string;
  chainId: number;
  signer: SignerType;
  provider?: ProviderType | null;
}): Promise<{ txHash: string | null }> {
  if (!withdrawalAddress) {
    throw new Error('No withdrawal address provided');
  }
  if (allocation === undefined || allocation === null) {
    throw new Error('No allocation provided');
  }

  const amountInGwei = BigInt(Math.floor(Number(allocation) * ETHER_TO_GWEI));
  const data = `0x${pubkey.slice(2)}${amountInGwei.toString(16).padStart(16, '0')}`;

  if (await isSafeLikeSigner(signer, provider)) {
    const txHash = await submitViaContractWalletAndWait({
      signer: signer as JsonRpcSigner,
      to: withdrawalContractAddress,
      data,
      value: BigInt(requiredFee),
      provider,
    });
    return { txHash };
  }

  const tx = await signer.sendTransaction({
    to: withdrawalContractAddress,
    chainId,
    value: BigInt(requiredFee),
    data: data as `0x${string}`,
  });

  const receipt = await tx.wait();
  if (!receipt) return { txHash: null };
  return { txHash: receipt.hash };
}

/**
 * Helper function to submit batch deposit request for EOA
 */
export async function submitEOABatchDeposit({
  deposits,
  batchDepositContractAddress,
  signer,
  provider,
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
  const txHashes: string[] = [];

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
          signer: signer as JsonRpcSigner,
          to: batchDepositContractAddress,
          data: batchDepositContract.interface.encodeFunctionData(
            'batchDeposit',
            [depositData],
          ),
          value: totalValue,
          provider,
        });
        txHashes.push(txHash);
        continue;
      }

      // Execute batch deposit for this batch
      const tx = await batchDepositContract.batchDeposit(depositData, {
        value: totalValue,
      });

      const receipt = await tx.wait();
      if (receipt?.hash) {
        txHashes.push(receipt.hash as string);
      }
    }
    return { txHashes };
  } catch (error: any) {
    // Keep the actionable Safe timeout message ("retry to continue").
    if (error instanceof Error && error.message.includes('Safe transaction')) {
      throw error;
    }
    throw new Error("Failed to submit batch deposit'}");
  }
}
