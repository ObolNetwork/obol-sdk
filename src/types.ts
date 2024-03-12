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
export interface ClusterOperator {
  /** The operator address. */
  address: string

  /** The operator ethereum node record. */
  enr?: string

  /** The cluster fork_version. */
  fork_version?: string

  /** The cluster version. */
  version?: string

  /** The operator enr signature. */
  enr_signature?: string

  /** The operator configuration signature. */
  config_signature?: string
}

/**
 * A partial view of `ClusterOperator` with `enr` and `version` as required properties.
 */
export type OperatorPayload = Partial<ClusterOperator> &
  Required<Pick<ClusterOperator, 'enr' | 'version'>>

/**
 * Cluster creator data
 */
export interface ClusterCreator {
  /** The creator address. */
  address: string
  /** The cluster configuration signature. */
  config_signature?: string
}

/**
 * Validator withdrawal configuration
 */
export interface ClusterValidator {
  /** The validator fee recipient address. */
  fee_recipient_address: string

  /** The validator reward address. */
  withdrawal_address: string
}

/**
 * Cluster configuration
 */
export interface ClusterPayload {
  /** The cluster name. */
  name: string

  /** The cluster nodes operators addresses. */
  operators: ClusterOperator[]

  /** The cluster validators information. */
  validators: ClusterValidator[]

  /** The cluster partial deposits in gwei or 32000000000. */
  deposit_amounts?: string[]
}

/**
 * Cluster definition data needed for dkg
 */
export interface ClusterDefintion extends ClusterPayload {
  /** The creator of the cluster. */
  creator: ClusterCreator

  /** The cluster configuration version. */
  version: string

  /** The cluster dkg algorithm. */
  dkg_algorithm: string

  /** The cluster fork version. */
  fork_version: string

  /** The cluster uuid. */
  uuid: string

  /** The cluster creation timestamp. */
  timestamp: string

  /** The cluster configuration hash. */
  config_hash: string

  /** The distributed validator threshold. */
  threshold: number

  /** The number of distributed validators in the cluster. */
  num_validators: number

  /** The cluster partial deposits in gwei or 32000000000. */
  deposit_amounts?: string[]

  /** The hash of the cluster definition. */
  definition_hash?: string
}

/**
 * Unsigned DV Builder Registration Message
 */
export interface BuilderRegistrationMessage {
  /** The DV fee recipient. */
  fee_recipient: string

  /** Default is 30000000. */
  gas_limit: number

  /** Timestamp when generating cluster lock file. */
  timestamp: number

  /** The public key of the DV. */
  pubkey: string
}

/**
 * Pre-generated Signed Validator Builder Registration
 */
export interface BuilderRegistration {
  /** Builder registration message. */
  message: BuilderRegistrationMessage

  /** BLS signature of the builder registration message. */
  signature: string
}

/**
 * Required deposit data for validator activation
 */
export interface DepositData {
  /** The public key of the distributed validator. */
  pubkey: string

  /** The 0x01 withdrawal address of the DV. */
  withdrawal_credentials: string

  /** 32 ethers. */
  amount: string

  /** A checksum for DepositData fields . */
  deposit_data_root: string

  /** BLS signature of the deposit message. */
  signature: string
}

/**
 * Required deposit data for validator activation
 */
export interface DistributedValidator {
  /** The public key of the distributed validator. */
  distributed_public_key: string

  /** The public key of the node distributed validator share. */
  public_shares: string[]

  /** The deposit data for activating the DV. */
  deposit_data?: Partial<DepositData>

  /** The deposit data with partial amounts or full amount for activating the DV. */
  partial_deposit_data?: Partial<DepositData>[]

  /** pre-generated signed validator builder registration to be sent to builder network. */
  builder_registration: BuilderRegistration
}


/**
 * Cluster Details after DKG is complete
 */
export interface ClusterLock {
  /** The cluster definition. */
  cluster_definition: ClusterDefintion

  /** The cluster distributed validators. */
  distributed_validators: DistributedValidator[]

  /** The cluster bls signature aggregate. */
  signature_aggregate: string

  /** The hash of the cluster lock. */
  lock_hash: string

  /** Node Signature for the lock hash by the node secp256k1 key. */
  node_signatures: string[]
}
