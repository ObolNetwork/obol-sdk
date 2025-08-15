import {
  type Wallet,
  type ethers,
  type JsonRpcApiProvider,
  type JsonRpcProvider,
  type JsonRpcSigner,
  type Provider,
} from 'ethers';

/**
 * Permitted ChainID's
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
 * Node operator data
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
 * A partial view of `ClusterOperator` with `enr` and `version` as required properties.
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
 * Cluster configuration
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
 * Cluster definition data needed for dkg
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
 * Split Recipient Keys
 */
export type SplitRecipient = {
  /** The split recipient address. */
  account: string;

  /** The recipient split. */
  percentAllocation: number;
};

/**
 * Split Proxy Params
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
 * OWR and Split Proxy Params
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
 * OVM and SplitV2 Base Params
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
 * OVM and SplitV2 Params for rewards-only split
 */
export type OVMRewardsSplitPayload = OVMBaseSplitPayload & {
  /** Principal recipient address (single address for rewards-only split). */
  principalRecipient: string;
};

/**
 * OVM and SplitV2 Params for total split scenario
 */
export type OVMTotalSplitPayload = OVMBaseSplitPayload & {
  /** Principal recipients addresses and splits (array for total split scenario). */
  principalSplitRecipients: SplitV2Recipient[];
};

/**
 * Union type for both OVM split scenarios
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
 * Required deposit data for validator activation
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
 * Cluster Details after DKG is complete
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
 * String expected to be Ethereum Address
 */
export type ETH_ADDRESS = string;

/**
 * Provider Types
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
 * Signer Types
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
 * Payload for requesting withdrawal from OVM contract
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
 * Payload for requesting withdrawal from EOA contract
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
 * Payload for depositing to OVM contract with multicall3
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
 * Payload for depositing to batch deposit contract
 */
export type EOADepositPayload = {
  /** Array of deposit objects */
  deposits: Array<{
    /** Validator public key in hex format (48 bytes) */
    pubKey: string;
    /** Withdrawal credentials in hex format */
    withdrawalCredentials: string;
    /** Deposit signature in hex format */
    signature: string;
    /** Deposit data root in hex format (32 bytes) */
    depositDataRoot: string;
    /** Deposit amount in wei as string */
    amount: string;
  }>;
};
