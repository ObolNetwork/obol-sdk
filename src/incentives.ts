import { isContractAvailable } from './utils';
import {
  type Incentives as IncentivesType,
  type ETH_ADDRESS,
  FORK_NAMES,
  type ProviderType,
  type SignerType,
  type ClaimIncentivesResponse,
} from './types';
import {
  claimIncentivesFromMerkleDistributor,
  isClaimedFromMerkleDistributor,
} from './incentiveHelpers';
import { DEFAULT_BASE_VERSION } from './constants';

/**
 * Incentives can be used for fetching and claiming Obol incentives.
 * @class
 * @internal Access it through Client.incentives.
 * @example
 * const obolClient = new Client(config);
 * await obolClient.incentives.claimIncentives(address);
 */
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
   * Claims Obol incentives from a Merkle Distributor contract using an address.
   *
   * This method automatically fetches incentive data and verifies whether the incentives have already been claimed.
   * If `txHash` is `null`, it indicates that the incentives were already claimed.
   *
   * Note: This method is not yet enabled and will throw an error if called.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {string} address - The address to claim incentives for
   * @returns {Promise<{ txHash: string } | { alreadyClaimed: true }>} The transaction hash or already claimed status
   * @throws Will throw an error if the incentives data is not found or the claim fails
   *
   * An example of how to use claimIncentives:
   * [obolClient](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L281)
   */
  async claimIncentives(address: string): Promise<ClaimIncentivesResponse> {
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
        return { txHash: null };
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
   *
   * An example of how to use isClaimed:
   * [obolClient](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L266)
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
   *
   * An example of how to use getIncentivesByAddress:
   * [obolClient](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L250)
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
