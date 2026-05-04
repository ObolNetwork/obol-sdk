import {
  submitEOAWithdrawalRequest,
  submitEOABatchDeposit,
} from './eoaHelpers.js';
import { validatePayload } from '../ajv.js';
import {
  eoaWithdrawalPayloadSchema,
  eoaDepositPayloadSchema,
} from '../schema.js';
import { CHAIN_CONFIGURATION } from '../constants.js';
import { SignerRequiredError, UnsupportedChainError } from '../errors.js';
import {
  type ProviderType,
  type SignerType,
  type EOAWithdrawalPayload,
  type EOADepositPayload,
} from '../types.js';

/**
 * Manages Externally Owned Account (EOA) operations: validator withdrawals
 * and batch deposits via on-chain contracts.
 *
 * Do not instantiate directly; access via `client.eoa`.
 *
 * Available methods:
 * - {@link EOA.requestWithdrawal} – request validator withdrawal
 * - {@link EOA.deposit} – batch-deposit validators for gas efficiency
 *
 * All methods send on-chain transactions and require a signer with ETH for gas.
 *
 * @example
 * ```typescript
 * const client = new Client({ chainId: 1 }, signer, provider);
 *
 * // Request withdrawal
 * const { txHash } = await client.eoa.requestWithdrawal({
 *   pubkey: "0xValidatorPubkey...",
 *   allocation: 32,
 *   requiredFee: "1",
 * });
 *
 * // Batch deposit
 * const { txHashes } = await client.eoa.deposit({
 *   deposits: [{ pubkey: "0x...", withdrawal_credentials: "0x...", ... }],
 * });
 * ```
 */
export class EOA {
  private readonly signer: SignerType | undefined;
  public readonly chainId: number;
  public readonly provider: ProviderType | undefined | null;

  constructor(
    signer: SignerType | undefined,
    chainId: number,
    provider: ProviderType | undefined | null,
  ) {
    this.signer = signer;
    this.chainId = chainId;
    this.provider = provider;
  }

  /**
   * Requests withdrawal of validator funds via the EOA withdrawal contract.
   *
   * Sends an on-chain transaction. Requires both a signer and a provider.
   *
   * @param payload - Withdrawal data including validator `pubkey`, `allocation`
   *   (in ETH), and `requiredFee` (in wei).
   * @returns The transaction hash, or `null` if no transaction was needed.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {UnsupportedChainError} If the chain has no EOA withdrawal contract.
   *
   * @example
   * ```typescript
   * const { txHash } = await client.eoa.requestWithdrawal({
   *   pubkey: "0xValidatorPubkey...",
   *   allocation: 32,
   *   requiredFee: "1",
   * });
   * ```
   */
  async requestWithdrawal(
    payload: EOAWithdrawalPayload,
  ): Promise<{ txHash: string | null }> {
    if (!this.signer) {
      throw new SignerRequiredError('requestWithdrawal');
    }

    if (!this.provider) {
      throw new Error('Provider is required in requestWithdrawal');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.EOA_WITHDRAWAL_CONTRACT?.address) {
      throw new UnsupportedChainError(this.chainId, 'EOA requestWithdrawal');
    }

    const validatedPayload = validatePayload<EOAWithdrawalPayload>(
      payload,
      eoaWithdrawalPayloadSchema,
    );

    const withdrawalAddress = await this.signer.getAddress();

    return await submitEOAWithdrawalRequest({
      pubkey: validatedPayload.pubkey,
      allocation: validatedPayload.allocation,
      withdrawalAddress,
      withdrawalContractAddress: chainConfig.EOA_WITHDRAWAL_CONTRACT.address,
      requiredFee: validatedPayload.requiredFee,
      chainId: this.chainId,
      signer: this.signer,
    });
  }

  /**
   * Batch-deposits validators to the beacon chain via the Pier Two batch
   * deposit contract for gas efficiency.
   *
   * Due to EVM gas limits, it is recommended to deposit at most 500
   * validators per call.
   *
   * @param payload - Deposit data including an array of validator deposit objects.
   * @returns An array of transaction hashes, one per batch.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {UnsupportedChainError} If the chain has no batch deposit contract.
   *
   * @example
   * ```typescript
   * const { txHashes } = await client.eoa.deposit({
   *   deposits: [{
   *     pubkey: "0x...",
   *     withdrawal_credentials: "0x...",
   *     deposit_data_root: "0x...",
   *     signature: "0x...",
   *     amount: "32000000000000000000",
   *   }],
   * });
   * ```
   */
  async deposit(payload: EOADepositPayload): Promise<{ txHashes: string[] }> {
    if (!this.signer) {
      throw new SignerRequiredError('deposit');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.BATCH_DEPOSIT_CONTRACT?.address) {
      throw new UnsupportedChainError(this.chainId, 'EOA deposit');
    }

    const validatedPayload = validatePayload<EOADepositPayload>(
      payload,
      eoaDepositPayloadSchema,
    );

    return await submitEOABatchDeposit({
      deposits: validatedPayload.deposits,
      batchDepositContractAddress: chainConfig.BATCH_DEPOSIT_CONTRACT.address,
      signer: this.signer,
    });
  }
}
