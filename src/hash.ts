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
import { ClusterDefintion, ClusterLock } from './types.js';
import { strToUint8Array } from './utils.js';

//cluster-definition

/**
 * @param cluster The cluster configuration or the cluster definition
 * @param configOnly a boolean to indicate config hash or definition hash
 * @returns The config hash or the definition hash in of the corresponding cluster
 */
export const clusterConfigOrDefinitionHash = (
  cluster: ClusterDefintion,
  configOnly: boolean,
): string => {

  const definitionType = clusterDefinitionContainerType(configOnly);
  const val = hashClusterDefinition(cluster, configOnly);
  return (
    '0x' + Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
  );
};

export const hashClusterDefinition = (
  cluster: ClusterDefintion,
  configOnly: boolean,
): ValueOfFields<DefinitionFields> => {
  const definitionType = clusterDefinitionContainerType(configOnly);

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

type DefinitionFields = {
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

export type DefinitionContainerType =
  ContainerType<DefinitionFields>;

/**
 * @param configOnly a boolean to indicate config hash or definition hash
 * @returns SSZ Containerized type of cluster definition
 */
export const clusterDefinitionContainerType = (
  configOnly: boolean,
): DefinitionContainerType => {
  let returnedContainerType: DefinitionFields = {
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

//cluster-lock

/**
 * @param cluster The published cluster lock 
 * @returns The lock hash in of the corresponding cluster
 */
export const clusterLockHash = (cluster: ClusterLock): string => {
  const lockType = clusterLockContainerType();

  const val = lockType.defaultValue();

  //Check if we can replace with definition_hash 
  val.cluster_definition = hashClusterDefinition(
    cluster.cluster_definition,
    false,
  );
  val.distributed_validators = cluster.distributed_validators.map(dVaidator => {
    return {
      distributed_public_key: fromHexString(dVaidator.distributed_public_key),
      public_shares: dVaidator.public_shares.map(publicShare =>
        fromHexString(publicShare),
      ),
      deposit_data: {
        pubkey: fromHexString(dVaidator.deposit_data.pubkey as string),
        withdrawal_credentials: fromHexString(
          dVaidator.deposit_data.withdrawal_credentials as string
        ),
        amount: parseInt(dVaidator.deposit_data.amount as string),
        signature: fromHexString(dVaidator.deposit_data.signature as string),
      },
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

  return '0x' + Buffer.from(lockType.hashTreeRoot(val).buffer).toString('hex');
};

const depositDataContainer = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8 as UintNumberByteLen),
  signature: new ByteVectorType(96),
});


const builderRegistrationMessageContainer = new ContainerType({
  fee_recipient: new ByteVectorType(20),
  gas_limit: new UintNumberType(8 as UintNumberByteLen),
  timestamp: new UintNumberType(8 as UintNumberByteLen),
  pubkey: new ByteVectorType(48),
});

const builderRegistrationContainer = new ContainerType({
  message: builderRegistrationMessageContainer,
  signature: new ByteVectorType(96),
});

const dvContainerType = new ContainerType({
  distributed_public_key: new ByteVectorType(48),
  public_shares: new ListCompositeType(new ByteVectorType(48), 256),
  deposit_data: depositDataContainer,
  builder_registration: builderRegistrationContainer,
});

type LockContainerType = ContainerType<{
  cluster_definition: DefinitionContainerType;
  distributed_validators: ListCompositeType<typeof dvContainerType>;
}>;

/**
 * @returns SSZ Containerized type of cluster lock
 */
const clusterLockContainerType = (): LockContainerType => {
  return new ContainerType({
    cluster_definition: clusterDefinitionContainerType(false),
    distributed_validators: new ListCompositeType(dvContainerType, 65536),
  });
};
