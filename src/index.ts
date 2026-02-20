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
  CHAIN_CONFIGURATION,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  OBOL_SDK_EMAIL,
  isChainSupportedForSplitters,
} from './constants.js';
import {
  ConflictError,
  SignerRequiredError,
  UnsupportedChainError,
} from './errors.js';
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
import { ObolSplits } from './splits/splits.js';
import { EOA } from './eoa/eoa.js';
export * from './types.js';
export * from './services.js';
export * from './verification/signature-validator.js';
export * from './verification/common.js';
export * from './constants.js';
export {
  ConflictError,
  SignerRequiredError,
  UnsupportedChainError,
} from './errors.js';
export { Incentives } from './incentives/incentives.js';
export { Exit } from './exits/exit.js';
export { ObolSplits } from './splits/splits.js';
export { EOA } from './eoa/eoa.js';

/**
 * Primary entrypoint for the Obol SDK. Use this class to create, manage,
 * and activate Distributed Validators via the Obol API.
 *
 * All operations are namespaced under the client instance:
 * - `client.incentives.*`  – claim and query Obol incentives
 * - `client.exit.*`        – validate and recombine voluntary exit signatures
 * - `client.splits.*`      – deploy OVM / SplitV2 reward-splitting contracts
 * - `client.eoa.*`         – EOA withdrawals and batch deposits
 *
 * Cluster lifecycle helpers live directly on the client:
 * - {@link Client.acceptObolLatestTermsAndConditions}
 * - {@link Client.createClusterDefinition}
 * - {@link Client.acceptClusterDefinition}
 * - {@link Client.getClusterDefinition}
 * - {@link Client.getClusterLock}
 * - {@link Client.getClusterLockByHash}
 * - {@link Client.createObolRewardsSplit}
 * - {@link Client.createObolTotalSplit}
 * - {@link Client.getOWRTranches}
 *
 * Supported networks (by `chainId`): Mainnet (1), Holesky (17000),
 * Hoodi (560048), Gnosis (100), Sepolia (11155111).
 *
 * @example
 * ```typescript
 * import { Client } from "@obolnetwork/obol-sdk";
 * import { Wallet } from "ethers";
 *
 * const signer = new Wallet(process.env.PRIVATE_KEY!);
 * const client = new Client({ chainId: 17000 }, signer);
 *
 * // 1. Accept terms (required once before creating/updating data)
 * await client.acceptObolLatestTermsAndConditions();
 *
 * // 2. Create a cluster definition
 * const configHash = await client.createClusterDefinition({
 *   name: "my-cluster",
 *   operators: [{ address: "0x..." }],
 *   validators: [{
 *     fee_recipient_address: "0x...",
 *     withdrawal_address: "0x...",
 *   }],
 * });
 *
 * // 3. Retrieve the definition
 * const def = await client.getClusterDefinition(configHash);
 * ```
 */
export class Client extends Base {
  private readonly signer: SignerType | undefined;

  /**
   * Incentives module – claim and query Obol incentive rewards.
   *
   * @see {@link Incentives}
   */
  public incentives: Incentives;

  /**
   * Exit module – verify partial exit signatures and recombine exit blobs
   * for distributed validator voluntary exits.
   *
   * @see {@link Exit}
   */
  public exit: Exit;

  /**
   * Splits module – deploy OVM and SplitV2 contracts for reward/principal
   * splitting, request withdrawals, and deposit to OVM contracts.
   *
   * @see {@link ObolSplits}
   */
  public splits: ObolSplits;

  /**
   * EOA module – request withdrawals and batch-deposit validators
   * via Externally Owned Account contracts.
   *
   * @see {@link EOA}
   */
  public eoa: EOA;

  /**
   * The blockchain provider used for on-chain reads.
   * Defaults to `signer.provider` when a signer is supplied.
   */
  public provider: ProviderType | undefined | null;

  /**
   * Creates a new Obol SDK client.
   *
   * @param config - Client configuration object.
   * @param config.baseUrl - Obol API base URL. Defaults to `https://api.obol.tech`.
   * @param config.chainId - Target chain ID. Defaults to `17000` (Holesky).
   *   Supported: 1 (Mainnet), 17000 (Holesky), 560048 (Hoodi), 100 (Gnosis), 11155111 (Sepolia).
   * @param signer - An ethers `Wallet` or `JsonRpcSigner`. Required for any
   *   write operation (creating clusters, deploying splits, claiming incentives).
   *   Read-only operations (`getClusterDefinition`, `getClusterLock`) work without a signer.
   * @param provider - An ethers `Provider`. If omitted, falls back to `signer.provider`.
   *
   * @example
   * ```typescript
   * // Minimal read-only client (no signer)
   * const readClient = new Client({ chainId: 1 });
   * const def = await readClient.getClusterDefinition(configHash);
   *
   * // Full client with signer for write operations
   * const client = new Client({ chainId: 17000 }, signer);
   * ```
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
    this.exit = new Exit(this.chainId, this.provider);
    this.splits = new ObolSplits(this.signer, this.chainId, this.provider);
    this.eoa = new EOA(this.signer, this.chainId, this.provider);
  }

  /**
   * Accepts the latest Obol terms and conditions.
   *
   * **Must be called once** before any write operation
   * (`createClusterDefinition`, `acceptClusterDefinition`, etc.).
   * Calling it again after acceptance throws a {@link ConflictError}.
   *
   * - Requires a `signer` to be provided at client construction.
   * - Signs an EIP-712 typed-data message; no on-chain transaction is sent.
   * - Idempotent per signer address: once accepted, subsequent calls throw `ConflictError`.
   *
   * @returns A success message string from the Obol API.
   * @throws {SignerRequiredError} If no signer was provided to the client.
   * @throws {ConflictError} If the terms were already accepted by this address.
   *
   * @example
   * ```typescript
   * const message = await client.acceptObolLatestTermsAndConditions();
   * console.log(message); // "Terms and conditions accepted successfully"
   * ```
   */
  async acceptObolLatestTermsAndConditions(): Promise<string> {
    if (!this.signer) {
      throw new SignerRequiredError('acceptObolLatestTermsAndConditions');
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
   * Deploys an Optimistic Withdrawal Recipient (OWR) and a Splitter Proxy contract.
   *
   * Use this when the **principal** goes to a single address and only **rewards**
   * are split among recipients. For splitting both principal and rewards, see
   * {@link Client.createObolTotalSplit}.
   *
   * - Requires a `signer` with ETH to pay deployment gas.
   * - Sends one or more on-chain transactions (irreversible).
   * - Automatically appends the Obol Retroactive Funding (RAF) recipient at the
   *   configured percentage (default 1%).
   * - Only supported on Mainnet (1), Holesky (17000), and Hoodi (560048).
   *
   * @param rewardsSplitPayload - Configuration for the OWR and splitter deployment.
   * @returns The deployed OWR address as `withdrawal_address` and the
   *   splitter proxy address as `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {UnsupportedChainError} If the chain does not support splitters.
   *
   * @example
   * ```typescript
   * const { withdrawal_address, fee_recipient_address } =
   *   await client.createObolRewardsSplit({
   *     splitRecipients: [
   *       { account: "0xOperator1...", percentAllocation: 50 },
   *       { account: "0xOperator2...", percentAllocation: 49 },
   *     ],
   *     principalRecipient: "0xPrincipalAddress...",
   *     etherAmount: 32,
   *   });
   * ```
   */
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
      throw new SignerRequiredError('createObolRewardsSplit');
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
    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new UnsupportedChainError(this.chainId, 'createObolRewardsSplit');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.SPLITMAIN_CONTRACT) {
      throw new UnsupportedChainError(this.chainId, 'createObolRewardsSplit');
    }

    const checkSplitMainAddress = await isContractAvailable(
      chainConfig.SPLITMAIN_CONTRACT.address,
      this.signer.provider as ProviderType,
      chainConfig.SPLITMAIN_CONTRACT.bytecode,
    );

    const checkMulticall3Address = await isContractAvailable(
      chainConfig.MULTICALL3_CONTRACT.address,
      this.signer.provider as ProviderType,
      chainConfig.MULTICALL3_CONTRACT.bytecode,
    );

    const checkOWRFactoryAddress = await isContractAvailable(
      chainConfig.OWR_FACTORY_CONTRACT.address,
      this.signer.provider as ProviderType,
      chainConfig.OWR_FACTORY_CONTRACT.bytecode,
    );

    if (
      !checkMulticall3Address ||
      !checkSplitMainAddress ||
      !checkOWRFactoryAddress
    ) {
      throw new Error(
        `Required factory contracts are not available on chain ${this.chainId}. Contact Obol at ${OBOL_SDK_EMAIL}`,
      );
    }

    const retroActiveFundingRecipient = {
      account: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: validatedPayload.ObolRAFSplit,
    };

    const copiedSplitRecipients = [...validatedPayload.splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );

    const predictedSplitterAddress = await predictSplitterAddress({
      signer: this.signer,
      accounts,
      percentAllocations,
      chainId: this.chainId,
      distributorFee: validatedPayload.distributorFee,
      controllerAddress: validatedPayload.controllerAddress,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as ProviderType,
    );

    const { withdrawal_address, fee_recipient_address } =
      await handleDeployOWRAndSplitter({
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

    return { withdrawal_address, fee_recipient_address };
  }

  /**
   * Deploys a Splitter Proxy contract that splits **both principal and rewards**.
   *
   * Unlike {@link Client.createObolRewardsSplit}, this method does not deploy an
   * OWR – the splitter address is used as both `withdrawal_address` and
   * `fee_recipient_address`.
   *
   * - Requires a `signer` with ETH to pay deployment gas.
   * - Sends an on-chain transaction if the splitter is not already deployed (irreversible).
   * - If the predicted splitter is already deployed, returns the existing address without
   *   sending a transaction (idempotent).
   * - Automatically appends the Obol RAF recipient.
   * - Only supported on Mainnet (1), Holesky (17000), and Hoodi (560048).
   *
   * @param totalSplitPayload - Configuration for the splitter deployment.
   * @returns The splitter address as both `withdrawal_address` and `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {UnsupportedChainError} If the chain does not support splitters.
   * @throws {Error} If required on-chain factory contracts are unavailable.
   *
   * @example
   * ```typescript
   * const { withdrawal_address, fee_recipient_address } =
   *   await client.createObolTotalSplit({
   *     splitRecipients: [
   *       { account: "0xOperator1...", percentAllocation: 50 },
   *       { account: "0xOperator2...", percentAllocation: 49.9 },
   *     ],
   *   });
   * // withdrawal_address === fee_recipient_address (same splitter)
   * ```
   */
  async createObolTotalSplit({
    splitRecipients,
    ObolRAFSplit,
    distributorFee,
    controllerAddress,
  }: TotalSplitPayload): Promise<ClusterValidator> {
    // This method doesnt require T&C signature
    if (!this.signer) {
      throw new SignerRequiredError('createObolTotalSplit');
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
    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new UnsupportedChainError(this.chainId, 'createObolTotalSplit');
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.SPLITMAIN_CONTRACT) {
      throw new UnsupportedChainError(this.chainId, 'createObolTotalSplit');
    }

    const checkSplitMainAddress = await isContractAvailable(
      chainConfig.SPLITMAIN_CONTRACT.address,
      this.signer.provider as ProviderType,
      chainConfig.SPLITMAIN_CONTRACT.bytecode,
    );

    if (!checkSplitMainAddress) {
      throw new Error(
        `Required factory contracts are not available on chain ${this.chainId}. Contact Obol at ${OBOL_SDK_EMAIL}`,
      );
    }

    const retroActiveFundingRecipient = {
      account: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: validatedPayload.ObolRAFSplit,
    };

    const copiedSplitRecipients = [...validatedPayload.splitRecipients];
    copiedSplitRecipients.push(retroActiveFundingRecipient);

    const { accounts, percentAllocations } = formatSplitRecipients(
      copiedSplitRecipients,
    );

    const predictedSplitterAddress = await predictSplitterAddress({
      signer: this.signer,
      accounts,
      percentAllocations,
      chainId: this.chainId,
      distributorFee: validatedPayload.distributorFee,
      controllerAddress: validatedPayload.controllerAddress,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.signer.provider as ProviderType,
    );

    if (!isSplitterDeployed) {
      const splitterAddress = await deploySplitterContract({
        signer: this.signer,
        accounts,
        percentAllocations,
        chainId: this.chainId,
        distributorFee: validatedPayload.distributorFee,
        controllerAddress: validatedPayload.controllerAddress,
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
   * Reads the tranches of a deployed Optimistic Withdrawal Recipient (OWR) contract.
   *
   * Returns the principal recipient, reward recipient, and staked principal amount
   * configured in the OWR. This is a read-only on-chain call (no transaction sent).
   *
   * - Requires a `signer` (for provider access).
   *
   * @param owrAddress - The Ethereum address of the deployed OWR contract.
   * @returns The OWR tranche data: `principalRecipient`, `rewardRecipient`, and `amountOfPrincipalStake`.
   * @throws {SignerRequiredError} If no signer was provided.
   *
   * @example
   * ```typescript
   * const tranches = await client.getOWRTranches("0xOWRAddress...");
   * console.log(tranches.principalRecipient);
   * console.log(tranches.rewardRecipient);
   * console.log(tranches.amountOfPrincipalStake);
   * ```
   */
  async getOWRTranches(owrAddress: ETH_ADDRESS): Promise<OWRTranches> {
    if (!this.signer) {
      throw new SignerRequiredError('getOWRTranches');
    }

    const signer = this.signer;
    return await getOWRTranches({ owrAddress, signer });
  }

  /**
   * Creates a new cluster definition and registers it with the Obol API.
   *
   * A cluster definition describes the operators, validators, and configuration
   * for a Distributed Key Generation (DKG) ceremony. After creation, each operator
   * must call {@link Client.acceptClusterDefinition} to join.
   *
   * - Requires {@link Client.acceptObolLatestTermsAndConditions} to have been called first.
   * - Requires a `signer`.
   * - The `config_hash` returned is the unique identifier for this cluster.
   * - Threshold is automatically set to `ceil(2/3 * operators.length)`.
   * - Creating a duplicate cluster throws a {@link ConflictError}.
   *
   * @param newCluster - The cluster configuration payload.
   * @returns The `config_hash` string that uniquely identifies this cluster definition.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ConflictError} If an identical cluster definition already exists.
   *
   * @example
   * ```typescript
   * const configHash = await client.createClusterDefinition({
   *   name: "my-dvt-cluster",
   *   operators: [{ address: "0xOp1..." }, { address: "0xOp2..." }],
   *   validators: [{
   *     fee_recipient_address: "0xFeeRecipient...",
   *     withdrawal_address: "0xWithdrawal...",
   *   }],
   * });
   * console.log("Cluster created:", configHash);
   * ```
   */
  async createClusterDefinition(newCluster: ClusterPayload): Promise<string> {
    if (!this.signer) {
      throw new SignerRequiredError('createClusterDefinition');
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
   * Accepts (joins) an existing cluster definition as an operator.
   *
   * Each operator in the cluster must call this method with their ENR and the
   * cluster's `config_hash` to signal readiness for the DKG ceremony.
   *
   * - Requires a `signer` (the operator's address is derived from it).
   * - Signs two EIP-712 messages: one for the config hash, one for the ENR.
   * - The operator must be listed in the cluster definition's `operators` array.
   *
   * @param operatorPayload - Operator data. Must include `enr` (Ethereum Node Record)
   *   and `version` at minimum.
   * @param configHash - The `config_hash` returned by {@link Client.createClusterDefinition}.
   * @returns The updated cluster definition with the operator's acceptance recorded.
   * @throws {SignerRequiredError} If no signer was provided.
   *
   * @example
   * ```typescript
   * const updatedDef = await client.acceptClusterDefinition(
   *   { enr: "enr:-LK4Q...", version: "v1.10.0" },
   *   configHash,
   * );
   * ```
   */
  async acceptClusterDefinition(
    operatorPayload: OperatorPayload,
    configHash: string,
  ): Promise<ClusterDefinition> {
    if (!this.signer) {
      throw new SignerRequiredError('acceptClusterDefinition');
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
   * Retrieves a cluster definition by its configuration hash.
   *
   * This is a read-only API call – no signer is required.
   *
   * @param configHash - The `config_hash` returned by {@link Client.createClusterDefinition}.
   * @returns The full cluster definition including operators, validators, and metadata.
   * @throws {Error} If no cluster definition exists for the given hash (404).
   *
   * @example
   * ```typescript
   * const definition = await client.getClusterDefinition(configHash);
   * console.log(definition.name, definition.operators.length);
   * ```
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
   * Retrieves a cluster lock by the cluster's configuration hash.
   *
   * A cluster lock is generated after a successful DKG ceremony and contains
   * the distributed validators, their public key shares, and deposit data.
   * This is a read-only API call – no signer is required.
   *
   * @param configHash - The `config_hash` from the cluster definition.
   * @returns The cluster lock including distributed validators and deposit data.
   * @throws {Error} If no lock exists for the given config hash (DKG not yet complete, or not found).
   *
   * @example
   * ```typescript
   * const lock = await client.getClusterLock(configHash);
   * console.log(lock.distributed_validators.length);
   * console.log(lock.lock_hash);
   * ```
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
   * Retrieves a cluster lock by its lock hash (as opposed to config hash).
   *
   * Use this when you have the `lock_hash` directly rather than the `config_hash`.
   * This is a read-only API call – no signer is required.
   *
   * @param lockHash - The `lock_hash` from a cluster lock.
   * @returns The cluster lock including distributed validators and deposit data.
   * @throws {Error} If no lock exists for the given lock hash (not found).
   *
   * @example
   * ```typescript
   * const lock = await client.getClusterLockByHash(lockHash);
   * console.log(lock.cluster_definition.name);
   * ```
   */
  async getClusterLockByHash(lockHash: string): Promise<ClusterLock> {
    const lock: ClusterLock = await this.request(
      `/${DEFAULT_BASE_VERSION}/lock/${lockHash}`,
      {
        method: 'GET',
      },
    );
    return lock;
  }
}
