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
import { assertSignerChain } from '../utils.js';
import {
  getWithdrawalRequestFee,
  resolveWithdrawalFee,
} from '../withdrawalFee.js';
import { verifyDepositsBeforeSend } from '../deposits/depositGuard.js';
import { SignerRequiredError, UnsupportedChainError } from '../errors.js';
import {
  type ProviderType,
  type SignerType,
  type EOAWithdrawalPayload,
  type EOADepositPayload,
  type WriteOptions,
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
   * The fee is checked against the current fee read from the EIP-7002
   * withdrawal request contract. If `requiredFee` is omitted, twice the
   * current fee is sent. If it is given, it must cover the current fee and
   * be at most max(10x the current fee, 1 gwei); otherwise the call throws.
   *
   * @param payload - Withdrawal data including validator `pubkey`, `allocation`
   *   (in ETH), and optional `requiredFee` (in wei).
   * @param options - Optional `onSent` callback, called with each transaction
   *   hash as soon as it is broadcast.
   * @returns The transaction hash, or `null` if no transaction was needed.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {UnsupportedChainError} If the chain has no EOA withdrawal contract.
   * @throws If `requiredFee` is below the current fee or far above it.
   * @throws {TransactionSubmissionError} If the call fails after a transaction
   *   was broadcast (`txHashes`, `pendingTxHash` and `cause` say what was sent).
   *
   * @example
   * ```typescript
   * const { txHash } = await client.eoa.requestWithdrawal({
   *   pubkey: "0xValidatorPubkey...",
   *   allocation: 32,
   * });
   * ```
   */
  async requestWithdrawal(
    payload: EOAWithdrawalPayload,
    options?: WriteOptions,
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

    await assertSignerChain(this.signer, this.chainId, 'requestWithdrawal');

    const withdrawalAddress = await this.signer.getAddress();

    const currentFee = await getWithdrawalRequestFee(
      this.provider,
      chainConfig.EOA_WITHDRAWAL_CONTRACT.address,
    );
    const requiredFee = resolveWithdrawalFee({
      currentFee,
      requestedFee: validatedPayload.requiredFee,
    });

    return await submitEOAWithdrawalRequest({
      pubkey: validatedPayload.pubkey,
      allocation: validatedPayload.allocation,
      withdrawalAddress,
      withdrawalContractAddress: chainConfig.EOA_WITHDRAWAL_CONTRACT.address,
      requiredFee: requiredFee.toString(),
      chainId: this.chainId,
      signer: this.signer,
      provider: this.provider,
      options,
    });
  }

  /**
   * Batch-deposits validators to the beacon chain via the Pier Two batch
   * deposit contract for gas efficiency.
   *
   * Due to EVM gas limits, it is recommended to deposit at most 500
   * validators per call.
   *
   * Before sending, each deposit is checked: `amount` (wei) is a whole number
   * of gwei between 1 ETH and 32 ETH (2048 ETH for 0x02 credentials),
   * `deposit_data_root` matches the deposit fields, the BLS signature is valid
   * for this chain, and, if `expectedWithdrawalAddress` is given, the
   * withdrawal credentials point at it. Set `skipSignatureVerification` only
   * for top-ups to a validator that already exists on the beacon chain.
   *
   * If `beaconUrl` is given, the deposits are first checked against that
   * beacon node (see {@link checkExistingDeposits}): pubkeys with a pending
   * deposit to different withdrawal credentials are refused. For top-ups to
   * existing validators the signature is not checked and the withdrawal
   * credentials may be all zero instead of the expected ones.
   * The output of {@link Client.getDepositData} can be passed as `deposits`.
   *
   * @param payload - Deposit data including an array of validator deposit objects.
   * @param options - Optional `onSent` callback, called with each transaction
   *   hash as soon as it is broadcast.
   * @returns An array of transaction hashes, one per batch.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {UnsupportedChainError} If the chain has no batch deposit contract.
   * @throws {DepositConflictError} If `beaconUrl` is given and a pubkey has a
   *   pending deposit with different withdrawal credentials.
   * @throws If any deposit fails the checks above, or the beacon node check fails.
   * @throws {TransactionSubmissionError} If the call fails after a transaction
   *   was broadcast (`txHashes`, `pendingTxHash` and `cause` say what was sent).
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
   *   expectedWithdrawalAddress: "0xWithdrawalAddress...",
   * });
   * ```
   */
  async deposit(
    payload: EOADepositPayload,
    options?: WriteOptions,
  ): Promise<{ txHashes: string[] }> {
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

    await assertSignerChain(this.signer, this.chainId, 'deposit');

    await verifyDepositsBeforeSend(validatedPayload.deposits, {
      chainId: this.chainId,
      expectedWithdrawalAddress: validatedPayload.expectedWithdrawalAddress,
      skipSignatureVerification: validatedPayload.skipSignatureVerification,
      beaconUrl: validatedPayload.beaconUrl,
    });

    return await submitEOABatchDeposit({
      deposits: validatedPayload.deposits,
      batchDepositContractAddress: chainConfig.BATCH_DEPOSIT_CONTRACT.address,
      signer: this.signer,
      provider: this.provider,
      options,
    });
  }
}
