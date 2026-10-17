import {
  type ProviderType,
  type SignerType,
  type ETH_ADDRESS,
  type WriteOptions,
} from '../types.js';
import { Contract } from 'ethers';
import { SentTransactions } from '../sentTransactions.js';
import { MerkleDistributorABI } from '../abi/MerkleDistributorWithDeadline.js';

export const claimIncentivesFromMerkleDistributor = async (incentivesData: {
  signer: SignerType;
  contractAddress: ETH_ADDRESS;
  index: number;
  operatorAddress: ETH_ADDRESS;
  amount: string;
  merkleProof: string[];
  options?: WriteOptions;
}): Promise<{ txHash: string }> => {
  const sent = new SentTransactions(incentivesData.options);
  try {
    const contract = new Contract(
      incentivesData.contractAddress,
      MerkleDistributorABI.abi,
      incentivesData.signer,
    );

    const tx = await contract.claim(
      BigInt(incentivesData.index),
      incentivesData.operatorAddress,
      BigInt(incentivesData.amount),
      incentivesData.merkleProof,
    );
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
