import { assertSignerChain } from '../utils.js';
import { assertAddress } from '../validation.js';
import {
  type ClaimableIncentives,
  type ETH_ADDRESS,
  FORK_NAMES,
  type ProviderType,
  type SignerType,
  type ClaimIncentivesResponse,
  type PreflightIssue,
  type PreflightResult,
} from '../types.js';
import {
  claimIncentivesFromMerkleDistributor,
  isClaimedFromMerkleDistributor,
} from './incentiveHelpers.js';
import { preflightIncentivesClaim } from './incentivesPreflight.js';
import { DEFAULT_BASE_VERSION } from '../constants.js';
import {
  IncentivesPreflightError,
  InvalidArgumentError,
  NotFoundError,
  SignerRequiredError,
} from '../errors.js';

/**
 * The API answers 200 with an empty `contract_address` (and `index` -1) for
 * addresses that have no incentives.
 */
const hasIncentives = (data: ClaimableIncentives | undefined): boolean =>
  typeof data?.contract_address === 'string' && data.contract_address !== '';

const noIncentivesIssue = (address: string): PreflightIssue => ({
  code: 'NO_INCENTIVES',
  message: `No incentives found for address ${address}`,
  hint: 'Check the address and the client chainId; nothing to claim otherwise.',
});

/**
 * Manages Obol incentive rewards – querying eligibility and claiming from
 * on-chain Merkle Distributor contracts.
 *
 * Do not instantiate directly; access via `client.incentives`.
 *
 * @example
 * ```typescript
 * const client = new Client({ chainId: 560048 }, signer);
 *
 * // Check claimable incentives
 * const data = await client.incentives.getIncentivesByAddress("0xOperator...");
 *
 * // Check if already claimed
 * const claimed = await client.incentives.isClaimed(data.contract_address, data.index);
 *
 * // Read-only checks before claiming (claimIncentives also runs them)
 * const { ok, issues } = await client.incentives.preflightClaim("0xOperator...");
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
   * Automatically fetches incentive data, runs {@link Incentives.preflightClaim}'s
   * checks, and submits the on-chain claim transaction. Returns `{ txHash: null }`
   * if incentives were already claimed (idempotent).
   *
   * The claim may be sent for any address: the signer pays gas and the tokens are
   * transferred to `address`.
   *
   * @param address - The operator's Ethereum address to claim incentives for.
   * @returns The transaction hash, or `{ txHash: null }` if already claimed.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {IncentivesPreflightError} If the address has no incentives
   *   (`NO_INCENTIVES`) or a pre-flight check fails (the message lists the
   *   issue codes; `issues` holds the details).
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

    await assertSignerChain(this.signer, this.chainId, 'claimIncentives');

    try {
      const incentivesData = await this.getIncentivesByAddress(address);

      if (!hasIncentives(incentivesData)) {
        const issue = noIncentivesIssue(address);
        throw new IncentivesPreflightError(
          `Failed to claim incentives: [${issue.code}] ${issue.message}`,
          [issue],
        );
      }

      const { issues } = await preflightIncentivesClaim({
        requestedAddress: address,
        incentivesData,
        chainId: this.chainId,
        provider: this.provider,
      });

      const alreadyClaimed = issues.some(i => i.code === 'ALREADY_CLAIMED');
      const blocking = issues.filter(
        i =>
          i.code !== 'ALREADY_CLAIMED' &&
          !(alreadyClaimed && i.code === 'CLAIM_WINDOW_CLOSED'),
      );

      if (blocking.length > 0) {
        throw new IncentivesPreflightError(
          `Failed to claim incentives: ${blocking.map(i => `[${i.code}] ${i.message}`).join('; ')}`,
          blocking,
        );
      }

      if (alreadyClaimed) {
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
      if (error instanceof IncentivesPreflightError) {
        throw error;
      }
      throw new Error(`Failed to claim incentives: ${error.message}`);
    }
  }

  /**
   * Runs read-only checks on the incentives for an address before claiming.
   * No signer or transaction is needed, but a provider is.
   *
   * Checks that:
   * - the API data is for `address`;
   * - the contract is a known Obol `MerkleDistributorWithDeadline` and pays out
   *   the OBOL token for this chain;
   * - the Merkle proof matches the contract's `merkleRoot`;
   * - the index is not already claimed and the claim window is open.
   *
   * Problems are returned as issues rather than thrown: `NO_INCENTIVES` when
   * the address has none, `INCENTIVES_NOT_FOUND` for a 404 from the API and
   * `INCENTIVES_FETCH_FAILED` for other API or network errors. Errors
   * reaching the provider are thrown.
   *
   * @param address - The Ethereum address the incentives are claimed for.
   * @returns `{ ok, issues }`, where each issue has a `code`, `message` and `hint`.
   *
   * @example
   * ```typescript
   * const { ok, issues } = await client.incentives.preflightClaim("0xOperator...");
   * if (!ok) console.log(issues.map(i => i.code));
   * ```
   */
  async preflightClaim(address: string): Promise<PreflightResult> {
    let incentivesData: ClaimableIncentives;
    try {
      incentivesData = await this.getIncentivesByAddress(address);
    } catch (error: any) {
      const notFound = error instanceof NotFoundError || error?.status === 404;
      return {
        ok: false,
        issues: [
          notFound
            ? {
                code: 'INCENTIVES_NOT_FOUND',
                message: `No incentives found for ${address}: ${error?.message}`,
                hint: 'Check the address and the client chainId.',
              }
            : {
                code: 'INCENTIVES_FETCH_FAILED',
                message: `Could not fetch incentives for ${address}: ${error?.message}`,
                hint: 'Retry later; the Obol API or the network may be unavailable.',
              },
        ],
      };
    }

    if (!hasIncentives(incentivesData)) {
      return { ok: false, issues: [noIncentivesIssue(address)] };
    }

    return await preflightIncentivesClaim({
      requestedAddress: address,
      incentivesData,
      chainId: this.chainId,
      provider: this.provider,
    });
  }

  /**
   * Checks whether incentives have already been claimed for a given operator index.
   *
   * Read-only on-chain call – no transaction sent.
   *
   * @param contractAddress - Address of the Merkle Distributor contract.
   * @param index - The operator's index in the Merkle tree (from {@link Incentives.getIncentivesByAddress}).
   * @returns `true` if the incentives at that index have already been claimed.
   * @throws {InvalidArgumentError} If `contractAddress` is not an address
   *   (e.g. the empty address returned for an address without incentives) or
   *   `index` is not a non-negative integer.
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
    assertAddress(contractAddress, 'contractAddress');
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new InvalidArgumentError(
        `Invalid index: expected a non-negative integer, got ${String(index)}`,
        'index',
      );
    }
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
   * @returns Claimable incentive data including amount, Merkle proof, and
   *   contract address. For an address without incentives the API returns
   *   an empty `contract_address` and `index` -1.
   * @throws {Error} If no incentives are found for the given address (404).
   * @throws {Error} If `address` is not a 0x-prefixed 20-byte address.
   *
   * @example
   * ```typescript
   * const incentives = await client.incentives.getIncentivesByAddress("0xOperator...");
   * console.log(incentives.amount, incentives.contract_address);
   * ```
   */
  async getIncentivesByAddress(address: string): Promise<ClaimableIncentives> {
    assertAddress(address, 'address');
    const network = FORK_NAMES[this.chainId];
    const incentives: ClaimableIncentives = await this.request(
      `/${DEFAULT_BASE_VERSION}/address/incentives/${network}/${encodeURIComponent(address)}`,
      {
        method: 'GET',
      },
    );
    return incentives;
  }
}
