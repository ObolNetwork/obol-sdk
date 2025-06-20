import { isContractAvailable } from '../utils';
import {
  type ClusterValidator,
  type ProviderType,
  type SignerType,
  type TotalSplitPayload,
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type OVMArgs,
  type SplitV2Recipient,
  type OVMAndSplitV2Result,
} from '../types';
import {
  deploySplitterContract,
  formatSplitRecipients,
  predictSplitterAddress,
  formatRecipientsForSplitV2,
  predictSplitV2Address,
  isSplitV2Deployed,
  deployOVMContract,
  deployImmutableSplitV2,
} from './splitHelpers';
import {
  AVAILABLE_SPLITTER_CHAINS,
  CHAIN_CONFIGURATION,
  SPLITS_V2_SALT,
  PRINCIPAL_THRESHOLD,
} from '../constants';
import {
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
} from '../schema';
import { validatePayload } from '../ajv';

/**
 * ObolSplits can be used for creating and managing Obol splits.
 * @class
 * @internal Access it through Client.splits.
 * @example
 * const obolClient = new Client(config);
 * await obolClient.splits.createObolOVMAndPullSplit(splitPayload);
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
   * An example of how to use createObolOVMAndPullSplit:
   * [createObolOVMAndPullSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L141)
   */
  async createObolOVMAndPullSplit({
    splitRecipients,
    ownerAddress,
    principalRecipient,
    principalThreshold = PRINCIPAL_THRESHOLD,
    distributorFeePercent = 0, // Default defined in schema
  }: OVMRewardsSplitPayload): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new Error('Signer is required in createObolOVMAndPullSplit');
    }

    // Validate payload using schema
    const validatedPayload = validatePayload<Required<OVMRewardsSplitPayload>>(
      {
        splitRecipients,
        ownerAddress,
        principalRecipient,
        principalThreshold,
        distributorFeePercent,
      },
      ovmRewardsSplitPayloadSchema,
    );

    // Check if we allow splitters on this chainId
    if (!AVAILABLE_SPLITTER_CHAINS.includes(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    const checkOVMFactoryAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].OVM_FACTORY_ADDRESS?.address || '',
      this.provider as ProviderType,
    );

    if (!checkOVMFactoryAddress) {
      throw new Error('Required contracts are not deployed on this chain');
    }
    // Format recipients for SplitV2
    const recipients = formatRecipientsForSplitV2(validatedPayload.splitRecipients);

    // Predict split address
    const predictedSplitAddress = await predictSplitV2Address({
      recipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    // Check if split is already deployed
    const isSplitterDeployed = await isSplitV2Deployed({
      recipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
    });

    if (isSplitterDeployed) {
      // Only deploy OVM contract
      const ovmAddress = await deployOVMContract({
        ownerAddress: validatedPayload.ownerAddress,
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
      const { ovmAddress, splitAddress } = await deployImmutableSplitV2({
        ovmArgs: {
          ownerAddress: validatedPayload.ownerAddress,
          rewardRecipient: predictedSplitAddress,
          principalRecipient: validatedPayload.principalRecipient,
          principalThreshold: validatedPayload.principalThreshold,
        },
        recipients,
        predictedSplitAddress,
        distributorFeePercent: validatedPayload.distributorFeePercent,
        salt,
        signer: this.signer,
        chainId: this.chainId,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: splitAddress,
      };
    }
  }
} 