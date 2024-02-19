import {
  ContainerType,
  ByteVectorType,
  UintNumberType,
  ListCompositeType,
  ByteListType,
  fromHexString,
} from '@chainsafe/ssz';
import { UintNumberByteLen } from '@chainsafe/ssz/lib/type/uint.js';
import { ValueOfFields } from '@chainsafe/ssz/lib/view/container.js';
import { ClusterDefintion } from './types.js';

/**
 * Returns the SSZ cluster config hash or the definition hash of the given cluster definition object
 * @param cluster The cluster whose config hash or definition hash needs to be calculated
 * @param configOnly A flag that indicates which hash to evaluate
 * @returns The config hash or he definition hash in of the corresponding cluster definition
 */
export const clusterConfigOrDefinitionHash = (
  cluster: ClusterDefintion,
  configOnly: boolean,
): string => {

  const definitionType = clusterDefinitionContainerTypeV1X7(configOnly);
  const val = hashClusterDefinitionV1X7(cluster, configOnly);
  return (
    '0x' + Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
  );
};

export const hashClusterDefinitionV1X7 = (
  cluster: ClusterDefintion,
  configOnly: boolean,
): ValueOfFields<DefinitionFieldsV1X7> => {
  const definitionType = clusterDefinitionContainerTypeV1X7(configOnly);

  const val = definitionType.defaultValue();

  //order should be same as charon https://github.com/ObolNetwork/charon/blob/d00b31e6465a260a43ce40f15c47fb5a5b009042/cluster/ssz.go#L285
  val.uuid = strToUint8Array(cluster.uuid);
  val.name = strToUint8Array(cluster.name);
  val.version = strToUint8Array(cluster.version);
  val.timestamp = strToUint8Array(cluster.timestamp);
  val.num_validators = cluster.num_validators;
  val.threshold = cluster.threshold;
  val.dkg_algorithm = strToUint8Array(cluster.dkg_algorithm);
  val.fork_version = fromHexString(cluster.fork_version);
  val.operators = cluster.operators.map((operator) => {
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
  val.validators = cluster.validators.map((validator: { fee_recipient_address: string; withdrawal_address: string; }) => {
    return {
      fee_recipient_address: fromHexString(validator.fee_recipient_address),
      withdrawal_address: fromHexString(validator.withdrawal_address),
    };
  });

  if (!configOnly) {
    val.config_hash = fromHexString(cluster.config_hash);
  }
  return val;
};

/**
 * Converts a string to a Uint8Array
 * @param str The string to convert
 * @returns The converted Uint8Array
 */
export const strToUint8Array = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

/**
 * operatorContainerType is an SSZ Composite Container type for Operator.
 * Note that the type has fixed size for address as it is an ETH1 address (20 bytes).
 */
const operatorAddressWrapperType = new ContainerType({
  address: new ByteVectorType(20),
});

const creatorAddressWrapperType = new ContainerType({
  address: new ByteVectorType(20),
});

export const operatorContainerType = new ContainerType({
  address: new ByteVectorType(20),
  enr: new ByteListType(1024), // This needs to be dynamic, since ENRs do not have a fixed length.
  config_signature: new ByteVectorType(65),
  enr_signature: new ByteVectorType(65),
});

export const creatorContainerType = new ContainerType({
  address: new ByteVectorType(20),
  config_signature: new ByteVectorType(65),
});

export const validatorsContainerType = new ContainerType({
  fee_recipient_address: new ByteVectorType(20),
  withdrawal_address: new ByteVectorType(20),
});

const newCreatorContainerType = (configOnly: boolean) => {
  return configOnly ? creatorAddressWrapperType : creatorContainerType;
};

const newOperatorContainerType = (configOnly: boolean) => {
  return configOnly ? operatorAddressWrapperType : operatorContainerType;
};

type DefinitionFieldsV1X7 = {
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
  config_hash?: ByteVectorType;
};

export type DefinitionContainerTypeV1X7 =
  ContainerType<DefinitionFieldsV1X7>;

/**
 * Returns the containerized cluster definition
 * @param cluster ClusterDefinition to calculate the type from
 * @returns SSZ Containerized type of cluster input
 */
export const clusterDefinitionContainerTypeV1X7 = (
  configOnly: boolean,
): DefinitionContainerTypeV1X7 => {
  let returnedContainerType: DefinitionFieldsV1X7 = {
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
  };

  if (!configOnly) {
    returnedContainerType = {
      ...returnedContainerType,
      config_hash: new ByteVectorType(32),
    };
  }

  return new ContainerType(returnedContainerType);
};
