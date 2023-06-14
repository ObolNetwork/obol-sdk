type ClusterOperator = {
  address: string;
  enr?: string;
  fork_version?: string;
  version?: string;
  enr_signature?: string;
  config_signature?: string;
}

type ClusterCreator = {
  address: string;
  config_signature?: string;
}

type ClusterValidator = {
  fee_recipient_address: string;
  withdrawal_address: string;
}

export interface ClusterPayload {
  name: string;
  operators: ClusterOperator[];
  validators: ClusterValidator[];
};

export interface ClusterDefintion extends ClusterPayload {
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
};

type DistValidator = {
  distributed_public_key: string;
  public_shares: string[]
}

export interface ClusterLock {
  cluster_definition: ClusterDefintion;
  distributed_validators: DistValidator[];
  signature_aggregate: string;
  lock_hash: string
};

