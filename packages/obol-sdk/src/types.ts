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

type ClusterValidator  = {
  fee_recipient_address: string;
  withdrawal_address: string;
}

export type Cluster = {
  name:string;
  operators:ClusterOperator[] ;
  creator:ClusterCreator;
  uuid: string;
  version: string;
  num_validators: number;
  threshold:number;
  dkg_algorithm:string;
  fork_version:string;
  timestamp:string;
  validators: ClusterValidator[];
  config_hash:string;
};

