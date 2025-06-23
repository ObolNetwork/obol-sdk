import {
  formatRecipientsForSplitV2,
  predictSplitV2Address,
  isSplitV2Deployed,
  deployOVMContract,
  deployOVMAndSplitV2,
} from './splitHelpers';
import {
  AVAILABLE_SPLITTER_CHAINS,
  CHAIN_CONFIGURATION,
  SPLITS_V2_SALT,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
} from '../constants';
import {
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
} from '../schema';
import { validatePayload } from '../ajv';
import { isContractAvailable } from '../utils';
import {
  type ClusterValidator,
  type ProviderType,
  type SignerType,
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
} from '../types';

/**
 * ObolSplits can be used for creating and managing Obol splits.
 * @class
 * @internal Access it through Client.splits.
 * @example
 * const obolClient = new Client(config);
 * await obolClient.splits.createObolOVMAndRewardPullSplit(OVMRewardsSplitPayload);
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
   * An example of how to use createObolOVMAndRewardPullSplit:
   * [createObolOVMAndRewardPullSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L333)
   */
  async createObolOVMAndRewardPullSplit(payload: OVMRewardsSplitPayload): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new Error('Signer is required in createObolOVMAndRewardPullSplit');
    }

    // Validate payload using schema
    const validatedPayload = validatePayload<Required<OVMRewardsSplitPayload>>(
      payload,
      ovmRewardsSplitPayloadSchema,
    );

    // Check if we allow splitters on this chainId
    if (!AVAILABLE_SPLITTER_CHAINS.includes(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    // Check if OVM contract factory is configured for this chain
    if (!CHAIN_CONFIGURATION[this.chainId].OVM_FACTORY_ADDRESS) {
      throw new Error(
        `OVM contract factory is not configured for chain ${this.chainId}`,
      );
    }

    // Check if OVM factory contract is actually deployed and available
    if (!this.provider) {
      throw new Error('Provider is required to check OVM factory contract availability');
    }

    const ovmFactoryConfig = CHAIN_CONFIGURATION[this.chainId].OVM_FACTORY_ADDRESS;
    if (!ovmFactoryConfig?.address || !ovmFactoryConfig?.bytecode) {
      throw new Error(
        `OVM factory contract configuration is incomplete for chain ${this.chainId}`,
      );
    }

    const checkOVMFactoryAddress = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    if (!checkOVMFactoryAddress) {
      throw new Error(
        `OVM factory contract is not deployed or available on chain ${this.chainId}`,
      );
    }

    // Add retroactive funding recipient to split recipients
    const retroActiveFundingRecipient = {
      address: CHAIN_CONFIGURATION[this.chainId].RETROACTIVE_FUNDING_ADDRESS?.address || '',
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [...validatedPayload.rewardSplitRecipients];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    // Format recipients for SplitV2
    const rewardRecipients = formatRecipientsForSplitV2(copiedRewardsSplitRecipients);

    // Predict split address
    const predictedSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    // Check if split is already deployed
    const isRewardSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    if (isRewardSplitterDeployed) {
      // Only deploy OVM contract
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
      // Deploy both OVM and SplitV2 contracts via multicall
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
   * An example of how to use createObolOVMAndTotalPullSplit:
   * [createObolOVMAndTotalPullSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#340)
   */
  async createObolOVMAndTotalPullSplit(payload: OVMTotalSplitPayload): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new Error('Signer is required in createObolOVMAndTotalPullSplit');
    }

    // Validate payload using schema
    const validatedPayload = validatePayload<Required<OVMTotalSplitPayload>>(
      payload,
      ovmTotalSplitPayloadSchema,
    );

    // Check if we allow splitters on this chainId
    if (!AVAILABLE_SPLITTER_CHAINS.includes(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    // Check if OVM contract factory is configured for this chain
    if (!CHAIN_CONFIGURATION[this.chainId].OVM_FACTORY_ADDRESS) {
      throw new Error(
        `OVM contract factory is not configured for chain ${this.chainId}`,
      );
    }

    // Check if OVM factory contract is actually deployed and available
    if (!this.provider) {
      throw new Error('Provider is required to check OVM factory contract availability');
    }

    const ovmFactoryConfig = CHAIN_CONFIGURATION[this.chainId].OVM_FACTORY_ADDRESS;
    if (!ovmFactoryConfig?.address || !ovmFactoryConfig?.bytecode) {
      throw new Error(
        `OVM factory contract configuration is incomplete for chain ${this.chainId}`,
      );
    }

    const checkOVMFactoryAddress = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    if (!checkOVMFactoryAddress) {
      throw new Error(
        `OVM factory contract is not deployed or available on chain ${this.chainId}`,
      );
    }

    // Add retroactive funding recipient to rewards split recipients
    const retroActiveFundingRecipient = {
      address: CHAIN_CONFIGURATION[this.chainId].RETROACTIVE_FUNDING_ADDRESS.address,
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [...validatedPayload.rewardSplitRecipients];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    // Format recipients for rewards SplitV2
    const rewardsRecipients = formatRecipientsForSplitV2(copiedRewardsSplitRecipients);

    // Format recipients for principal SplitV2 (no RAF recipient)
    const principalSplitRecipients = formatRecipientsForSplitV2(validatedPayload.principalSplitRecipients);

    // Predict rewards split address
    const predictedRewardsSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    // Predict principal split address
    const predictedPrincipalSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt: salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    // Check if rewards split is already deployed
    const isRewardsSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    // Check if principal split is already deployed
    const isPrincipalSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt: salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    if (isRewardsSplitterDeployed && isPrincipalSplitterDeployed) {
      // Only deploy OVM contract
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
        principalSplitRecipients: principalSplitRecipients,
        isPrincipalSplitDeployed: isPrincipalSplitterDeployed,
        splitOwnerAddress: validatedPayload.splitOwnerAddress,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedRewardsSplitAddress,
      };
    }
  }
} 