import {
  submitEOAWithdrawalRequest,
  submitEOABatchDeposit,
} from './eoaHelpers';
import { validatePayload } from '../ajv';
import { eoaWithdrawalPayloadSchema, eoaDepositPayloadSchema } from '../schema';
import { CHAIN_CONFIGURATION } from '../constants';
import {
  type ProviderType,
  type SignerType,
  type EOAWithdrawalPayload,
  type EOADepositPayload,
} from '../types';

/**
 * EOA can be used for managing EOA (Externally Owned Account) operations like withdrawals.
 * @class
 * @internal Access it through Client.eoa.
 * @example
 * const obolClient = new Client(config);
 * await obolClient.eoa.requestWithdrawal(EOAWithdrawalPayload);
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
   * Requests withdrawal from an EOA contract.
   *
   * This method allows requesting withdrawal of validator funds.
   * The withdrawal request includes validator public key and corresponding withdrawal amount.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {EOAWithdrawalPayload} payload - Data needed to request withdrawal
   * @returns {Promise<{txHash: string}>} Transaction hash of the withdrawal request
   * @throws Will throw an error if the signer is not provided or the request fails
   *
   * An example of how to use requestWithdrawal:
   * ```typescript
   * const result = await client.eoa.requestWithdrawal({
   *   pubkey: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
   *   allocation: 32, // 32 ETH
   *   requiredFee: '1' // in wei
   * });
   * console.log('Withdrawal requested:', result.txHash);
   * ```
   */
  async requestWithdrawal(
    payload: EOAWithdrawalPayload,
  ): Promise<{ txHash: string | null }> {
    if (!this.signer) {
      throw new Error('Signer is required in requestWithdrawal');
    }

    if (!this.provider) {
      throw new Error('Provider is required in requestWithdrawal');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.EOA_WITHDRAWAL_CONTRACT?.address) {
      throw new Error(
        `EOA withdrawal contract is not configured for chain ${this.chainId}`,
      );
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
      provider: this.provider,
    });
  }

  /**
   * Deposits to batch deposit contract.
   *
   * This method allows depositing multiple validators to the Ethereum beacon chain
   * using the Pier Two batch deposit contract for gas efficiency.
   * Each deposit includes validator public key, withdrawal credentials, signature, and amount.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * **⚠️ Gas Limit:** Due to EVM constraints, it is recommended to deposit in batches of up to 500 at a time.
   *
   * @param {EOADepositPayload} payload - Data needed to deposit to batch contract
   * @returns {Promise<{txHashes: string[]}>} Array of transaction hashes for all batches
   * @throws Will throw an error if the signer is not provided, contract is not configured, or the deposit fails
   *
   * An example of how to use deposit:
   * ```typescript
   * const result = await client.eoa.deposit({
   *   deposits: [{
   *     pubKey: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
   *     withdrawalCredentials: '0x1234567890123456789012345678901234567890',
   *     signature: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
   *     amount: '32000000000000000000' // 32 ETH in wei
   *   }]
   * });
   * console.log('Deposits completed:', result.txHashes);
   * ```
   */
  async deposit(
    payload: EOADepositPayload,
  ): Promise<{ txHashes: string[] }> {
    if (!this.signer) {
      throw new Error('Signer is required in deposit');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.BATCH_DEPOSIT_CONTRACT?.address) {
      throw new Error(
        `Batch deposit contract is not configured for chain ${this.chainId}`,
      );
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
