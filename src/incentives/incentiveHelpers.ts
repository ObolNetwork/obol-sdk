import {
  type ProviderType,
  type SignerType,
  type ETH_ADDRESS,
  type WriteOptions,
} from '../types.js';
import { Contract } from 'ethers';
import { SentTransactions } from '../sentTransactions.js';
import {
  isContractWalletSigner,
  submitViaContractWalletAndWait,
  type UncheckedTransactionSigner,
} from '../splits/splitHelpers.js';
import { MerkleDistributorABI } from '../abi/MerkleDistributorWithDeadline.js';

export const claimIncentivesFromMerkleDistributor = async (incentivesData: {
  signer: SignerType;
  contractAddress: ETH_ADDRESS;
  index: number;
  operatorAddress: ETH_ADDRESS;
  amount: string;
  merkleProof: string[];
  /** Used for reads when the signer's own provider cannot serve them. */
  provider?: ProviderType | null;
  options?: WriteOptions;
}): Promise<{ txHash: string }> => {
  // A Safe returns its internal safeTxHash from sendTransaction, which never
  // appears on-chain: ethers then waits for it forever. Contract-wallet
  // signers submit unchecked and resolve via the Safe's ExecutionSuccess log,
  // as the deposit and withdrawal methods do.
  const contractWallet = await isContractWalletSigner(
    incentivesData.signer,
    incentivesData.provider,
  );
  const sent = new SentTransactions(incentivesData.options, contractWallet);
  try {
    const contract = new Contract(
      incentivesData.contractAddress,
      MerkleDistributorABI.abi,
      incentivesData.signer,
    );

    const claimArgs = [
      BigInt(incentivesData.index),
      incentivesData.operatorAddress,
      BigInt(incentivesData.amount),
      incentivesData.merkleProof,
    ] as const;

    if (contractWallet) {
      const txHash = await submitViaContractWalletAndWait({
        signer: incentivesData.signer as UncheckedTransactionSigner,
        to: incentivesData.contractAddress,
        data: contract.interface.encodeFunctionData('claim', claimArgs),
        provider: incentivesData.provider,
        onSubmitted: hash => {
          sent.sent(hash);
        },
      });
      return { txHash };
    }

    const tx = await contract.claim(...claimArgs);
    sent.sent(tx.hash as string);

    const receipt = await tx.wait();

    return { txHash: receipt.hash };
  } catch (error: any) {
    const message = `Failed to claim incentives: ${error.message}`;
    throw sent.failure(message, error, new Error(message));
  }
};

export const isClaimedFromMerkleDistributor = async (
  contractAddress: ETH_ADDRESS,
  index: number,
  provider: ProviderType | undefined | null,
): Promise<boolean> => {
  try {
    const contract = new Contract(
      contractAddress,
      MerkleDistributorABI.abi,
      provider,
    );

    const claimed = await contract.isClaimed(BigInt(index));

    return claimed;
  } catch (error: any) {
    throw new Error(`Failed to check claim status: ${error.message}`);
  }
};
