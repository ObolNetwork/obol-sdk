import { ethers, JsonRpcApiProvider, JsonRpcProvider, JsonRpcSigner, Provider, Signer } from "ethers";

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

/**
 * Permitted Chain Names
 */
export const FORK_NAMES: Record<number, string> = {
  /** Mainnet. */
  [FORK_MAPPING['0x00000000']]: 'mainnet',

  /** Goerli/Prater. */
  [FORK_MAPPING['0x00001020']]: 'goerli',

  /** Gnosis Chain. */
  [FORK_MAPPING['0x00000064']]: 'gnosis',

  /** Holesky. */
  [FORK_MAPPING['0x01017000']]: 'holesky',

  /** Sepolia. */
  [FORK_MAPPING['0x90000069']]: 'sepolia',

  /** Hoodi. */
  [FORK_MAPPING['0x10000910']]: 'hoodi',
};

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

  /** The target gas limit where default is 30M. */
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
 * Incentives
 */
export type Incentives = {
  /** Operator Address. */
  operator_address: string;

  /** The amount the recipient is entitled to. */
  amount: string;

  /** The recipient’s index in the Merkle tree. */
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
* Signer Types
*/
export type SignerType =
  Signer | JsonRpcSigner
