import { UintNumberByteLen, UintNumberType } from "@chainsafe/ssz/lib/type/uint";
import { strToUint8Array } from "../utils"
import { builderRegistrationContainer, creatorAddressWrapperType, creatorContainerType, depositDataContainer, newCreatorContainerType, newOperatorContainerType, operatorAddressWrapperType, operatorContainerType, validatorsContainerType } from "./sszTypes";
import { ByteListType, ByteVectorType, ContainerType, ListBasicType, ListCompositeType, fromHexString } from "@chainsafe/ssz";
import { ValueOfFields } from "@chainsafe/ssz/lib/view/container";
import { ClusterDefintion, ClusterLock } from "../types";

// cluster defintion
type DefinitionFieldsV1X8 = {
    uuid: ByteListType;
    name: ByteListType;
    version: ByteListType;
    timestamp: ByteListType;
    num_validators: UintNumberType;
    threshold: UintNumberType;
    dkg_algorithm: ByteListType;
    fork_version: ByteVectorType;
    operators: ListCompositeType<
        typeof operatorContainerType | typeof operatorAddressWrapperType
    >;
    creator: typeof creatorContainerType | typeof creatorAddressWrapperType;
    validators: ListCompositeType<typeof validatorsContainerType>;
    deposit_amounts: ListBasicType<UintNumberType>;
    config_hash?: ByteVectorType;
};

type DefinitionContainerTypeV1X8 = ContainerType<DefinitionFieldsV1X8>;

/**
 * Returns the containerized cluster definition
 * @param cluster ClusterDefinition to calculate the type from
 * @returns SSZ Containerized type of cluster input
 */
export const clusterDefinitionContainerTypeV1X8 = (
    configOnly: boolean,
): DefinitionContainerTypeV1X8 => {
    let returnedContainerType: any = {
        uuid: new ByteListType(64),
        name: new ByteListType(256),
        version: new ByteListType(16),
        timestamp: new ByteListType(32),
        num_validators: new UintNumberType(8 as UintNumberByteLen),
        threshold: new UintNumberType(8 as UintNumberByteLen),
        dkg_algorithm: new ByteListType(32),
        fork_version: new ByteVectorType(4),
        operators: new ListCompositeType(newOperatorContainerType(configOnly), 256),
        creator: newCreatorContainerType(configOnly),
        validators: new ListCompositeType(validatorsContainerType, 65536),
        deposit_amounts: new ListBasicType(
            new UintNumberType(8 as UintNumberByteLen),
            256,
        ),
    };

    if (!configOnly) {
        returnedContainerType = {
            ...returnedContainerType,
            config_hash: new ByteVectorType(32),
        };
    }

    return new ContainerType(returnedContainerType);
};

export const hashClusterDefinitionV1X8 = (
    cluster: ClusterDefintion,
    configOnly: boolean,
): ValueOfFields<DefinitionFieldsV1X8> => {
    const definitionType = clusterDefinitionContainerTypeV1X8(configOnly);

    const val = definitionType.defaultValue();

    //order should be same as charon https://github.com/ObolNetwork/charon/blob/main/cluster/ssz.go#L276
    val.uuid = strToUint8Array(cluster.uuid);
    val.name = strToUint8Array(cluster.name);
    val.version = strToUint8Array(cluster.version);
    val.timestamp = strToUint8Array(cluster.timestamp);
    val.num_validators = cluster.num_validators;
    val.threshold = cluster.threshold;
    val.dkg_algorithm = strToUint8Array(cluster.dkg_algorithm);
    val.fork_version = fromHexString(cluster.fork_version);
    val.operators = cluster.operators.map(operator => {
        return configOnly
            ? { address: fromHexString(operator.address) }
            : {
                address: fromHexString(operator.address),
                enr: strToUint8Array(operator.enr as string),
                config_signature: fromHexString(operator.config_signature as string),
                enr_signature: fromHexString(operator.enr_signature as string),
            };
    });
    val.creator = configOnly
        ? { address: fromHexString(cluster.creator.address) }
        : {
            address: fromHexString(cluster.creator.address),
            config_signature: fromHexString(cluster.creator.config_signature as string),
        };
    val.validators = cluster.validators.map((validator) => {
        return {
            fee_recipient_address: fromHexString(validator.fee_recipient_address),
            withdrawal_address: fromHexString(validator.withdrawal_address),
        };
    });
    val.deposit_amounts = cluster.deposit_amounts?.map((amount: string) => {
        return parseInt(amount);
    }) || ["32000000000"].map((amount: string) => {
        return parseInt(amount);
    });

    if (!configOnly) {
        val.config_hash = fromHexString(cluster.config_hash);
    }
    return val;
};

// cluster lock

const dvContainerTypeV1X8 = new ContainerType({
    distributed_public_key: new ByteVectorType(48),
    public_shares: new ListCompositeType(new ByteVectorType(48), 256),
    partial_deposit_data: new ListCompositeType(depositDataContainer, 256),
    builder_registration: builderRegistrationContainer,
})

type LockContainerTypeV1X8 = ContainerType<{
    cluster_definition: DefinitionContainerTypeV1X8;
    distributed_validators: ListCompositeType<typeof dvContainerTypeV1X8>;
}>;

/**
 * @returns SSZ Containerized type of cluster lock
 */
const clusterLockContainerTypeV1X8 = (): LockContainerTypeV1X8 => {
    return new ContainerType({
        cluster_definition: clusterDefinitionContainerTypeV1X8(false),
        distributed_validators: new ListCompositeType(dvContainerTypeV1X8, 65536),
    })
}

/**
 * @param cluster The published cluster lock
 * @returns The lock hash in of the corresponding cluster
 */
export const hashClusterLockV1X8 = (cluster: ClusterLock): string => {
    const lockType = clusterLockContainerTypeV1X8()

    const val = lockType.defaultValue()

    // Check if we can replace with definition_hash
    val.cluster_definition = hashClusterDefinitionV1X8(
        cluster.cluster_definition,
        false,
    )
    val.distributed_validators = cluster.distributed_validators.map(dVaidator => {
        return {
            distributed_public_key: fromHexString(dVaidator.distributed_public_key),
            public_shares: dVaidator.public_shares.map(publicShare =>
                fromHexString(publicShare),
            ),
            //should be fixed
            partial_deposit_data: (dVaidator.partial_deposit_data || []).map(depositData => {
                return {
                    pubkey: fromHexString(depositData.pubkey as string),
                    withdrawal_credentials: fromHexString(
                        depositData.withdrawal_credentials as string,
                    ),
                    amount: parseInt(depositData.amount as string),
                    signature: fromHexString(depositData.signature as string),
                };
            }),
            builder_registration: {
                message: {
                    fee_recipient: fromHexString(
                        dVaidator.builder_registration.message.fee_recipient,
                    ),
                    gas_limit: dVaidator.builder_registration.message.gas_limit,
                    timestamp: dVaidator.builder_registration.message.timestamp,
                    pubkey: fromHexString(dVaidator.builder_registration.message.pubkey),
                },
                signature: fromHexString(dVaidator.builder_registration.signature),
            },
        };
    });

    return '0x' + Buffer.from(lockType.hashTreeRoot(val).buffer).toString('hex')
}






