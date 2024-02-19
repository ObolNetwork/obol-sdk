export declare const clusterLockV1X7: {
    cluster_definition: {
        name: string;
        creator: {
            address: string;
            config_signature: string;
        };
        operators: {
            address: string;
            enr: string;
            config_signature: string;
            enr_signature: string;
        }[];
        uuid: string;
        version: string;
        timestamp: string;
        num_validators: number;
        threshold: number;
        validators: {
            fee_recipient_address: string;
            withdrawal_address: string;
        }[];
        dkg_algorithm: string;
        fork_version: string;
        config_hash: string;
        definition_hash: string;
    };
    distributed_validators: {
        distributed_public_key: string;
        public_shares: string[];
        deposit_data: {
            pubkey: string;
            withdrawal_credentials: string;
            amount: string;
            signature: string;
            deposit_data_root: string;
        };
        builder_registration: {
            message: {
                fee_recipient: string;
                gas_limit: number;
                timestamp: number;
                pubkey: string;
            };
            signature: string;
        };
    }[];
    signature_aggregate: string;
    lock_hash: string;
    node_signatures: string[];
};
export declare const clusterConfig: {
    name: string;
    operators: {
        address: string;
    }[];
    validators: {
        fee_recipient_address: string;
        withdrawal_address: string;
    }[];
};
