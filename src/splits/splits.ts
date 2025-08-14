import {
  formatRecipientsForSplitV2,
  predictSplitV2Address,
  isSplitV2Deployed,
  deployOVMContract,
  deployOVMAndSplitV2,
  requestWithdrawalFromOVM,
  depositToOVMWithMulticall,
} from './splitHelpers';
import {
  CHAIN_CONFIGURATION,
  SPLITS_V2_SALT,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  isChainSupportedForSplitters,
} from '../constants';
import {
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
  ovmRequestWithdrawalPayloadSchema,
  ovmDepositPayloadSchema,
} from '../schema';
import { validatePayload } from '../ajv';
import { isContractAvailable } from '../utils';
import {
  type ClusterValidator,
  type ProviderType,
  type SignerType,
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type OVMRequestWithdrawalPayload,
  type OVMDepositPayload,
} from '../types';

/**
 * ObolSplits can be used for creating and managing Obol splits.
 * @class
 * @internal Access it through Client.splits.
 * @example
 * const obolClient = new Client(config);
 * await obolClient.splits.createValidatorManagerAndRewardsSplit(OVMRewardsSplitPayload);
 */
export class ObolSplits {
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
   * Creates an Obol OVM and Pull split configuration for rewards-only scenario.
   *
   * This method deploys OVM and SplitV2 contracts for managing validator rewards only.
   * Principal is handled by a single address, while rewards are split among recipients.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {OVMRewardsSplitPayload} payload - Data needed to deploy OVM and SplitV2
   * @returns {Promise<ClusterValidator>} OVM address as withdrawal address and splitter as fee recipient
   * @throws Will throw an error if the splitter configuration is not supported or deployment fails
   *
   * An example of how to use createValidatorManagerAndRewardsSplit:
   * [createValidatorManagerAndRewardsSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L333)
   */
  async createValidatorManagerAndRewardsSplit(
    payload: OVMRewardsSplitPayload,
  ): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new Error(
        'Signer is required in createValidatorManagerAndRewardsSplit',
      );
    }

    const validatedPayload = validatePayload<Required<OVMRewardsSplitPayload>>(
      payload,
      ovmRewardsSplitPayloadSchema,
    );

    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.OVM_FACTORY_CONTRACT) {
      throw new Error(
        `OVM contract factory is not configured for chain ${this.chainId}`,
      );
    }

    if (!this.provider) {
      throw new Error(
        'Provider is required to check OVM factory contract availability',
      );
    }
    const ovmFactoryConfig = chainConfig.OVM_FACTORY_CONTRACT;
    const splitV2FactoryConfig = chainConfig.SPLIT_V2_FACTORY_CONTRACT;
    const multiCallConfig = chainConfig.MULTICALL_CONTRACT;

    if (
      !ovmFactoryConfig?.address ||
      !ovmFactoryConfig?.bytecode ||
      !splitV2FactoryConfig?.address ||
      !splitV2FactoryConfig?.bytecode ||
      !multiCallConfig?.address ||
      !multiCallConfig?.bytecode
    ) {
      throw new Error(
        `Contracts configuration is incomplete for chain ${this.chainId}`,
      );
    }

    const checkOVMFactoryContract = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    const checkSplitV2FactoryContract = await isContractAvailable(
      splitV2FactoryConfig.address,
      this.provider,
      splitV2FactoryConfig.bytecode,
    );

    const checkMultiCallContract = await isContractAvailable(
      multiCallConfig.address,
      this.provider,
      multiCallConfig.bytecode,
    );

    if (
      !checkOVMFactoryContract ||
      !checkSplitV2FactoryContract ||
      !checkMultiCallContract
    ) {
      throw new Error(
        `Splitter contract is not deployed or available on chain ${this.chainId}`,
      );
    }

    const retroActiveFundingRecipient = {
      address: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [
      ...validatedPayload.rewardSplitRecipients,
    ];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    // Format recipients for SplitV2
    const rewardRecipients = formatRecipientsForSplitV2(
      copiedRewardsSplitRecipients,
    );

    const predictedSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    const isRewardSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    if (isRewardSplitterDeployed) {
      const ovmAddress = await deployOVMContract({
        OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
        principalRecipient: validatedPayload.principalRecipient,
        rewardRecipient: predictedSplitAddress,
        principalThreshold: validatedPayload.principalThreshold,
        signer: this.signer,
        chainId: this.chainId,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedSplitAddress,
      };
    } else {
      const ovmAddress = await deployOVMAndSplitV2({
        ovmArgs: {
          OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
          rewardRecipient: predictedSplitAddress,
          principalRecipient: validatedPayload.principalRecipient,
          principalThreshold: validatedPayload.principalThreshold,
        },
        rewardRecipients,
        isRewardsSplitterDeployed: isRewardSplitterDeployed,
        distributorFeePercent: validatedPayload.distributorFeePercent,
        salt,
        signer: this.signer,
        chainId: this.chainId,
        splitOwnerAddress: validatedPayload.splitOwnerAddress,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedSplitAddress,
      };
    }
  }

  /**
   * Creates an Obol OVM and Total split configuration for total split scenario.
   *
   * This method deploys OVM and SplitV2 contracts for managing both validator rewards and principal.
   * Both rewards and principal are split among recipients, with rewards including RAF recipient.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {OVMTotalSplitPayload} payload - Data needed to deploy OVM and SplitV2
   * @returns {Promise<ClusterValidator>} OVM address as withdrawal address and splitter as fee recipient
   * @throws Will throw an error if the splitter configuration is not supported or deployment fails
   *
   * An example of how to use createValidatorManagerAndTotalSplit:
   * [createValidatorManagerAndTotalSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#340)
   */
  async createValidatorManagerAndTotalSplit(
    payload: OVMTotalSplitPayload,
  ): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new Error(
        'Signer is required in createValidatorManagerAndTotalSplit',
      );
    }

    const validatedPayload = validatePayload<Required<OVMTotalSplitPayload>>(
      payload,
      ovmTotalSplitPayloadSchema,
    );

    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.OVM_FACTORY_CONTRACT) {
      throw new Error(
        `OVM contract factory is not configured for chain ${this.chainId}`,
      );
    }

    if (!this.provider) {
      throw new Error(
        'Provider is required to check OVM factory contract availability',
      );
    }

    const ovmFactoryConfig = chainConfig.OVM_FACTORY_CONTRACT;
    const splitV2FactoryConfig = chainConfig.SPLIT_V2_FACTORY_CONTRACT;
    const multiCallConfig = chainConfig.MULTICALL_CONTRACT;

    if (
      !ovmFactoryConfig?.address ||
      !ovmFactoryConfig?.bytecode ||
      !splitV2FactoryConfig?.address ||
      !splitV2FactoryConfig?.bytecode ||
      !multiCallConfig?.address ||
      !multiCallConfig?.bytecode
    ) {
      throw new Error(
        `Contracts configuration is incomplete for chain ${this.chainId}`,
      );
    }

    const checkOVMFactoryContract = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    const checkSplitV2FactoryContract = await isContractAvailable(
      splitV2FactoryConfig.address,
      this.provider,
      splitV2FactoryConfig.bytecode,
    );

    const checkMultiCallContract = await isContractAvailable(
      multiCallConfig.address,
      this.provider,
      multiCallConfig.bytecode,
    );

    if (
      !checkOVMFactoryContract ||
      !checkSplitV2FactoryContract ||
      !checkMultiCallContract
    ) {
      throw new Error(
        `Splitter contract is not deployed or available on chain ${this.chainId}`,
      );
    }

    const retroActiveFundingRecipient = {
      address: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [
      ...validatedPayload.rewardSplitRecipients,
    ];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    const rewardsRecipients = formatRecipientsForSplitV2(
      copiedRewardsSplitRecipients,
    );

    const principalSplitRecipients = formatRecipientsForSplitV2(
      validatedPayload.principalSplitRecipients,
    );

    const predictedRewardsSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    const predictedPrincipalSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    const isRewardsSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    const isPrincipalSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    if (isRewardsSplitterDeployed && isPrincipalSplitterDeployed) {
      const ovmAddress = await deployOVMContract({
        OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
        principalRecipient: predictedPrincipalSplitAddress,
        rewardRecipient: predictedRewardsSplitAddress,
        principalThreshold: validatedPayload.principalThreshold,
        signer: this.signer,
        chainId: this.chainId,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedRewardsSplitAddress,
      };
    } else {
      // Use multicall to deploy any contracts that aren't deployed
      const ovmAddress = await deployOVMAndSplitV2({
        ovmArgs: {
          OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
          rewardRecipient: predictedRewardsSplitAddress,
          principalRecipient: predictedPrincipalSplitAddress,
          principalThreshold: validatedPayload.principalThreshold,
        },
        rewardRecipients: rewardsRecipients,
        distributorFeePercent: validatedPayload.distributorFeePercent,
        salt,
        signer: this.signer,
        chainId: this.chainId,
        principalSplitRecipients,
        isPrincipalSplitDeployed: isPrincipalSplitterDeployed,
        splitOwnerAddress: validatedPayload.splitOwnerAddress,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedRewardsSplitAddress,
      };
    }
  }

  /**
   * Requests withdrawal from an OVM contract.
   *
   * This method allows requesting withdrawal of validator funds from an OVM contract.
   * The withdrawal request includes OVM address, validator public keys and corresponding withdrawal amounts.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {OVMRequestWithdrawalPayload} payload - Data needed to request withdrawal
   * @returns {Promise<{txHash: string}>} Transaction hash of the withdrawal request
   * @throws Will throw an error if the signer is not provided, OVM address is invalid, or the request fails
   *
   * An example of how to use requestWithdrawal:
   * ```typescript
   * const result = await client.splits.requestWithdrawal({
   *   ovmAddress: '0x1234567890123456789012345678901234567890',
   *   pubKeys: ['0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456'],
   *   amounts: ['32000000000'] // 32 ETH in gwei
   * });
   * console.log('Withdrawal requested:', result.txHash);
   * ```
   */
  async requestWithdrawal(
    payload: OVMRequestWithdrawalPayload,
  ): Promise<{ txHash: string }> {
    if (!this.signer) {
      throw new Error('Signer is required in requestWithdrawal');
    }
    // [TBD] need to move ovm verification to sdk method and use it here
    const validatedPayload = validatePayload<OVMRequestWithdrawalPayload>(
      payload,
      ovmRequestWithdrawalPayloadSchema,
    );

    return await requestWithdrawalFromOVM({
      ovmAddress: validatedPayload.ovmAddress,
      pubKeys: validatedPayload.pubKeys,
      amounts: validatedPayload.amounts,
      withdrawalFees: validatedPayload.withdrawalFees,
      signer: this.signer,
    });
  }

  /**
   * Deposits to OVM contract using multicall for batch operations.
   *
   * This method allows depositing to an OVM contract using multicall for efficient batch processing.
   * Each deposit includes validator public key, withdrawal credentials, signature, deposit data root, and amount.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {OVMDepositPayload} payload - Data needed to deposit to OVM
   * @returns {Promise<{txHashes: string[]}>} Array of transaction hashes for all batches
   * @throws Will throw an error if the signer is not provided, OVM address is invalid, or the deposit fails
   *
   * An example of how to use depositToOVM:
   * ```typescript
   * const result = await client.splits.depositToOVM({
   *   ovmAddress: '0x1234567890123456789012345678901234567890',
   *   deposits: [{
   *     pubkey: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
   *     withdrawal_credentials: '0x1234567890123456789012345678901234567890',
   *     signature: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
   *     deposit_data_root: '0x1234567890123456789012345678901234567890123456789012345678901234',
   *     amount: '32000000000000000000' // 32 ETH in wei
   *   }]
   * });
   * console.log('Deposits completed:', result.txHashes);
   * ```
   */
  async depositToOVM(
    payload: OVMDepositPayload,
  ): Promise<{ txHashes: string[] }> {
    if (!this.signer) {
      throw new Error('Signer is required in depositToOVM');
    }

    const validatedPayload = validatePayload<OVMDepositPayload>(
      payload,
      ovmDepositPayloadSchema,
    );

    return await depositToOVMWithMulticall({
      ovmAddress: validatedPayload.ovmAddress,
      deposits: validatedPayload.deposits,
      signer: this.signer,
      chainId: this.chainId,
    });
  }
}
