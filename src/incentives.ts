import { isContractAvailable } from './utils';
import {
  type Incentives as IncentivesType,
  type ETH_ADDRESS,
  FORK_NAMES,
  type ProviderType,
  type SignerType,
} from './types';
import {
  claimIncentivesFromMerkleDistributor,
  isClaimedFromMerkleDistributor,
} from './incentiveHelpers';
import { DEFAULT_BASE_VERSION } from './constants';

export class Incentives {
  private readonly signer: SignerType | undefined;
  public readonly chainId: number;
  private readonly request: (
    endpoint: string,
    options?: RequestInit,
  ) => Promise<any>;

  public readonly provider: ProviderType | undefined | null;

  constructor(
    signer: SignerType | undefined,
    chainId: number,
    request: (endpoint: string, options?: RequestInit) => Promise<any>,
    provider: ProviderType | undefined | null,
  ) {
    this.signer = signer;
    this.chainId = chainId;
    this.request = request;
    this.provider = provider;
  }

  /**
   * Claims obol incentives from a Merkle Distributor contract using just an address.
   * The method automatically fetches incentives data and checks if already claimed.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {string} address - The address to claim incentives for
   * @returns {Promise<{ txHash: string } | { alreadyClaimed: true }>} The transaction hash or already claimed status
   * @throws Will throw an error if the incentives data is not found or the claim fails
   */
  async claimIncentives(
    address: string,
  ): Promise<{ txHash: string } | { alreadyClaimed: true }> {
    if (!this.signer) {
      throw new Error('Signer is required in claimIncentives');
    }

    try {
      const incentivesData = await this.getIncentivesByAddress(address);

      if (!incentivesData?.contract_address) {
        throw new Error(`No incentives found for address ${address}`);
      }

      const isContractDeployed = await isContractAvailable(
        incentivesData.contract_address,
        this.provider as ProviderType,
      );

      if (!isContractDeployed) {
        throw new Error(
          `Merkle Distributor contract is not available at address ${incentivesData.contract_address}`,
        );
      }

      const claimed = await this.isClaimed(
        incentivesData.contract_address,
        incentivesData.index,
      );

      if (claimed) {
        return { alreadyClaimed: true };
      }

      const { txHash } = await claimIncentivesFromMerkleDistributor({
        signer: this.signer,
        contractAddress: incentivesData.contract_address,
        index: incentivesData.index,
        operatorAddress: incentivesData.operator_address,
        amount: incentivesData.amount,
        merkleProof: incentivesData.merkle_proof,
      });

      return { txHash };
    } catch (error: any) {
      console.log('Error claiming incentives:', error);
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
  async isClaimed(
    contractAddress: ETH_ADDRESS,
    index: number,
  ): Promise<boolean> {
    return await isClaimedFromMerkleDistributor(
      this.chainId,
      contractAddress,
      index,
      this.provider,
    );
  }

  /**
   * @param address - Operator address
   * @returns {Promise<IncentivesType>} The matched incentives from DB
   * @throws On not found if address not found.
   */
  async getIncentivesByAddress(address: string): Promise<IncentivesType> {
    const network = FORK_NAMES[this.chainId];
    const incentives: IncentivesType = await this.request(
      `/${DEFAULT_BASE_VERSION}/address/incentives/${network}/${address}`,
      {
        method: 'GET',
      },
    );
    return incentives;
  }
}
