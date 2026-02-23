import {
  type Wallet,
  type ethers,
  type JsonRpcApiProvider,
  type JsonRpcProvider,
  type JsonRpcSigner,
  type Provider,
} from 'ethers';

/**
 * Maps Ethereum consensus-layer fork versions (hex) to execution-layer chain IDs.
 *
 * Supported networks:
 * - `0x00000000` → 1 (Mainnet)
 * - `0x00001020` → 5 (Goerli/Prater) – deprecated
 * - `0x00000064` → 100 (Gnosis Chain)
 * - `0x01017000` → 17000 (Holesky)
 * - `0x90000069` → 11155111 (Sepolia)
 * - `0x10000910` → 560048 (Hoodi)
 */
export enum FORK_MAPPING {
  /** Mainnet. */
  '0x00000000' = 1,

  /** Goerli/Prater. */
  '0x00001020' = 5,

  /** Gnosis Chain. */
  '0x00000064' = 100,

  /** Holesky. */
  '0x01017000' = 17000,

  /** Sepolia. */
  '0x90000069' = 11155111,

  /** Hoodi Chain. */
  '0x10000910' = 560048,
}

export const FORK_NAMES: Record<number, string> = {
  [FORK_MAPPING['0x00000000']]: 'mainnet',
  [FORK_MAPPING['0x00001020']]: 'goerli',
  [FORK_MAPPING['0x00000064']]: 'gnosis',
  [FORK_MAPPING['0x01017000']]: 'holesky',
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
 * Requires at minimum `enr` (Ethereum Node Record) and `version`.
 * Other `ClusterOperator` fields are optional overrides.
 */
export type OperatorPayload = Partial<ClusterOperator> &
  Required<Pick<ClusterOperator, 'enr' | 'version'>>;

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
 * Accepted ethers provider types for on-chain reads.
 * Pass any of these as the third argument to `new Client(config, signer, provider)`.
 */
export type ProviderType =
  | Provider
  | JsonRpcProvider
  | JsonRpcApiProvider
  | ethers.BrowserProvider;

/**
 * Safe Wallet Provider Types
 */
export type SafeRpcUrl = string;

/**
 * Accepted ethers signer types for signing transactions and EIP-712 messages.
 * Pass as the second argument to `new Client(config, signer)`.
 */
export type SignerType = JsonRpcSigner | Wallet;

/**
 * claimIncentives Response
 */
export type ClaimIncentivesResponse = { txHash: string | null };

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
  /** request withdrawal fees in wei */
  withdrawalFees: string;

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

  /** Required fee in wei */
  requiredFee: string;
};

/**
 * Input payload for {@link ObolSplits.deposit}.
 * Deposits one or more validators to an OVM contract.
 */
export type OVMDepositPayload = {
  /** OVM contract address */
  ovmAddress: string;

  /** Array of deposit objects */
  deposits: Array<{
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
  }>;
};

/**
 * Input payload for {@link EOA.deposit}.
 * Batch-deposits validators to the beacon chain via the Pier Two batch deposit contract.
 */
export type EOADepositPayload = {
  /** Array of deposit objects */
  deposits: Array<{
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
  }>;
};
