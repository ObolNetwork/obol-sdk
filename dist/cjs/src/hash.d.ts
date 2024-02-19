import { ContainerType, ByteVectorType, UintNumberType, ListCompositeType, ByteListType } from '@chainsafe/ssz';
import { ValueOfFields } from '@chainsafe/ssz/lib/view/container.js';
import { ClusterDefintion } from './types.js';
/**
 * Returns the SSZ cluster config hash or the definition hash of the given cluster definition object
 * @param cluster The cluster whose config hash or definition hash needs to be calculated
 * @param configOnly A flag that indicates which hash to evaluate
 * @returns The config hash or he definition hash in of the corresponding cluster definition
 */
export declare const clusterConfigOrDefinitionHash: (cluster: ClusterDefintion, configOnly: boolean) => string;
export declare const hashClusterDefinitionV1X7: (cluster: ClusterDefintion, configOnly: boolean) => ValueOfFields<DefinitionFieldsV1X7>;
/**
 * Converts a string to a Uint8Array
 * @param str The string to convert
 * @returns The converted Uint8Array
 */
export declare const strToUint8Array: (str: string) => Uint8Array;
/**
 * operatorContainerType is an SSZ Composite Container type for Operator.
 * Note that the type has fixed size for address as it is an ETH1 address (20 bytes).
 */
declare const operatorAddressWrapperType: ContainerType<{
    address: ByteVectorType;
}>;
declare const creatorAddressWrapperType: ContainerType<{
    address: ByteVectorType;
}>;
export declare const operatorContainerType: ContainerType<{
    address: ByteVectorType;
    enr: ByteListType;
    config_signature: ByteVectorType;
    enr_signature: ByteVectorType;
}>;
export declare const creatorContainerType: ContainerType<{
    address: ByteVectorType;
    config_signature: ByteVectorType;
}>;
export declare const validatorsContainerType: ContainerType<{
    fee_recipient_address: ByteVectorType;
    withdrawal_address: ByteVectorType;
}>;
type DefinitionFieldsV1X7 = {
    uuid: ByteListType;
    name: ByteListType;
    version: ByteListType;
    timestamp: ByteListType;
    num_validators: UintNumberType;
    threshold: UintNumberType;
    dkg_algorithm: ByteListType;
    fork_version: ByteVectorType;
    operators: ListCompositeType<typeof operatorContainerType | typeof operatorAddressWrapperType>;
    creator: typeof creatorContainerType | typeof creatorAddressWrapperType;
    validators: ListCompositeType<typeof validatorsContainerType>;
    config_hash?: ByteVectorType;
};
export type DefinitionContainerTypeV1X7 = ContainerType<DefinitionFieldsV1X7>;
/**
 * Returns the containerized cluster definition
 * @param cluster ClusterDefinition to calculate the type from
 * @returns SSZ Containerized type of cluster input
 */
export declare const clusterDefinitionContainerTypeV1X7: (configOnly: boolean) => DefinitionContainerTypeV1X7;
export {};
