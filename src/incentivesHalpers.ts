import { type ETH_ADDRESS } from './types';
import { Contract, type Signer } from 'ethers';
import { MerkleDistributorABI } from './abi/MerkleDistributorWithDeadline';
import { getProvider } from './utils';

export const claimIncentivesFromMerkleDistributor = async (incentivesData: {
  signer: Signer;
  contractAddress: ETH_ADDRESS;
  index: number;
  operatorAddress: ETH_ADDRESS;
  amount: string;
  merkleProof: string[];
}): Promise<{ txHash: string }> => {
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

    const receipt = await tx.wait();

    return { txHash: receipt.hash };
  } catch (error: any) {
    console.log('Error claiming incentives:', error);
    throw new Error(`Failed to claim incentives: ${error.message}`);
  }
};

export const isClaimedFromMerkleDistributor = async (
  chainId: number,
  contractAddress: ETH_ADDRESS,
  index: number,
): Promise<boolean> => {
  try {
    const provider = getProvider(chainId);

    const contract = new Contract(
      contractAddress,
      MerkleDistributorABI.abi,
      provider,
    );

    const claimed = await contract.isClaimed(BigInt(index));

    return claimed;
  } catch (error: any) {
    console.log('Error checking claim status:', error);
    throw new Error(`Failed to check claim status: ${error.message}`);
  }
};
