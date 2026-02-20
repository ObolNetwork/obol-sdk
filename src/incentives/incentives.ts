import { isContractAvailable } from '../utils.js';
import {
  type ClaimableIncentives,
  type ETH_ADDRESS,
  FORK_NAMES,
  type ProviderType,
  type SignerType,
  type ClaimIncentivesResponse,
} from '../types.js';
import {
  claimIncentivesFromMerkleDistributor,
  isClaimedFromMerkleDistributor,
} from './incentiveHelpers.js';
import { DEFAULT_BASE_VERSION } from '../constants.js';
import { SignerRequiredError } from '../errors.js';

/**
 * Manages Obol incentive rewards – querying eligibility and claiming from
 * on-chain Merkle Distributor contracts.
 *
 * Do not instantiate directly; access via `client.incentives`.
 *
 * @example
 * ```typescript
 * const client = new Client({ chainId: 17000 }, signer);
 *
 * // Check claimable incentives
 * const data = await client.incentives.getIncentivesByAddress("0xOperator...");
 *
 * // Check if already claimed
 * const claimed = await client.incentives.isClaimed(data.contract_address, data.index);
 *
 * // Claim (sends on-chain transaction)
 * const { txHash } = await client.incentives.claimIncentives("0xOperator...");
 * ```
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
   * Claims Obol incentives from a Merkle Distributor contract for the given address.
   *
   * Automatically fetches incentive data, checks if already claimed, and submits
   * the on-chain claim transaction. Returns `{ txHash: null }` if incentives were
   * already claimed (idempotent).
   *
   * @param address - The operator's Ethereum address to claim incentives for.
   * @returns The transaction hash, or `{ txHash: null }` if already claimed.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {Error} If no incentives are found for the address.
   *
   * @example
   * ```typescript
   * const { txHash } = await client.incentives.claimIncentives("0xOperator...");
   * if (txHash) {
   *   console.log("Claimed:", txHash);
   * } else {
   *   console.log("Already claimed");
   * }
   * ```
   */
  async claimIncentives(address: string): Promise<ClaimIncentivesResponse> {
    if (!this.signer) {
      throw new SignerRequiredError('claimIncentives');
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
   * Checks whether incentives have already been claimed for a given operator index.
   *
   * Read-only on-chain call – no transaction sent.
   *
   * @param contractAddress - Address of the Merkle Distributor contract.
   * @param index - The operator's index in the Merkle tree (from {@link Incentives.getIncentivesByAddress}).
   * @returns `true` if the incentives at that index have already been claimed.
   *
   * @example
   * ```typescript
   * const claimed = await client.incentives.isClaimed(
   *   "0xMerkleDistributor...",
   *   42,
   * );
   * ```
   */
  async isClaimed(
    contractAddress: ETH_ADDRESS,
    index: number,
  ): Promise<boolean> {
    return await isClaimedFromMerkleDistributor(
      contractAddress,
      index,
      this.provider,
    );
  }

  /**
   * Fetches claimable incentive data for an operator address from the Obol API.
   *
   * The returned data includes the Merkle proof, amount, and contract address
   * needed to claim on-chain. This is a read-only API call.
   *
   * @param address - The operator's Ethereum address.
   * @returns Claimable incentive data including amount, Merkle proof, and contract address.
   * @throws {Error} If no incentives are found for the given address (404).
   *
   * @example
   * ```typescript
   * const incentives = await client.incentives.getIncentivesByAddress("0xOperator...");
   * console.log(incentives.amount, incentives.contract_address);
   * ```
   */
  async getIncentivesByAddress(address: string): Promise<ClaimableIncentives> {
    const network = FORK_NAMES[this.chainId];
    const incentives: ClaimableIncentives = await this.request(
      `/${DEFAULT_BASE_VERSION}/address/incentives/${network}/${address}`,
      {
        method: 'GET',
      },
    );
    return incentives;
  }
}
