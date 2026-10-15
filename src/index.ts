import { v4 as uuidv4 } from 'uuid';
import { Base, type BaseConfig } from './base.js';
import {
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
  TERMS_ACCEPTED_MSG,
  CHAIN_CONFIGURATION,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  OBOL_SDK_EMAIL,
  isChainSupportedForSplitters,
  SUPPORTED_DEFINITION_VERSIONS,
} from './constants.js';
import {
  ConflictError,
  DefinitionVerificationError,
  NotAnOperatorError,
  SignerRequiredError,
  UnsupportedChainError,
} from './errors.js';
import {
  type AcceptanceSummary,
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
  type ClusterProgress,
  type WatchClusterOptions,
  type WaitForOptions,
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
import { assertSignerChain, isContractAvailable } from './utils.js';
import { assertAddress, assertHash32 } from './validation.js';
import {
  errorStatus,
  waitForClusterProgress,
  watchClusterProgress,
} from './clusterStatus.js';
import { Incentives } from './incentives/incentives.js';
import { Exit } from './exits/exit.js';
import { ObolSplits } from './splits/splits.js';
import { EOA } from './eoa/eoa.js';
import { validateClusterLock } from './services.js';
import {
  depositDataFromLock,
  type GetDepositDataOptions,
  type LockDepositData,
} from './deposits/lockDeposits.js';
import {
  checkExistingDeposits,
  type CheckExistingDepositsOptions,
  type DepositToCheck,
  type ExistingDepositCheck,
} from './deposits/existingDeposits.js';
export * from './types.js';
export * from './services.js';
export * from './verification/signature-validator.js';
export * from './verification/common.js';
export * from './constants.js';
export {
  ChainMismatchError,
  ConflictError,
  ClusterLockValidationBusyError,
  ClusterLockValidationTimeoutError,
  ClusterProgressTimeoutError,
  DefinitionVerificationError,
  DepositConflictError,
  IncentivesPreflightError,
  InvalidBaseUrlError,
  NotAnOperatorError,
  NotFoundError,
  ObolApiError,
  type ObolApiErrorInit,
  ObolSdkError,
  RateLimitError,
  RequestTimeoutError,
  SignerRequiredError,
  UnauthorizedError,
  UnsupportedChainError,
  ValidationError,
} from './errors.js';
export {
  ALLOWED_OBOL_API_BASE_URLS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './base.js';
export { Incentives } from './incentives/incentives.js';
export { Exit } from './exits/exit.js';
export { ObolSplits } from './splits/splits.js';
export { EOA } from './eoa/eoa.js';
export { blsVerify } from './blsUtils.js';
export {
  depositDataFromLock,
  type GetDepositDataOptions,
  type LockDepositData,
} from './deposits/lockDeposits.js';
export {
  checkExistingDeposits,
  BEACON_VALIDATORS_CHUNK_SIZE,
  BEACON_VALIDATORS_CHUNK_CONCURRENCY,
  type CheckExistingDepositsOptions,
  type DepositCheckStatus,
  type DepositToCheck,
  type ExistingDepositCheck,
} from './deposits/existingDeposits.js';
export { ENR } from '@chainsafe/enr';

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
 * - {@link Client.hasAcceptedTerms}
 * - {@link Client.acceptObolLatestTermsAndConditions}
 * - {@link Client.createClusterDefinition}
 * - {@link Client.getAcceptanceSummary}
 * - {@link Client.acceptClusterDefinition}
 * - {@link Client.getClusterDefinition}
 * - {@link Client.getClusterLock}
 * - {@link Client.getClusterLockByHash}
 * - {@link Client.getDepositData}
 * - {@link Client.checkExistingDeposits}
 * - {@link Client.createObolRewardsSplit}
 * - {@link Client.createObolTotalSplit}
 * - {@link Client.getOWRTranches}
 *
 * Supported networks (by `chainId`): Mainnet (1) and Hoodi (560048).
 * Any other `chainId` throws {@link UnsupportedChainError} from the constructor.
 *
 * @example
 * ```typescript
 * import { Client } from "@obolnetwork/obol-sdk";
 * import { Wallet } from "ethers";
 *
 * const signer = new Wallet(process.env.PRIVATE_KEY!);
 * const client = new Client({ chainId: 560048 }, signer);
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
   *   Must match one of {@link ALLOWED_OBOL_API_BASE_URLS} (API paths use `/v1/...` separately).
   * @param config.chainId - Target chain ID. Defaults to `560048` (Hoodi).
   *   Supported: 1 (Mainnet), 560048 (Hoodi); see {@link SUPPORTED_CHAIN_IDS}.
   * @param config.timeoutMs - Obol API request timeout in milliseconds.
   *   Defaults to 30000; `0` disables it. Timeouts throw {@link RequestTimeoutError}.
   * @param signer - Any ethers v6 `Signer` (`Wallet`, `HDNodeWallet`, `JsonRpcSigner`,
   *   `NonceManager`, or a custom `AbstractSigner`); for a viem `WalletClient`, use
   *   `walletClientToSigner` from `@obolnetwork/obol-sdk/viem`. Required for any
   *   write operation (creating clusters, deploying splits, claiming incentives).
   *   Read-only operations (`getClusterDefinition`, `getClusterLock`) work without a signer.
   * @param provider - An ethers `Provider`. If omitted, falls back to `signer.provider`.
   * @throws {UnsupportedChainError} If `chainId` is not a supported chain.
   * @throws {InvalidBaseUrlError} If `baseUrl` is not an allowed Obol API URL.
   *
   * @example
   * ```typescript
   * // Minimal read-only client (no signer)
   * const readClient = new Client({ chainId: 1 });
   * const def = await readClient.getClusterDefinition(configHash);
   *
   * // Full client with signer for write operations
   * const client = new Client({ chainId: 560048 }, signer);
   * ```
   */
  constructor(
    config: BaseConfig,
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
   * Checks whether an address has accepted the latest Obol terms and conditions.
   *
   * This is a read-only API call; no signature is requested.
   *
   * @param address - Address to check. Defaults to the signer's address.
   * @returns `true` if the terms have been accepted, otherwise `false`.
   * @throws {SignerRequiredError} If no address is given and no signer was provided.
   * @throws {Error} If `address` is given and is not a 0x-prefixed 20-byte
   *   address (checked before calling the API).
   * @throws {ValidationError} If the API rejects the address.
   *
   * @example
   * ```typescript
   * if (!(await client.hasAcceptedTerms())) {
   *   await client.acceptObolLatestTermsAndConditions();
   * }
   * ```
   */
  async hasAcceptedTerms(address?: string): Promise<boolean> {
    let target = address;
    if (target === undefined) {
      if (!this.signer) {
        throw new SignerRequiredError('hasAcceptedTerms');
      }
      target = await this.signer.getAddress();
    } else {
      assertAddress(target, 'address');
    }

    const response: { isTermsAndConditionsSigned: boolean } =
      await this.request(
        `/${DEFAULT_BASE_VERSION}/termsAndConditions/${encodeURIComponent(target)}`,
        { method: 'GET' },
      );
    return Boolean(response?.isTermsAndConditionsSigned);
  }

  /**
   * Accepts the latest Obol terms and conditions.
   *
   * **Must be called once** before any write operation
   * (`createClusterDefinition`, `acceptClusterDefinition`, etc.).
   *
   * - Requires a `signer` to be provided at client construction.
   * - Signs an EIP-712 typed-data message; no on-chain transaction is sent.
   * - Not idempotent by default: calling it again after acceptance throws a
   *   {@link ConflictError}. Pass `{ ifNotAccepted: true }` to first check with
   *   {@link Client.hasAcceptedTerms} and return without signing if the signer
   *   has already accepted.
   *
   * @param options - Optional settings.
   * @param options.ifNotAccepted - When `true`, skip signing and return
   *   {@link TERMS_ACCEPTED_MSG} if the signer has already accepted the terms.
   * @returns A success message string from the Obol API.
   * @throws {SignerRequiredError} If no signer was provided to the client.
   * @throws {ConflictError} If the terms were already accepted by this address
   *   (only when `ifNotAccepted` is not set).
   *
   * @example
   * ```typescript
   * const message = await client.acceptObolLatestTermsAndConditions({
   *   ifNotAccepted: true,
   * });
   * console.log(message); // "successful authorization"
   * ```
   */
  async acceptObolLatestTermsAndConditions(options?: {
    ifNotAccepted?: boolean;
  }): Promise<string> {
    if (!this.signer) {
      throw new SignerRequiredError('acceptObolLatestTermsAndConditions');
    }

    try {
      const termsAndConditionsHash = TERMS_AND_CONDITIONS_HASH;
      const address = await this.signer.getAddress();

      if (options?.ifNotAccepted === true) {
        if (await this.hasAcceptedTerms(address)) {
          return TERMS_ACCEPTED_MSG;
        }
      }

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
      if (err instanceof ConflictError) {
        err.hint =
          'Terms already accepted by this address; use hasAcceptedTerms() or pass { ifNotAccepted: true }.';
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
   * - Only supported on Mainnet (1) and Hoodi (560048).
   *
   * @param rewardsSplitPayload - Configuration for the OWR and splitter deployment.
   * @returns The deployed OWR address as `withdrawal_address` and the
   *   splitter proxy address as `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
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

    await assertSignerChain(
      this.signer,
      this.chainId,
      'createObolRewardsSplit',
    );

    const checkSplitMainAddress = await isContractAvailable(
      chainConfig.SPLITMAIN_CONTRACT.address,
      this.provider as ProviderType,
      chainConfig.SPLITMAIN_CONTRACT.bytecode,
    );

    const checkMulticall3Address = await isContractAvailable(
      chainConfig.MULTICALL3_CONTRACT.address,
      this.provider as ProviderType,
      chainConfig.MULTICALL3_CONTRACT.bytecode,
    );

    const checkOWRFactoryAddress = await isContractAvailable(
      chainConfig.OWR_FACTORY_CONTRACT.address,
      this.provider as ProviderType,
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
      provider: this.provider,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.provider as ProviderType,
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
   * - Only supported on Mainnet (1) and Hoodi (560048).
   *
   * @param totalSplitPayload - Configuration for the splitter deployment.
   * @returns The splitter address as both `withdrawal_address` and `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
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

    await assertSignerChain(this.signer, this.chainId, 'createObolTotalSplit');

    const checkSplitMainAddress = await isContractAvailable(
      chainConfig.SPLITMAIN_CONTRACT.address,
      this.provider as ProviderType,
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
      provider: this.provider,
    });

    const isSplitterDeployed = await isContractAvailable(
      predictedSplitterAddress,
      this.provider as ProviderType,
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
    return await getOWRTranches({
      owrAddress,
      signer,
      provider: this.provider,
    });
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
   * @param version - Cluster definition version to create. Defaults to
   *   {@link CONFIG_VERSION} (the latest). Pass an earlier version (e.g.
   *   `'v1.10.0'`) to create clusters compatible with a charon version that
   *   does not yet support the latest schema — the DKG nodes must run a charon
   *   release that supports the chosen version. Must be one of
   *   {@link SUPPORTED_DEFINITION_VERSIONS}.
   * @returns The `config_hash` string that uniquely identifies this cluster definition.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {Error} If `version` is not supported, or the payload fails
   *   validation (unknown fields, invalid or duplicate addresses, zero
   *   withdrawal or fee recipient address).
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
  async createClusterDefinition(
    newCluster: ClusterPayload,
    version: string = CONFIG_VERSION,
  ): Promise<string> {
    if (!this.signer) {
      throw new SignerRequiredError('createClusterDefinition');
    }

    if (!SUPPORTED_DEFINITION_VERSIONS.includes(version)) {
      throw new Error(
        `Unsupported cluster definition version ${String(version)}; expected one of ${SUPPORTED_DEFINITION_VERSIONS.join(', ')}`,
      );
    }

    const validatedCluster = validatePayload<ClusterPayload>(
      newCluster,
      definitionSchema,
    );

    const clusterConfig: Partial<ClusterDefinition> = {
      ...validatedCluster,
      fork_version: this.fork_version,
      dkg_algorithm: DKG_ALGORITHM,
      version,
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      threshold: Math.ceil((2 * validatedCluster.operators.length) / 3),
      num_validators: validatedCluster.validators.length,
    };
    await assertSignerChain(
      this.signer,
      this.chainId,
      'createClusterDefinition',
    );

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
      if (err instanceof ConflictError) {
        err.hint = `This cluster definition already exists; call getClusterDefinition('${clusterConfig.config_hash}') to read its state.`;
      }
      throw err;
    }
  }

  /**
   * Fetches and verifies the cluster definition an operator is about to
   * accept, and returns the terms in a form suitable for showing to the user.
   *
   * The definition is fetched from the Obol API and checked locally before
   * anything is returned:
   * - the returned `config_hash` equals `configHash`,
   * - the `config_hash` recomputed from the definition's contents matches,
   * - the definition's `fork_version` matches this client's chain.
   *
   * This is a read-only API call – no signer is required.
   *
   * **Integrators should show `withdrawal_addresses` and
   * `fee_recipient_addresses` (and the operator set) to the user and get their
   * confirmation before calling {@link Client.acceptClusterDefinition}.**
   * Accepting a definition commits the operator to a DKG for validators whose
   * principal and rewards go to these addresses.
   *
   * @param configHash - The `config_hash` of the cluster definition.
   * @returns The verified definition's name, operators, threshold, validator
   *   count and withdrawal / fee recipient addresses.
   * @throws {DefinitionVerificationError} If the definition fails verification.
   *
   * @example
   * ```typescript
   * const summary = await client.getAcceptanceSummary(configHash);
   * console.log(summary.name, summary.operators);
   * console.log("Withdrawals go to:", summary.withdrawal_addresses);
   * console.log("Fees go to:", summary.fee_recipient_addresses);
   * // ...ask the user to confirm, then:
   * await client.acceptClusterDefinition({ enr }, configHash);
   * ```
   */
  async getAcceptanceSummary(configHash: string): Promise<AcceptanceSummary> {
    const definition = await this.getVerifiedClusterDefinition(configHash);
    const validators = (definition.validators ?? []).map(v => ({
      fee_recipient_address: v.fee_recipient_address,
      withdrawal_address: v.withdrawal_address,
    }));
    const distinct = (addresses: string[]): string[] => {
      const seen = new Set<string>();
      return addresses.filter(a => {
        const key = a.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    return {
      config_hash: definition.config_hash,
      name: definition.name,
      version: definition.version,
      fork_version: definition.fork_version,
      creator_address: definition.creator?.address,
      operators: definition.operators.map(o => o.address),
      threshold: definition.threshold,
      num_validators: definition.num_validators,
      validators,
      withdrawal_addresses: distinct(validators.map(v => v.withdrawal_address)),
      fee_recipient_addresses: distinct(
        validators.map(v => v.fee_recipient_address),
      ),
      deposit_amounts: definition.deposit_amounts,
      compounding: definition.compounding,
    };
  }

  /**
   * Accepts (joins) an existing cluster definition as an operator.
   *
   * Each operator in the cluster must call this method with their ENR and the
   * cluster's `config_hash` to signal readiness for the DKG ceremony.
   *
   * Before signing, the definition is fetched and verified locally (see
   * {@link Client.getAcceptanceSummary}), and the signer's address must be one
   * of the definition's operators. Integrators should show the user the
   * withdrawal and fee recipient addresses (from
   * {@link Client.getAcceptanceSummary}) before calling this method.
   *
   * - Requires a `signer` (the operator's address is derived from it).
   * - Signs two EIP-712 messages: one for the config hash, one for the ENR.
   * - If this operator has already accepted with the same ENR, the current
   *   definition is returned and nothing is signed.
   *
   * @param operatorPayload - Operator data. Must include `enr` (Ethereum Node
   *   Record). `version` is optional and defaults to the definition's version;
   *   if given, it must match it.
   * @param configHash - The `config_hash` returned by {@link Client.createClusterDefinition}.
   * @returns The updated cluster definition with the operator's acceptance recorded.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {Error} If `configHash` is not a 0x-prefixed 32-byte hex string.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {DefinitionVerificationError} If the definition fails verification
   *   or `operatorPayload.version` differs from the definition's version.
   * @throws {NotAnOperatorError} If the signer is not an operator in the definition.
   *
   * @example
   * ```typescript
   * const updatedDef = await client.acceptClusterDefinition(
   *   { enr: "enr:-LK4Q..." },
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
    assertHash32(configHash, 'configHash');

    await assertSignerChain(
      this.signer,
      this.chainId,
      'acceptClusterDefinition',
    );

    const definition = await this.getVerifiedClusterDefinition(configHash);

    if (
      operatorPayload?.version !== undefined &&
      operatorPayload.version !== definition.version
    ) {
      throw new DefinitionVerificationError(
        `Operator payload version ${operatorPayload.version} does not match cluster definition version ${definition.version}`,
      );
    }

    const validatedPayload = validatePayload<OperatorPayload>(
      { ...operatorPayload, version: definition.version },
      operatorPayloadSchema,
    );

    const address = await this.signer.getAddress();
    const operator = definition.operators.find(
      o => o.address?.toLowerCase() === address.toLowerCase(),
    );
    if (!operator) {
      throw new NotAnOperatorError(address, configHash);
    }

    if (operator.config_signature && operator.enr === validatedPayload.enr) {
      return definition;
    }

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
      `/${DEFAULT_BASE_VERSION}/definition/${encodeURIComponent(configHash)}`,
      {
        method: 'PUT',
        body: JSON.stringify(operatorData),
        headers: {
          Authorization: `Bearer ${operatorConfigSignature}`,
        },
      },
    );
    return clusterDefinition;
  }

  /**
   * Fetches a cluster definition and checks that it is the definition
   * identified by `configHash` and that it targets this client's chain.
   */
  private async getVerifiedClusterDefinition(
    configHash: string,
  ): Promise<ClusterDefinition> {
    const definition = await this.getClusterDefinition(configHash);
    const expected = String(configHash).toLowerCase();

    if (
      typeof definition?.config_hash !== 'string' ||
      definition.config_hash.toLowerCase() !== expected
    ) {
      throw new DefinitionVerificationError(
        `Cluster definition returned for ${configHash} has config_hash ${definition?.config_hash}`,
      );
    }

    let computedHash: string;
    try {
      computedHash = clusterConfigOrDefinitionHash(definition, true);
    } catch (err: any) {
      throw new DefinitionVerificationError(
        `Cannot verify cluster definition ${configHash} (version ${definition.version}): ${err?.message}`,
      );
    }
    if (computedHash.toLowerCase() !== expected) {
      throw new DefinitionVerificationError(
        `Cluster definition ${configHash} does not match its config_hash (computed ${computedHash})`,
      );
    }

    if (
      typeof definition.fork_version !== 'string' ||
      definition.fork_version.toLowerCase() !== this.fork_version.toLowerCase()
    ) {
      throw new DefinitionVerificationError(
        `Cluster definition ${configHash} has fork_version ${definition.fork_version}, but this client is configured for chain ${this.chainId} (fork_version ${this.fork_version})`,
      );
    }

    return definition;
  }

  /**
   * Retrieves a cluster definition by its configuration hash.
   *
   * This is a read-only API call – no signer is required.
   *
   * @param configHash - The `config_hash` returned by {@link Client.createClusterDefinition}.
   * @returns The full cluster definition including operators, validators, and metadata.
   * @throws {Error} If no cluster definition exists for the given hash (404).
   * @throws {Error} If `configHash` is not a 0x-prefixed 32-byte hex string.
   *
   * @example
   * ```typescript
   * const definition = await client.getClusterDefinition(configHash);
   * console.log(definition.name, definition.operators.length);
   * ```
   */
  async getClusterDefinition(configHash: string): Promise<ClusterDefinition> {
    assertHash32(configHash, 'configHash');
    const clusterDefinition: ClusterDefinition = await this.request(
      `/${DEFAULT_BASE_VERSION}/definition/${encodeURIComponent(configHash)}`,
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
   * @throws {Error} If `configHash` is not a 0x-prefixed 32-byte hex string.
   *
   * @example
   * ```typescript
   * const lock = await client.getClusterLock(configHash);
   * console.log(lock.distributed_validators.length);
   * console.log(lock.lock_hash);
   * ```
   */
  async getClusterLock(configHash: string): Promise<ClusterLock> {
    assertHash32(configHash, 'configHash');
    const lock: ClusterLock = await this.request(
      `/${DEFAULT_BASE_VERSION}/lock/configHash/${encodeURIComponent(configHash)}`,
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
   * @throws {Error} If `lockHash` is not a 0x-prefixed 32-byte hex string.
   *
   * @example
   * ```typescript
   * const lock = await client.getClusterLockByHash(lockHash);
   * console.log(lock.cluster_definition.name);
   * ```
   */
  async getClusterLockByHash(lockHash: string): Promise<ClusterLock> {
    assertHash32(lockHash, 'lockHash');
    const lock: ClusterLock = await this.request(
      `/${DEFAULT_BASE_VERSION}/lock/${encodeURIComponent(lockHash)}`,
      {
        method: 'GET',
      },
    );
    return lock;
  }

  /**
   * Fetches a cluster lock by lock hash and returns its deposit data as
   * payloads for {@link EOA.deposit} / {@link ObolSplits.deposit}
   * (`amount` in wei, hex fields 0x-prefixed).
   *
   * By default the lock is fully validated first ({@link validateClusterLock}:
   * operator signatures, lock hash, every deposit signature). This is
   * CPU-bound and can take from seconds to about a minute for locks with
   * hundreds of validators; pass `verify: false` only if the lock was already
   * validated. The lock's fork version must match this client's chain.
   *
   * Locks from v1.8.0 carry `partial_deposit_data`, which can hold several
   * deposit amounts per validator (e.g. 1 ETH and 32 ETH). When there is more
   * than one, pass `amount` (wei) to choose, or read `depositsByAmount`;
   * `deposits` is then only set for the chosen amount. Older locks with a
   * single `deposit_data` are supported.
   *
   * This is a read-only API call – no signer is required.
   *
   * @param lockHash - The `lock_hash` of the cluster lock.
   * @param options.verify - Validate the lock first. Defaults to `true`.
   * @param options.amount - Deposit amount to return, in wei.
   * @param options.safeRpcUrl - RPC URL for Safe wallet signatures in the lock.
   * @returns The lock hash, the available amounts, deposits grouped by amount,
   *   and `deposits` for the chosen (or only) amount.
   * @throws {Error} If the lock is not found, fails validation, was created
   *   for another chain, has missing/malformed deposit data, or `amount` is
   *   not available for every validator.
   *
   * @example
   * ```typescript
   * const { deposits } = await client.getDepositData(lockHash, {
   *   amount: "32000000000000000000",
   * });
   * const checks = await client.checkExistingDeposits(deposits!, {
   *   beaconUrl: "http://localhost:5052",
   * });
   * if (checks.every(c => c.status === "new")) {
   *   await client.eoa.deposit({ deposits: deposits! });
   * }
   * ```
   */
  async getDepositData(
    lockHash: string,
    { verify = true, amount, safeRpcUrl }: GetDepositDataOptions = {},
  ): Promise<LockDepositData> {
    const lock = await this.getClusterLockByHash(lockHash);

    if (
      lock?.cluster_definition?.fork_version?.toLowerCase() !==
      this.fork_version?.toLowerCase()
    ) {
      throw new Error(
        `Cluster lock fork version ${lock?.cluster_definition?.fork_version} does not match chain ${this.chainId}`,
      );
    }
    if (verify && !(await validateClusterLock(lock, safeRpcUrl))) {
      throw new Error('Cluster lock failed validation');
    }

    return depositDataFromLock(lock, { amount });
  }

  /**
   * Checks deposits against a beacon node before they are sent. See the
   * standalone {@link checkExistingDeposits} for the rules and limits; the
   * result is advisory and cannot rule out deposits not yet on chain.
   *
   * @param deposits - Deposits to check (only `pubkey` and
   *   `withdrawal_credentials` are used).
   * @param options.beaconUrl - Beacon node REST API base URL for this chain.
   * @returns One verdict per deposit: `new`, `top_up` or `conflict`.
   * @throws {Error} On invalid input or any beacon node failure.
   */
  async checkExistingDeposits(
    deposits: DepositToCheck[],
    options: CheckExistingDepositsOptions,
  ): Promise<ExistingDepositCheck[]> {
    return await checkExistingDeposits(deposits, options);
  }

  /**
   * Watches a cluster from operator sign-off to lock publication by polling the
   * API. Yields the initial state, then each change (another operator signed,
   * or the step advanced), and ends after `lock_published`.
   *
   * Definitions without operator addresses (solo and Charon-created) have
   * nothing to sign and start at `definition_ready`.
   *
   * Polling starts at `intervalMs` and backs off by 1.5x up to `maxIntervalMs`
   * while nothing changes. Network errors, 408, 429 and 5xx responses are
   * retried; other 4xx responses (including 404 for an unknown config hash)
   * are thrown. This is a read-only API call – no signer is required.
   *
   * @param configHash - The `config_hash` of the cluster definition.
   * @param options - `signal` to stop watching, and polling intervals.
   * @throws The abort reason when `signal` aborts.
   *
   * @example
   * ```typescript
   * for await (const s of client.watchCluster(configHash, { signal })) {
   *   if (s.step === 'awaiting_signatures') console.log(`${s.signed}/${s.total}`);
   *   if (s.step === 'lock_published') console.log(s.lockHash);
   * }
   * ```
   */
  watchCluster(
    configHash: string,
    options: WatchClusterOptions = {},
  ): AsyncGenerator<ClusterProgress, void, undefined> {
    assertHash32(configHash, 'configHash');
    const endpoint = `/${DEFAULT_BASE_VERSION}`;
    return watchClusterProgress(
      {
        getDefinition: async signal =>
          await this.request<ClusterDefinition>(
            `${endpoint}/definition/${encodeURIComponent(configHash)}`,
            { method: 'GET', signal },
          ),
        getLock: async signal => {
          try {
            return await this.request<ClusterLock>(
              `${endpoint}/lock/configHash/${encodeURIComponent(configHash)}`,
              { method: 'GET', signal },
            );
          } catch (e) {
            // No lock until the DKG completes.
            if (errorStatus(e) === 404) return null;
            throw e;
          }
        },
      },
      options,
    );
  }

  /**
   * Resolves once the cluster reaches `target`, using
   * {@link Client.watchCluster}.
   *
   * This is a read-only API call – no signer is required.
   *
   * @param configHash - The `config_hash` of the cluster definition.
   * @param target - `'definition_ready'` or `'lock_published'`.
   * @param options - `onProgress` callback for every state, `timeoutMs`,
   *   `signal`, and polling intervals.
   * @returns The target state.
   * @throws {ClusterProgressTimeoutError} If `timeoutMs` elapses first.
   * @throws The abort reason when `signal` aborts.
   *
   * @example
   * ```typescript
   * const { lockHash } = await client.waitFor(configHash, 'lock_published', {
   *   onProgress: s => console.log(s.step),
   *   timeoutMs: 60 * 60 * 1000,
   * });
   * ```
   */
  async waitFor<T extends 'definition_ready' | 'lock_published'>(
    configHash: string,
    target: T,
    options: WaitForOptions = {},
  ): Promise<Extract<ClusterProgress, { step: T }>> {
    const { onProgress, timeoutMs, signal, ...watchOptions } = options;
    assertHash32(configHash, 'configHash');
    return await waitForClusterProgress(
      watchSignal =>
        this.watchCluster(configHash, { ...watchOptions, signal: watchSignal }),
      target,
      { onProgress, timeoutMs, signal },
    );
  }
}
