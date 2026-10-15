import { type Provider, type Signer } from 'ethers';

/**
 * Maps Ethereum consensus-layer fork versions (hex) to execution-layer chain IDs.
 *
 * - `0x00000000` → 1 (Mainnet)
 * - `0x10000910` → 560048 (Hoodi)
 * - `0x00000064` → 100 (Gnosis; definitions and locks only, no splits)
 * - `0x90000069` → 11155111 (Sepolia; definitions and locks only, no splits)
 *
 * The {@link Client} accepts the chain IDs in {@link SUPPORTED_CHAIN_IDS}.
 */
export enum FORK_MAPPING {
  /** Mainnet. */
  '0x00000000' = 1,

  /** Gnosis Chain. */
  '0x00000064' = 100,

  /** Sepolia. */
  '0x90000069' = 11155111,

  /** Hoodi Chain. */
  '0x10000910' = 560048,
}

export const FORK_NAMES: Record<number, string> = {
  [FORK_MAPPING['0x00000000']]: 'mainnet',
  [FORK_MAPPING['0x00000064']]: 'gnosis',
  [FORK_MAPPING['0x90000069']]: 'sepolia',
  [FORK_MAPPING['0x10000910']]: 'hoodi',
} as const;

/**
 * Represents a node operator in a distributed validator cluster.
 *
 * When creating a cluster definition via {@link Client.createClusterDefinition},
 * only `address` is required. The remaining fields are populated during the
 * cluster acceptance and DKG process.
 */
export type ClusterOperator = {
  /** The operator address. */
  address: string;

  /** The operator ethereum node record. */
  enr?: string;

  /** The cluster fork_version. */
  fork_version?: string;

  /** The cluster version. */
  version?: string;

  /** The operator enr signature. */
  enr_signature?: string;

  /** The operator configuration signature. */
  config_signature?: string;
};

/**
 * Payload an operator provides when joining a cluster via
 * {@link Client.acceptClusterDefinition}.
 *
 * Requires at minimum `enr` (Ethereum Node Record). `version` is optional:
 * when omitted it is taken from the cluster definition; when given it must
 * match the definition's version.
 * Other `ClusterOperator` fields are optional overrides.
 */
export type OperatorPayload = Partial<ClusterOperator> &
  Required<Pick<ClusterOperator, 'enr'>>;

/**
 * What an operator agrees to when accepting a cluster definition, returned by
 * {@link Client.getAcceptanceSummary} after the definition has been verified
 * locally (config hash recomputed, network matches the client).
 */
export type AcceptanceSummary = {
  /** The verified cluster configuration hash. */
  config_hash: string;

  /** The cluster name. */
  name: string;

  /** The cluster definition version. */
  version: string;

  /** The cluster fork version (network). */
  fork_version: string;

  /** The address that created the cluster definition. */
  creator_address: string;

  /** Operator addresses, in definition order. */
  operators: string[];

  /** Signing threshold. */
  threshold: number;

  /** Number of distributed validators the cluster will create. */
  num_validators: number;

  /** Per-validator withdrawal and fee recipient addresses, in definition order. */
  validators: ClusterValidator[];

  /** Distinct withdrawal addresses across all validators. */
  withdrawal_addresses: string[];

  /** Distinct fee recipient addresses across all validators. */
  fee_recipient_addresses: string[];

  /** Partial deposit amounts in gwei, if set. */
  deposit_amounts?: string[] | null;

  /** Whether validators use 0x02 (compounding) withdrawal credentials. */
  compounding?: boolean;
};

/**
 * Cluster creator data
 */
export type ClusterCreator = {
  /** The creator address. */
  address: string;
  /** The cluster configuration signature. */
  config_signature?: string;
};

/**
 * Validator withdrawal configuration
 */
export type ClusterValidator = {
  /** Address to receive MEV rewards (if enabled), block proposal and priority fees. */
  fee_recipient_address: string;

  /** Address to receive skimming rewards and validator principal at exit. */
  withdrawal_address: string;
};

/**
 * Input payload for creating a new cluster definition via
 * {@link Client.createClusterDefinition}.
 *
 * Required fields: `name`, `operators`, `validators`.
 * Optional fields have sensible defaults applied by the SDK.
 */
export type ClusterPayload = {
  /** The cluster name. */
  name: string;

  /** The cluster nodes operators addresses. */
  operators: ClusterOperator[];

  /** The cluster validators information. */
  validators: ClusterValidator[];

  /** The cluster partial deposits in gwei or 32000000000. */
  deposit_amounts?: string[] | null;

  /** A withdrawal mechanism with 0x02 withdrawal credentials. */
  compounding?: boolean;

  /** The target gas limit where default is 36M. */
  target_gas_limit?: number;

  /** The consensus protocol e.g qbft. */
  consensus_protocol?: string;
};

/**
 * Full cluster definition as stored by the Obol API. Extends {@link ClusterPayload}
 * with server-generated metadata (uuid, timestamp, config_hash, etc.).
 *
 * Returned by {@link Client.createClusterDefinition},
 * {@link Client.acceptClusterDefinition}, and {@link Client.getClusterDefinition}.
 */
export interface ClusterDefinition extends ClusterPayload {
  /** The creator of the cluster. */
  creator: ClusterCreator;

  /** The cluster configuration version. */
  version: string;

  /** The cluster dkg algorithm. */
  dkg_algorithm: string;

  /** The cluster fork version. */
  fork_version: string;

  /** The cluster uuid. */
  uuid: string;

  /** The cluster creation timestamp. */
  timestamp: string;

  /** The cluster configuration hash. */
  config_hash: string;

  /** The distributed validator threshold. */
  threshold: number;

  /** The number of distributed validators in the cluster. */
  num_validators: number;

  /** The hash of the cluster definition. */
  definition_hash?: string;

  /** The consensus protocol e.g qbft. */
  consensus_protocol?: string;

  /** The target gas limit where default is 36M. */
  target_gas_limit?: number;

  /** A withdrawal mechanism with 0x02 withdrawal credentials. */
  compounding?: boolean;
}

/**
 * A recipient in a V1 splitter contract configuration.
 * Used with {@link Client.createObolRewardsSplit} and {@link Client.createObolTotalSplit}.
 */
export type SplitRecipient = {
  /** The split recipient address. */
  account: string;

  /** The recipient split. */
  percentAllocation: number;
};

/**
 * Input payload for {@link Client.createObolTotalSplit}.
 * Deploys a splitter that splits **both principal and rewards**.
 */
export type TotalSplitPayload = {
  /** The split recipients addresses and splits. */
  splitRecipients: SplitRecipient[];

  /** Split percentageNumber allocated for obol retroactive funding, minimum is 1%. */
  ObolRAFSplit?: number;

  /** The percentageNumber of accrued rewards that is paid to the caller of the distribution function to compensate them for the gas costs of doing so. Cannot be greater than 10%. For example, 5 represents 5%. */
  distributorFee?: number;

  /** Address that can mutate the split, should be ZeroAddress for immutable split. */
  controllerAddress?: string;
};

/**
 * Input payload for {@link Client.createObolRewardsSplit}.
 * Deploys an OWR (principal goes to one address) and a splitter (rewards split among recipients).
 */
export interface RewardsSplitPayload extends TotalSplitPayload {
  /** Address that will reclaim validator principal after exit. */
  principalRecipient: string;

  /** Amount needed to deploy all validators expected for the OWR/Splitter configuration. */
  etherAmount: number;

  /** Address that can control where the owr erc-20 tokens can be pushed, if set to zero it goes to splitter or principal address. */
  recoveryAddress?: string;
}

/**
 * Base parameters shared by both OVM split scenarios (rewards-only and total split).
 * Used with {@link ObolSplits.createValidatorManagerAndRewardsSplit} and
 * {@link ObolSplits.createValidatorManagerAndTotalSplit}.
 */
export type OVMBaseSplitPayload = {
  /** The split recipients addresses and splits. */
  rewardSplitRecipients: SplitV2Recipient[];

  /** Owner address for the OVM contract. */
  OVMOwnerAddress: string;

  /** Owner address for the splitter contracts. */
  splitOwnerAddress?: string;

  /** Principal threshold in ETH for OVM contract. */
  principalThreshold?: number;

  /** Distributor fee percentage (0-10). */
  distributorFeePercent?: number;
};

/**
 * Input payload for {@link ObolSplits.createValidatorManagerAndRewardsSplit}.
 * Principal goes to a single address; rewards are split among recipients.
 */
export type OVMRewardsSplitPayload = OVMBaseSplitPayload & {
  /** Principal recipient address (single address for rewards-only split). */
  principalRecipient: string;
};

/**
 * Input payload for {@link ObolSplits.createValidatorManagerAndTotalSplit}.
 * Both principal and rewards are split among recipients.
 */
export type OVMTotalSplitPayload = OVMBaseSplitPayload & {
  /** Principal recipients addresses and splits (array for total split scenario). */
  principalSplitRecipients: SplitV2Recipient[];
};

/**
 * Union type covering both OVM split scenarios.
 * Discriminate by checking for `principalRecipient` (rewards-only) vs
 * `principalSplitRecipients` (total split).
 */
export type OVMSplitPayload = OVMRewardsSplitPayload | OVMTotalSplitPayload;

/**
 * SplitV2 Recipient structure
 */
export type SplitV2Recipient = {
  /** Recipient address. */
  address: string;

  /** Percentage allocation (0-100 with up to 4 decimals). */
  percentAllocation: number;
};

/**
 * OWR Tranches
 */
export type OWRTranches = {
  /** Address that will reclaim validator principal after exit. */
  principalRecipient: ETH_ADDRESS;

  /** Address that will reclaim validator rewards during operation. */
  rewardRecipient: ETH_ADDRESS;

  /** Amount of principal staked. */
  amountOfPrincipalStake: number;
};

/**
 * Unsigned DV Builder Registration Message
 */
export type BuilderRegistrationMessage = {
  /** The DV fee recipient. */
  fee_recipient: string;

  /** Default is 30000000. */
  gas_limit: number;

  /** Timestamp when generating cluster lock file. */
  timestamp: number;

  /** The public key of the DV. */
  pubkey: string;
};

/**
 * Pre-generated Signed Validator Builder Registration
 */
export type BuilderRegistration = {
  /** Builder registration message. */
  message: BuilderRegistrationMessage;

  /** BLS signature of the builder registration message. */
  signature: string;
};

/** Pubkey + message + signature checked together in batch BLS verification. */
export type BlsSignatureCheck = {
  pubkey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

/**
 * Required deposit data for validator activation
 */
export type DepositData = {
  /** The public key of the distributed validator. */
  pubkey: string;

  /** The 0x01 withdrawal address of the DV. */
  withdrawal_credentials: string;

  /** 32 ethers. */
  amount: string;

  /** A checksum for DepositData fields . */
  deposit_data_root: string;

  /** BLS signature of the deposit message. */
  signature: string;
};

/**
 * A distributed validator within a cluster lock.
 * Contains the aggregate public key, per-operator public shares, and deposit data.
 */
export type DistributedValidator = {
  /** The public key of the distributed validator. */
  distributed_public_key: string;

  /** The public key of the node distributed validator share. */
  public_shares: string[];

  /** The deposit data for activating the DV. */
  deposit_data?: Partial<DepositData>;

  /** The deposit data with partial amounts or full amount for activating the DV. */
  partial_deposit_data?: Array<Partial<DepositData>>;

  /** pre-generated signed validator builder registration to be sent to builder network. */
  builder_registration?: BuilderRegistration;
};

/**
 * Cluster lock – the finalized cluster state after a successful DKG ceremony.
 *
 * Contains the distributed validators with their public key shares and deposit data,
 * plus the aggregated BLS signature.
 *
 * Returned by {@link Client.getClusterLock} and {@link Client.getClusterLockByHash}.
 */
export type ClusterLock = {
  /** The cluster definition. */
  cluster_definition: ClusterDefinition;

  /** The cluster distributed validators. */
  distributed_validators: DistributedValidator[];

  /** The cluster bls signature aggregate. */
  signature_aggregate: string;

  /** The hash of the cluster lock. */
  lock_hash: string;

  /** Node Signature for the lock hash by the node secp256k1 key. */
  node_signatures?: string[];
};

/**
 * Claimable Obol Incentives
 */
export type ClaimableIncentives = {
  /** Operator Address. */
  operator_address: string;

  /** The amount the recipient is entitled to. */
  amount: string;

  /** The recipient's index in the Merkle tree. */
  index: number;

  /** The Merkle proof (an array of hashes) generated for the recipient. */
  merkle_proof: string[];

  /** The MerkleDistributor contract address. */
  contract_address: string;
};

/**
 * A string expected to be a checksummed or lowercase Ethereum address (e.g. `"0xAbC...123"`).
 */
export type ETH_ADDRESS = string;

/**
 * Accepted ethers provider types for on-chain reads: any ethers v6 `Provider`
 * (`JsonRpcProvider`, `BrowserProvider`, `FallbackProvider`, ...).
 * Pass as the third argument to `new Client(config, signer, provider)`.
 */
export type ProviderType = Provider;

/**
 * Safe Wallet Provider Types
 */
export type SafeRpcUrl = string;

/**
 * Accepted ethers signer types for signing transactions and EIP-712 messages:
 * any ethers v6 `Signer` (`Wallet`, `HDNodeWallet`, `JsonRpcSigner`,
 * `NonceManager`, or a custom `AbstractSigner`).
 * Pass as the second argument to `new Client(config, signer)`.
 */
export type SignerType = Signer;

/**
 * claimIncentives Response
 */
export type ClaimIncentivesResponse = { txHash: string | null };

/**
 * A single problem found by a pre-flight check.
 */
export type PreflightIssue = {
  /** Stable, machine-readable issue code. */
  code: string;

  /** Human-readable description of the problem. */
  message: string;

  /** Short suggestion for what to do next. */
  hint: string;

  /**
   * How serious the issue is. `error` (the default when omitted) means the
   * operation would fail or should not go ahead; `warning` and `info` are
   * advisory and do not affect `ok`.
   */
  severity?: PreflightSeverity;
};

/** Severity of a {@link PreflightIssue}. */
export type PreflightSeverity = 'error' | 'warning' | 'info';

/**
 * Result of a read-only pre-flight check. `ok` is `true` when no issue has
 * `error` severity (issues without a `severity` count as errors).
 */
export type PreflightResult = {
  ok: boolean;
  issues: PreflightIssue[];
};

/** Options for {@link Client.preflightCreate}. */
export type PreflightCreateOptions = {
  /**
   * Cluster definition version to check against. Defaults to
   * {@link CONFIG_VERSION}.
   */
  version?: string;
};

/** Options for {@link Client.preflightAccept}. */
export type PreflightAcceptOptions = {
  /** The operator's ENR (Ethereum Node Record). */
  enr: string;

  /** Operator address to check. Defaults to the signer's address. */
  address?: string;

  /**
   * Version the operator payload will carry. When given, it must equal the
   * definition's version.
   */
  version?: string;
};

/** Options for {@link Client.createClusterDefinition}. */
export type CreateClusterDefinitionOptions = {
  /**
   * Cluster definition version to create. Defaults to {@link CONFIG_VERSION},
   * or to the existing definition's version when `resumeFrom` is set.
   */
  version?: string;

  /**
   * `config_hash` of a definition this signer already created with the same
   * payload (e.g. from an earlier attempt whose follow-up steps failed). When
   * it matches, nothing is signed or submitted and this `config_hash` is
   * returned.
   */
  resumeFrom?: string;
};

/**
 * Represents the structure of an Ethereum operator for exit validation, primarily their ENR.
 */
export interface ExitOperator {
  /** The operator's Ethereum Node Record (ENR). */
  enr: string;
}

/**
 * Represents the core definition of a cluster relevant for exit validation.
 */
export interface ExitClusterDefinition {
  /** The cluster nodes operators with their ENRs. */
  operators: ExitOperator[];

  /** The cluster fork version. */
  fork_version: string;

  /** The distributed validator threshold. */
  threshold: number;
}

/**
 * Represents a distributed validator's information relevant for exit validation.
 */
export interface ExitDistributedValidator {
  /** The public key of the distributed validator. */
  distributed_public_key: string;

  /** The public key shares of the distributed validator. */
  public_shares: string[];
}

/**
 * Combined cluster information needed for exit validation in the SDK.
 */
export interface ExitClusterConfig {
  /** The cluster definition with operators, fork version and threshold. */
  definition: ExitClusterDefinition;

  /** The cluster distributed validators. */
  distributed_validators: ExitDistributedValidator[];
}

/**
 * Represents the message part of a signed exit for exit validation.
 */
export interface ExitValidationMessage {
  /** The epoch at which the validator wishes to exit. */
  epoch: string;

  /** The index of the validator in the beacon chain. */
  validator_index: string;
}

/**
 * Represents a signed exit message for exit validation.
 */
export interface SignedExitValidationMessage {
  /** The exit message containing epoch and validator index. */
  message: ExitValidationMessage;

  /** BLS signature of the exit message. */
  signature: string;
}

/**
 * Represents a single partial exit blob for exit validation.
 */
export interface ExitValidationBlob {
  /** The public key of the validator to exit. */
  public_key: string;

  /** The signed exit message for the validator. */
  signed_exit_message: SignedExitValidationMessage;
}

/**
 * Represents the overall exit payload structure for exit validation.
 */
export interface ExitValidationPayload {
  /** Array of partial exits for validators. */
  partial_exits: ExitValidationBlob[];

  /** Operator's share index (1-based). */
  share_idx: number;

  /** Signature of the ExitValidationPayload by the operator. */
  signature: string;
}

/**
 * Represents the data structure for an already existing exit blob for exit validation.
 */
export interface ExistingExitValidationBlobData {
  /**
   * The BLS public key of the validator in hex format
   */
  public_key: string;
  /**
   * The epoch number when the exit is scheduled to occur
   */
  epoch: string;
  /**
   * The unique index of the validator in the beacon chain
   */
  validator_index: string;
  /**
   * Array of distributed validator shares exit data, where each share contains
   * the partial exit signature from each operator in the cluster
   */
  shares_exit_data: Array<Record<string, { partial_exit_signature: string }>>;
}

// ExitBlob is an exit message alongside its BLS12-381 hex-encoded signature.
export interface FullExitBlob {
  /**
   * The signed voluntary exit message containing the exit details and signature
   */
  signed_exit_message: {
    /**
     * The voluntary exit message details
     */
    message: {
      /**
       * The epoch number when the validator exit will be processed
       */
      epoch: string;
      /**
       * The unique index of the validator requesting to exit
       */
      validator_index: string;
    };
    /**
     * The BLS12-381 hex-encoded signature of the exit message
     */
    signature: string;
  };

  /** The public key of the validator to exit. */
  public_key: string;
}

/**
 * Generic HTTP request function type.
 * Args:
 *  url: string - The URL to request.
 *  config?: Record<string, any> - Optional request configuration (e.g., method, headers, body for POST).
 * Returns:
 *  Promise<any> - The response data.
 */
export type HttpRequestFunc = (
  url: string,
  config?: Record<string, any>,
) => Promise<any>;

/**
 * OVM Arguments for contract creation
 */
export type OVMArgs = {
  /** Owner address for the OVM contract. */
  OVMOwnerAddress: string;

  /** Principal recipient address. */
  principalRecipient: string;

  /** Rewards recipient of the cluster. */
  rewardRecipient: string;

  /** Principal threshold in ETH for OVM contract. */
  principalThreshold: number;
};

export type ChainConfig = {
  SPLITMAIN_CONTRACT: {
    address: string;
    bytecode: string;
  };
  MULTICALL3_CONTRACT: {
    address: string;
    bytecode: string;
  };
  OWR_FACTORY_CONTRACT: {
    address: string;
    bytecode: string;
  };
  RETROACTIVE_FUNDING_CONTRACT: {
    address: string;
    bytecode: string;
  };
  OVM_FACTORY_CONTRACT?: {
    address: string;
    bytecode: string;
  };
  WAREHOUSE_CONTRACT?: {
    address: string;
    bytecode: string;
  };
  SPLIT_V2_FACTORY_CONTRACT?: {
    address: string;
    bytecode: string;
  };
  EOA_WITHDRAWAL_CONTRACT?: {
    address: string;
  };
  BATCH_DEPOSIT_CONTRACT?: {
    address: string;
  };
};

/**
 * Input payload for {@link ObolSplits.requestWithdrawal}.
 * Requests withdrawal of validator funds from an OVM contract.
 */
export type OVMRequestWithdrawalPayload = {
  /**
   * Total withdrawal request fees in wei for all `pubKeys`. Optional: if
   * omitted, twice the current EIP-7002 fee per request is sent. If given, it
   * must cover the current fee and be at most max(10x the current fee, 1 gwei)
   * per request. The OVM refunds any excess to the OVM contract.
   */
  withdrawalFees?: string;

  /** OVM contract address */
  ovmAddress: string;

  /** Array of validator public keys in bytes format */
  pubKeys: string[];

  /** Array of withdrawal amounts in gwei (uint64) as strings */
  amounts: string[];
};

/**
 * Input payload for {@link EOA.requestWithdrawal}.
 */
export type EOAWithdrawalPayload = {
  /** Validator public key in hex format */
  pubkey: string;

  /** Withdrawal amount in ETH */
  allocation: number;

  /**
   * Fee in wei. Optional: if omitted, twice the current EIP-7002 fee is sent.
   * If given, it must cover the current fee and be at most
   * max(10x the current fee, 1 gwei).
   */
  requiredFee?: string;
};

/**
 * One deposit as taken by {@link EOA.deposit} and {@link ObolSplits.deposit},
 * and as returned by {@link Client.getDepositData} (`amount` in wei).
 */
export type ValidatorDeposit = {
  /** Validator public key in hex format (48 bytes) */
  pubkey: string;
  /** Withdrawal credentials in hex format */
  withdrawal_credentials: string;
  /** Deposit signature in hex format */
  signature: string;
  /** Deposit data root in hex format (32 bytes) */
  deposit_data_root: string;
  /** Deposit amount in wei as string */
  amount: string;
};

/**
 * Input payload for {@link ObolSplits.deposit}.
 * Deposits one or more validators to an OVM contract.
 */
export type OVMDepositPayload = {
  /** OVM contract address */
  ovmAddress: string;

  /** Array of deposit objects */
  deposits: ValidatorDeposit[];

  /**
   * Set when every deposit is a top-up to a validator that already exists on
   * the beacon chain (where the signature is not checked): skips the BLS
   * signature check, accepts all-zero withdrawal credentials as well as the
   * expected ones, and allows up to 2048 ETH per deposit. Ignored when
   * `beaconUrl` is set (the beacon node decides). Without either, deposits
   * with an all-zero signature are refused. Defaults to `false`.
   */
  skipSignatureVerification?: boolean;

  /**
   * Beacon node REST API base URL for this chain. When set, the deposits are
   * first checked with {@link checkExistingDeposits}: the call throws a
   * {@link DepositConflictError} if any pubkey has a pending deposit with
   * different withdrawal credentials. For deposits to validators that already
   * exist (top-ups) the BLS signature is not checked and the withdrawal
   * credentials may be all zero instead of the expected ones. All other
   * deposits must have a valid signature, whatever `skipSignatureVerification`
   * says.
   */
  beaconUrl?: string;
};

/**
 * Input payload for {@link EOA.deposit}.
 * Batch-deposits validators to the beacon chain via the Pier Two batch deposit contract.
 */
export type EOADepositPayload = {
  /** Array of deposit objects */
  deposits: ValidatorDeposit[];

  /**
   * If set, every deposit's withdrawal credentials must be 0x01 or 0x02
   * credentials for this address.
   */
  expectedWithdrawalAddress?: string;

  /**
   * Set when every deposit is a top-up to a validator that already exists on
   * the beacon chain (where the signature is not checked): skips the BLS
   * signature check, accepts all-zero withdrawal credentials as well as the
   * expected ones, and allows up to 2048 ETH per deposit. Ignored when
   * `beaconUrl` is set (the beacon node decides). Without either, deposits
   * with an all-zero signature are refused. Defaults to `false`.
   */
  skipSignatureVerification?: boolean;

  /**
   * Beacon node REST API base URL for this chain. When set, the deposits are
   * first checked with {@link checkExistingDeposits}: the call throws a
   * {@link DepositConflictError} if any pubkey has a pending deposit with
   * different withdrawal credentials. For deposits to validators that already
   * exist (top-ups) the BLS signature is not checked and the withdrawal
   * credentials may be all zero instead of the expected ones. All other
   * deposits must have a valid signature, whatever `skipSignatureVerification`
   * says.
   */
  beaconUrl?: string;
};

/**
 * Progress of a cluster from definition to published lock, as yielded by
 * {@link Client.watchCluster}.
 *
 * - `awaiting_signatures`: some operators have not yet accepted the definition
 *   (submitted their ENR, ENR signature and config signature).
 * - `definition_ready`: every operator has signed (or the definition has no
 *   operator addresses, as in solo and Charon-created definitions), so the DKG
 *   can run.
 * - `lock_published`: the DKG completed and a cluster lock is available.
 */
export type ClusterProgress =
  | {
      step: 'awaiting_signatures';
      /** Number of operators that have signed. */
      signed: number;
      /** Total number of operators. */
      total: number;
      /** Addresses of operators that have not signed yet. */
      pending: string[];
      definition: ClusterDefinition;
    }
  | {
      step: 'definition_ready';
      definition: ClusterDefinition;
    }
  | {
      step: 'lock_published';
      lockHash: string;
      lock: ClusterLock;
    };

/** Steps of {@link ClusterProgress}. */
export type ClusterProgressStep = ClusterProgress['step'];

/** Options for {@link Client.watchCluster}. */
export type WatchClusterOptions = {
  /** Stops polling; the generator throws `signal.reason`. */
  signal?: AbortSignal;
  /** Initial polling interval in ms (default 2000). */
  intervalMs?: number;
  /**
   * Upper bound for the polling interval in ms (default 30000). While nothing
   * changes, the interval grows by 1.5x up to this value; it resets on change.
   */
  maxIntervalMs?: number;
};

/** Options for {@link Client.waitFor}. */
export type WaitForOptions = WatchClusterOptions & {
  /** Called with every state {@link Client.watchCluster} yields. */
  onProgress?: (progress: ClusterProgress) => void;
  /**
   * Rejects with `ClusterProgressTimeoutError` after this many ms. Omitted or
   * `0` means no timeout (as for the Client's request `timeoutMs`).
   */
  timeoutMs?: number;
};
