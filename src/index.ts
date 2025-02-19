import { ZeroAddress, type Provider, type Signer } from 'ethers';
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
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
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
  Incentives,
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
} from './splitHelpers.js';
import { isContractAvailable } from './utils.js';
export * from './types.js';
export * from './services.js';
export * from './verification/signature-validator.js';

/**
 * Obol sdk Client can be used for creating, managing and activating distributed validators.
 */
export class Client extends Base {
  private readonly signer: Signer | undefined;

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
  constructor(config: { baseUrl?: string; chainId?: number }, signer?: Signer) {
    super(config);
    this.signer = signer;
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
    distributorFee = 0,
    controllerAddress = ZeroAddress,
    recoveryAddress = ZeroAddress,
  }: RewardsSplitPayload): Promise<ClusterValidator> {
    // This method doesnt require T&C signature
    if (!this.signer) {
      throw new Error('Signer is required in createObolRewardsSplit');
    }

    validatePayload(
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
      this.signer.provider as Provider,
      CHAIN_CONFIGURATION[this.chainId].SPLITMAIN_ADDRESS.bytecode,
    );

    const checkMulticallAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].MULTICALL_ADDRESS.address,
      this.signer.provider as Provider,
      CHAIN_CONFIGURATION[this.chainId].MULTICALL_ADDRESS.bytecode,
    );

    const checkOWRFactoryAddress = await isContractAvailable(
      CHAIN_CONFIGURATION[this.chainId].OWR_FACTORY_ADDRESS.address,
      this.signer.provider as Provider,
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
      percentAllocation: ObolRAFSplit,
    };

    const copiedSplitRecipients = [...splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );

    const predictedSplitterAddress = await predictSplitterAddress({
      signer: this.signer,
      accounts,
      percentAllocations,
      chainId: this.chainId,
      distributorFee,
      controllerAddress,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as Provider,
    );

    const { withdrawal_address, fee_recipient_address } =
      await handleDeployOWRAndSplitter({
        signer: this.signer,
        isSplitterDeployed: !!isSplitterDeployed,
        predictedSplitterAddress,
        accounts,
        percentAllocations,
        principalRecipient,
        etherAmount,
        chainId: this.chainId,
        distributorFee,
        controllerAddress,
        recoveryAddress,
      });

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
    ObolRAFSplit = DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
    distributorFee = 0,
    controllerAddress = ZeroAddress,
  }: TotalSplitPayload): Promise<ClusterValidator> {
    // This method doesnt require T&C signature
    if (!this.signer) {
      throw new Error('Signer is required in createObolTotalSplit');
    }

    validatePayload(
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
      this.signer.provider as Provider,
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
      percentAllocation: ObolRAFSplit,
    };

    const copiedSplitRecipients = [...splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );
    const predictedSplitterAddress = await predictSplitterAddress({
      signer: this.signer,
      accounts,
      percentAllocations,
      chainId: this.chainId,
      distributorFee,
      controllerAddress,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as Provider,
    );

    if (!isSplitterDeployed) {
      const splitterAddress = await deploySplitterContract({
        signer: this.signer,
        accounts,
        percentAllocations,
        chainId: this.chainId,
        distributorFee,
        controllerAddress,
      });
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
    return await getOWRTranches({ owrAddress, signer });
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

    validatePayload(newCluster, definitionSchema);

    const clusterConfig: Partial<ClusterDefinition> = {
      ...newCluster,
      fork_version: this.fork_version,
      dkg_algorithm: DKG_ALGORITHM,
      version: CONFIG_VERSION,
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      threshold: Math.ceil((2 * newCluster.operators.length) / 3),
      num_validators: newCluster.validators.length,
      deposit_amounts: newCluster.deposit_amounts
        ? newCluster.deposit_amounts
        : ['32000000000'],
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

    validatePayload(operatorPayload, operatorPayloadSchema);

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
        { enr: operatorPayload.enr },
      );

      const operatorData: OperatorPayload = {
        ...operatorPayload,
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

  /**
   * @param address - Operator address
   * @returns {Promise<Incentives>} The matched incentives from DB
   * @throws On not found if address not found.
   */
  async getIncentivesByAddress(address: string): Promise<Incentives> {
    const incentives: Incentives = await this.request(
      `/${DEFAULT_BASE_VERSION}/address/incentives/:address/${address}`,
      {
        method: 'GET',
      },
    );
    return incentives;
  }
}
