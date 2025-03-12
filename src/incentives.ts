import { Provider, Signer } from "ethers";
import { ETH_ADDRESS } from ".";
import { isContractAvailable } from "./utils";
import {
    type Incentives as IncentivesType,
} from './types';
import { claimIncentivesFromMerkleDistributor, isClaimedFromMerkleDistributor } from "./incentivesHalpers";
import { DEFAULT_BASE_VERSION } from "./constants";

export class Incentives {
    private signer: Signer | undefined;
    public chainId: number;
    private request: (endpoint: string, options?: RequestInit) => Promise<any>;

    constructor(signer: Signer | undefined, chainId: number, request: (endpoint: string, options?: RequestInit) => Promise<any>) {
        this.signer = signer;
        this.chainId = chainId;
        this.request = request;
    }

    /**
     * Claims obol incentives from a Merkle Distributor contract.
     * 
     * @remarks
     * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
     * and not pushed to version control.
     *
     * @param {Object} incentivesData - The incentives data needed for claiming.
     * @param {string} incentivesData.contractAddress - The address of the Merkle Distributor contract.
     * @param {number} incentivesData.index - The index in the Merkle tree.
     * @param {string} incentivesData.operatorAddress - The address of the operator.
     * @param {string} incentivesData.amount - The amount to claim.
     * @param {string[]} incentivesData.merkleProof - The Merkle proof.
     * @returns {Promise<{ txHash: string }>} The transaction hash of the claim transaction.
     * @throws Will throw an error if the contract is not available or the claim fails.
     * 
     * An example of how to use acceptObolLatestTermsAndConditions:
     * [claimIncentives](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L44)
     */
    async claimIncentives(incentivesData: {
        contractAddress: ETH_ADDRESS;
        index: number;
        operatorAddress: ETH_ADDRESS;
        amount: string;
        merkleProof: string[];
    }): Promise<{ txHash: string }> {
        // This method doesn't require T&C signature
        if (!this.signer) {
            throw new Error('Signer is required in claimIncentives');
        }

        // Check if the contract is available
        const isContractDeployed = await isContractAvailable(
            incentivesData.contractAddress,
            this.signer.provider as Provider
        );

        if (!isContractDeployed) {
            throw new Error(
                `Merkle Distributor contract is not available at address ${incentivesData.contractAddress}`
            );
        }

        try {
            // Call the helper function from incentivesHelpers.ts
            // Assuming you've exported a function called claimIncentivesHelper
            const { txHash } = await claimIncentivesFromMerkleDistributor({
                signer: this.signer,
                contractAddress: incentivesData.contractAddress,
                index: incentivesData.index,
                operatorAddress: incentivesData.operatorAddress,
                amount: incentivesData.amount,
                merkleProof: incentivesData.merkleProof,
            });

            return { txHash };
        } catch (error: any) {
            console.log("Error claiming incentives:", error);
            throw new Error(`Failed to claim incentives: ${error.message}`);
        }
    }


    /**
     * Read isClaimed.
     *
     * @param {ETH_ADDRESS} contractAddress - Address of the Merkle Distributor Contract
     * @param {ETH_ADDRESS} index - operator index in merkle tree
     * @returns {Promise<boolean>} true if incentives are already claime
     *
     */
    async isClaimed(contractAddress: ETH_ADDRESS, index: number): Promise<boolean> {
        return await isClaimedFromMerkleDistributor(this.chainId, contractAddress, index);
    }


    /**
     * @param address - Operator address
     * @returns {Promise<IncentivesType>} The matched incentives from DB
     * @throws On not found if address not found.
     */
    async getIncentivesByAddress(address: string): Promise<IncentivesType> {
        const incentives: IncentivesType = await this.request(
            `/${DEFAULT_BASE_VERSION}/address/incentives/${address}`,
            {
                method: 'GET',
            },
        );
        return incentives;
    }
}