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

export interface ClusterPayload  {
  name:string;
  operators:ClusterOperator[] ;
  uuid: string;
  num_validators: number;
  threshold:number;
  timestamp:string;
  validators: ClusterValidator[];
};

export interface Cluster extends ClusterPayload{
  creator:ClusterCreator;
  version: string;
  dkg_algorithm:string;
  fork_version:string;
  config_hash:string;
};

