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
}

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
  /** The validator fee recipient address. */
  fee_recipient_address: string;

  /** The validator reward address. */
  withdrawal_address: string;
};

/**
 * Splitter withdrawal returned type
 */
export type SplitterReturnedType = {
  /** The validator fee recipient address. */
  feeRecipientAddress: string;

  /** The validator reward address. */
  withdrawalAddress: string;
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

  /** Maximum number of validators with this configuration. */
  ObolRAFSplit?: number,

  /** Fees paid to the distributor. */
  distributorFee?: number,

  /** Address that can mutate the split, should be ZeroAddress for immutable split. */
  controllerAddress?: string,
};

/**
 * OWR and Split Proxy Params
 */
export interface RewardsSplitPayload extends TotalSplitPayload {
  /** Address that will reclaim validator principal after exit. */
  principalRecipient: string;

  /** Maximum number of validators needed for the OWR configuration. */
  validatorsSize: number;
}

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
 * String expected to be Ethereum Address
 */
export type ETH_ADDRESS = string;
