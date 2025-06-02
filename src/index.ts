import { v4 as uuidv4 } from 'uuid';
import { Base } from './base.js';
import {
  CONFLICT_ERROR_MSG,
  CreatorConfigHashSigningTypes,
  Domain,
  DKG_ALGORITHM,
  CONFIG_VERSION,
  OperatorConfigHashSigningTypes,
  EnrSigningTypes,
  TERMS_AND_CONDITIONS_VERSION,
  TermsAndConditionsSigningTypes,
  DEFAULT_BASE_VERSION,
  TERMS_AND_CONDITIONS_HASH,
  AVAILABLE_SPLITTER_CHAINS,
  CHAIN_CONFIGURATION,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  OBOL_SDK_EMAIL,
} from './constants.js';
import { ConflictError } from './errors.js';
import {
  type RewardsSplitPayload,
  type ClusterDefinition,
  type ClusterLock,
  type ClusterPayload,
  type OperatorPayload,
  type TotalSplitPayload,
  type ClusterValidator,
  type ETH_ADDRESS,
  type OWRTranches,
  type ProviderType,
  type SignerType,
} from './types.js';
import { clusterConfigOrDefinitionHash } from './verification/common.js';
import { validatePayload } from './ajv.js';
import {
  definitionSchema,
  operatorPayloadSchema,
  rewardsSplitterPayloadSchema,
  totalSplitterPayloadSchema,
} from './schema.js';
import {
  deploySplitterContract,
  formatSplitRecipients,
  handleDeployOWRAndSplitter,
  predictSplitterAddress,
  getOWRTranches,
} from './splits/splitHelpers.js';
import { isContractAvailable } from './utils.js';
import { Incentives } from './incentives/incentives.js';
import { Exit } from './exits/exit.js';
export * from './types.js';
export * from './services.js';
export * from './verification/signature-validator.js';
export * from './verification/common.js';
export * from './constants.js';
export { Incentives } from './incentives/incentives.js';
export { Exit } from './exits/exit.js';

/**
 * Obol sdk Client can be used for creating, managing and activating distributed validators.
 */
export class Client extends Base {
  /**
   * The signer used for signing transactions.
   */
  private readonly signer: SignerType | undefined;

  /**
   * The incentives module, responsible for managing Obol tokens distribution.
   * @type {Incentives}
   */
  public incentives: Incentives;

  /**
   * The exit module, responsible for managing exit validation.
   * @type {Exit}
   */
  public exit: Exit;

  /**
   * The blockchain provider, used to interact with the network.
   * It can be null, undefined, or a valid provider instance and defaults to the Signer provider if Signer is passed.
   */
  public provider: ProviderType | undefined | null;

  /**
   * @param config - Client configurations
   * @param config.baseUrl - obol-api url
   * @param config.chainId - Blockchain network ID
   * @param signer - ethersJS Signer
   * @returns Obol-SDK Client instance
   *
   * An example of how to instantiate obol-sdk Client:
   * [obolClient](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L29)
   */
  constructor(
    config: { baseUrl?: string; chainId?: number },
    signer?: SignerType,
    provider?: ProviderType,
  ) {
    super(config);
    this.signer = signer;
    // Use the provided provider, or fall back to signer.provider if available
    this.provider =
      provider ??
      (signer && 'provider' in signer ? signer.provider : undefined);
    this.incentives = new Incentives(
      this.signer,
      this.chainId,
      this.request.bind(this),
      this.provider,
    );
    this.exit = new Exit(this.chainId, this.request.bind(this), this.provider);
  }

  /**
   * Accepts Obol terms and conditions to be able to create or update data.
   * @returns {Promise<string>} terms and conditions acceptance success message.
   * @throws On unverified signature or wrong hash.
   *
   * An example of how to use acceptObolLatestTermsAndConditions:
   * [acceptObolLatestTermsAndConditions](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L44)
   */
  async acceptObolLatestTermsAndConditions(): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer is required in acceptObolTermsAndConditions');
    }

    try {
      const termsAndConditionsHash = TERMS_AND_CONDITIONS_HASH;
      const address = await this.signer.getAddress();
      const termsAndConditionsPayload = {
        address,
        version: TERMS_AND_CONDITIONS_VERSION,
        terms_and_conditions_hash: termsAndConditionsHash,
        fork_version: this.fork_version,
      };

      const termsAndConditionsSignature = await this.signer.signTypedData(
        Domain(),
        TermsAndConditionsSigningTypes,
        {
          terms_and_conditions_hash: termsAndConditionsHash,
          version: TERMS_AND_CONDITIONS_VERSION,
        },
      );

      const termsAndConditionsResponse: { message: string; success: boolean } =
        await this.request(`/${DEFAULT_BASE_VERSION}/termsAndConditions`, {
          method: 'POST',
          body: JSON.stringify(termsAndConditionsPayload),
          headers: {
            Authorization: `Bearer ${termsAndConditionsSignature}`,
          },
        });
      return termsAndConditionsResponse?.message;
    } catch (err: any) {
      if (err?.message === CONFLICT_ERROR_MSG) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  /**
   * Deploys OWR and Splitter Proxy.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {RewardsSplitPayload} rewardsSplitPayload - Data needed to deploy owr and splitter.
   * @returns {Promise<ClusterValidator>} owr address as withdrawal address and splitter as fee recipient
   *
   * An example of how to use createObolRewardsSplit:
   * [createObolRewardsSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L141)
   */
  // add the example reference
  async createObolRewardsSplit({
    splitRecipients,
    principalRecipient,
    etherAmount,
    ObolRAFSplit = DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    distributorFee,
    controllerAddress,
    recoveryAddress,
  }: RewardsSplitPayload): Promise<ClusterValidator> {
    // This method doesnt require T&C signature
    if (!this.signer) {
      throw new Error('Signer is required in createObolRewardsSplit');
    }

    const validatedPayload = validatePayload<Required<RewardsSplitPayload>>(
      {
        splitRecipients,
        principalRecipient,
        etherAmount,
        ObolRAFSplit,
        distributorFee,
        controllerAddress,
        recoveryAddress,
      },
      rewardsSplitterPayloadSchema,
    );

    // Check if we allow splitters on this chainId
    if (!AVAILABLE_SPLITTER_CHAINS.includes(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    const checkSplitMainAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].SPLITMAIN_ADDRESS.address,
      this.signer.provider as ProviderType,
      CHAIN_CONFIGURATION[this.chainId].SPLITMAIN_ADDRESS.bytecode,
    );

    const checkMulticallAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].MULTICALL_ADDRESS.address,
      this.signer.provider as ProviderType,
      CHAIN_CONFIGURATION[this.chainId].MULTICALL_ADDRESS.bytecode,
    );

    const checkOWRFactoryAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].OWR_FACTORY_ADDRESS.address,
      this.signer.provider as ProviderType,
      CHAIN_CONFIGURATION[this.chainId].OWR_FACTORY_ADDRESS.bytecode,
    );

    if (
      !checkMulticallAddress ||
      !checkSplitMainAddress ||
      !checkOWRFactoryAddress
    ) {
      throw new Error(
        `Something isn not working as expected, check this issue with obol-sdk team on ${OBOL_SDK_EMAIL}`,
      );
    }

    const retroActiveFundingRecipient = {
      account:
        CHAIN_CONFIGURATION[this.chainId].RETROACTIVE_FUNDING_ADDRESS.address,
      percentAllocation: validatedPayload.ObolRAFSplit,
    };

    const copiedSplitRecipients = [...validatedPayload.splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );

    let predictedSplitterAddress: string;
    try {
      predictedSplitterAddress = await predictSplitterAddress({
        signer: this.signer,
        accounts,
        percentAllocations,
        chainId: this.chainId,
        distributorFee: validatedPayload.distributorFee,
        controllerAddress: validatedPayload.controllerAddress,
      });
    } catch (error: any) {
      throw new Error(
        `Failed to predict splitter address: ${error.message ?? 'Unknown error occurred while predicting splitter contract address'}`,
      );
    }

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as ProviderType,
    );

    let withdrawal_address: string;
    let fee_recipient_address: string;
    try {
      const result = await handleDeployOWRAndSplitter({
        signer: this.signer,
        isSplitterDeployed: !!isSplitterDeployed,
        predictedSplitterAddress,
        accounts,
        percentAllocations,
        principalRecipient: validatedPayload.principalRecipient,
        etherAmount: validatedPayload.etherAmount,
        chainId: this.chainId,
        distributorFee: validatedPayload.distributorFee,
        controllerAddress: validatedPayload.controllerAddress,
        recoveryAddress: validatedPayload.recoveryAddress,
      });
      withdrawal_address = result.withdrawal_address;
      fee_recipient_address = result.fee_recipient_address;
    } catch (error: any) {
      throw new Error(
        `Failed to deploy OWR and splitter contracts: ${error.message ?? 'Unknown error occurred during contract deployment'}`,
      );
    }

    return { withdrawal_address, fee_recipient_address };
  }

  /**
   * Deploys Splitter Proxy.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {TotalSplitPayload} totalSplitPayload - Data needed to deploy splitter if it doesnt exist.
   * @returns {Promise<ClusterValidator>} splitter address as withdrawal address and splitter as fee recipient too
   *
   * An example of how to use createObolTotalSplit:
   * [createObolTotalSplit](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L168)
   */
  // add the example reference
  async createObolTotalSplit({
    splitRecipients,
    ObolRAFSplit,
    distributorFee,
    controllerAddress,
  }: TotalSplitPayload): Promise<ClusterValidator> {
    // This method doesnt require T&C signature
    if (!this.signer) {
      throw new Error('Signer is required in createObolTotalSplit');
    }

    const validatedPayload = validatePayload<Required<TotalSplitPayload>>(
      {
        splitRecipients,
        ObolRAFSplit,
        distributorFee,
        controllerAddress,
      },
      totalSplitterPayloadSchema,
    );

    // Check if we allow splitters on this chainId
    if (!AVAILABLE_SPLITTER_CHAINS.includes(this.chainId)) {
      throw new Error(
        `Splitter configuration is not supported on ${this.chainId} chain`,
      );
    }

    const checkSplitMainAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].SPLITMAIN_ADDRESS.address,
      this.signer.provider as ProviderType,
      CHAIN_CONFIGURATION[this.chainId].SPLITMAIN_ADDRESS.bytecode,
    );

    if (!checkSplitMainAddress) {
      throw new Error(
        `Something isn not working as expected, check this issue with obol-sdk team on ${OBOL_SDK_EMAIL}`,
      );
    }

    const retroActiveFundingRecipient = {
      account:
        CHAIN_CONFIGURATION[this.chainId].RETROACTIVE_FUNDING_ADDRESS.address,
      percentAllocation: validatedPayload.ObolRAFSplit,
    };

    const copiedSplitRecipients = [...validatedPayload.splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );

    let predictedSplitterAddress: string;
    try {
      predictedSplitterAddress = await predictSplitterAddress({
        signer: this.signer,
        accounts,
        percentAllocations,
        chainId: this.chainId,
        distributorFee: validatedPayload.distributorFee,
        controllerAddress: validatedPayload.controllerAddress,
      });
    } catch (error: any) {
      throw new Error(
        `Failed to predict splitter address: ${error.message ?? 'Unknown error occurred while predicting splitter contract address'}`,
      );
    }

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as ProviderType,
    );

    if (!isSplitterDeployed) {
      let splitterAddress: string;
      try {
        splitterAddress = await deploySplitterContract({
          signer: this.signer,
          accounts,
          percentAllocations,
          chainId: this.chainId,
          distributorFee: validatedPayload.distributorFee,
          controllerAddress: validatedPayload.controllerAddress,
        });
      } catch (error: any) {
        throw new Error(
          `Failed to deploy splitter contract: ${error.message ?? 'Unknown error occurred during splitter contract deployment'}`,
        );
      }
      return {
        withdrawal_address: splitterAddress,
        fee_recipient_address: splitterAddress,
      };
    }

    return {
      withdrawal_address: predictedSplitterAddress,
      fee_recipient_address: predictedSplitterAddress,
    };
  }

  /**
   * Read OWR Tranches.
   *
   * @remarks
   * **⚠️ Important:**  If you're storing the private key in an `.env` file, ensure it is securely managed
   * and not pushed to version control.
   *
   * @param {ETH_ADDRESS} owrAddress - Address of the Deployed OWR Contract
   * @returns {Promise<OWRTranches>} owr tranch information about principal and reward reciepient, as well as the principal amount
   *
   */
  async getOWRTranches(owrAddress: ETH_ADDRESS): Promise<OWRTranches> {
    if (!this.signer) {
      throw new Error('Signer is required in getOWRTranches');
    }

    const signer = this.signer;
    try {
      return await getOWRTranches({ owrAddress, signer });
    } catch (error: any) {
      throw new Error(
        `Failed to retrieve OWR tranches for address ${owrAddress}: ${error.message ?? 'Unknown error occurred while fetching OWR tranche information'}`,
      );
    }
  }

  /**
   * Creates a cluster definition which contains cluster configuration.
   * @param {ClusterPayload} newCluster - The new unique cluster.
   * @returns {Promise<string>} config_hash.
   * @throws On duplicate entries, missing or wrong cluster keys.
   *
   * An example of how to use createClusterDefinition:
   * [createObolCluster](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L59)
   */
  async createClusterDefinition(newCluster: ClusterPayload): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer is required in createClusterDefinition');
    }

    const validatedCluster = validatePayload<ClusterPayload>(
      newCluster,
      definitionSchema,
    );

    const clusterConfig: Partial<ClusterDefinition> = {
      ...validatedCluster,
      fork_version: this.fork_version,
      dkg_algorithm: DKG_ALGORITHM,
      version: CONFIG_VERSION,
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      threshold: Math.ceil((2 * validatedCluster.operators.length) / 3),
      num_validators: validatedCluster.validators.length,
    };
    try {
      const address = await this.signer.getAddress();

      clusterConfig.creator = { address };
      clusterConfig.config_hash = clusterConfigOrDefinitionHash(
        clusterConfig as ClusterDefinition,
        true,
      );

      const creatorConfigSignature = await this.signer.signTypedData(
        Domain(this.chainId),
        CreatorConfigHashSigningTypes,
        { creator_config_hash: clusterConfig.config_hash },
      );

      const clusterDefinition: ClusterDefinition = await this.request(
        `/${DEFAULT_BASE_VERSION}/definition`,
        {
          method: 'POST',
          body: JSON.stringify(clusterConfig),
          headers: {
            Authorization: `Bearer ${creatorConfigSignature}`,
            'fork-version': this.fork_version,
          },
        },
      );
      return clusterDefinition?.config_hash;
    } catch (err: any) {
      if (err?.message === CONFLICT_ERROR_MSG) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  /**
   * Approves joining a cluster with specific configuration.
   * @param {OperatorPayload} operatorPayload - The operator data including signatures.
   * @param {string} configHash - The config hash of the cluster which the operator confirms joining to.
   * @returns {Promise<ClusterDefinition>} The cluster definition.
   * @throws On unauthorized, duplicate entries, missing keys, not found cluster or invalid data.
   *
   * An example of how to use acceptClusterDefinition:
   * [acceptClusterDefinition](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L106)
   */
  async acceptClusterDefinition(
    operatorPayload: OperatorPayload,
    configHash: string,
  ): Promise<ClusterDefinition> {
    if (!this.signer) {
      throw new Error('Signer is required in acceptClusterDefinition');
    }

    const validatedPayload = validatePayload<OperatorPayload>(
      operatorPayload,
      operatorPayloadSchema,
    );

    try {
      const address = await this.signer.getAddress();

      const operatorConfigSignature = await this.signer.signTypedData(
        Domain(this.chainId),
        OperatorConfigHashSigningTypes,
        { operator_config_hash: configHash },
      );
      const operatorENRSignature = await this.signer.signTypedData(
        Domain(this.chainId),
        EnrSigningTypes,
        { enr: validatedPayload.enr },
      );

      const operatorData: OperatorPayload = {
        ...validatedPayload,
        address,
        enr_signature: operatorENRSignature,
        fork_version: this.fork_version,
      };
      const clusterDefinition: ClusterDefinition = await this.request(
        `/${DEFAULT_BASE_VERSION}/definition/${configHash}`,
        {
          method: 'PUT',
          body: JSON.stringify(operatorData),
          headers: {
            Authorization: `Bearer ${operatorConfigSignature}`,
          },
        },
      );
      return clusterDefinition;
    } catch (err: any) {
      throw err;
    }
  }

  /**
   * @param configHash - The configuration hash returned in createClusterDefinition
   * @returns {Promise<ClusterDefinition>} The  cluster definition for config hash
   * @throws On not found config hash.
   *
   * An example of how to use getClusterDefinition:
   * [getObolClusterDefinition](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L74)
   */
  async getClusterDefinition(configHash: string): Promise<ClusterDefinition> {
    const clusterDefinition: ClusterDefinition = await this.request(
      `/${DEFAULT_BASE_VERSION}/definition/${configHash}`,
      {
        method: 'GET',
      },
    );

    return clusterDefinition;
  }

  /**
   * @param configHash - The configuration hash in cluster-definition
   * @returns {Promise<ClusterLock>} The matched cluster details (lock) from DB
   * @throws On not found cluster definition or lock.
   *
   * An example of how to use getClusterLock:
   * [getObolClusterLock](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L89)
   */
  async getClusterLock(configHash: string): Promise<ClusterLock> {
    const lock: ClusterLock = await this.request(
      `/${DEFAULT_BASE_VERSION}/lock/configHash/${configHash}`,
      {
        method: 'GET',
      },
    );
    return lock;
  }
}
