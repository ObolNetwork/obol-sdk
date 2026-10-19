/**
 * Loose structural view of cluster files read by the internal SSZ hashing and
 * BLS check helpers (carried over from SDK 2.x). The public, validated shapes
 * live in `cluster/schema.ts`.
 */

/** A node operator in a cluster definition. */
export type ClusterOperator = {
  address: string;
  enr?: string;
  fork_version?: string;
  version?: string;
  enr_signature?: string;
  config_signature?: string;
};

/** The cluster creator. */
export type ClusterCreator = {
  address: string;
  config_signature?: string;
};

/** Per-validator fee recipient and withdrawal address. */
export type ClusterValidator = {
  fee_recipient_address: string;
  withdrawal_address: string;
};

/** A cluster definition as hashed by the SSZ helpers. */
export interface ClusterDefinition {
  name: string;
  operators: ClusterOperator[];
  validators: ClusterValidator[];
  /** Partial deposit amounts in gwei. */
  deposit_amounts?: string[] | null;
  compounding?: boolean;
  target_gas_limit?: number;
  consensus_protocol?: string;
  creator: ClusterCreator;
  version: string;
  dkg_algorithm: string;
  fork_version: string;
  uuid: string;
  timestamp: string;
  config_hash: string;
  threshold: number;
  num_validators: number;
  definition_hash?: string;
}

/** Unsigned builder registration message. */
export type BuilderRegistrationMessage = {
  fee_recipient: string;
  gas_limit: number;
  timestamp: number;
  pubkey: string;
};

/** Signed builder registration. */
export type BuilderRegistration = {
  message: BuilderRegistrationMessage;
  signature: string;
};

/** Pubkey + message + signature checked together in batch BLS verification. */
export type BlsSignatureCheck = {
  pubkey: Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
};

/** Deposit data of a distributed validator (amount in gwei). */
export type DepositData = {
  pubkey: string;
  withdrawal_credentials: string;
  amount: string;
  deposit_data_root: string;
  signature: string;
};

/** A distributed validator within a cluster lock. */
export type DistributedValidator = {
  distributed_public_key: string;
  public_shares: string[];
  /** v1.6 / v1.7 single deposit. */
  deposit_data?: Partial<DepositData>;
  /** v1.8+ partial deposits. */
  partial_deposit_data?: Array<Partial<DepositData>>;
  builder_registration?: BuilderRegistration;
};

/** A cluster lock as hashed by the SSZ helpers. */
export type ClusterLock = {
  cluster_definition: ClusterDefinition;
  distributed_validators: DistributedValidator[];
  signature_aggregate: string;
  lock_hash: string;
  node_signatures?: string[];
};
