import { ETHER_TO_GWEI } from '../constants';
import { type SignerType, type ProviderType } from '../types';

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
  provider: ProviderType;
}): Promise<{ txHash: string | null }> {
  if (!withdrawalAddress) throw new Error('No withdrawal address provided');
  if (!allocation) throw new Error('No allocation provided');

  const amountInGwei = BigInt(Math.floor(Number(allocation) * ETHER_TO_GWEI));
  const data = `0x${pubkey.slice(2)}${amountInGwei.toString(16).padStart(16, '0')}`;

  const { hash } = await signer.sendTransaction({
    to: withdrawalContractAddress,
    chainId,
    value: BigInt(requiredFee),
    data: data as `0x${string}`,
  });

  const txResult = await provider.getTransactionReceipt(hash);
  if (!txResult) return { txHash: null };

  return { txHash: txResult?.hash };
}
