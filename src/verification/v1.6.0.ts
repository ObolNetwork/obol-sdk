import {
  type UintNumberByteLen,
  UintNumberType,
} from '@chainsafe/ssz/lib/type/uint';
import { strToUint8Array } from '../utils';
import {
  type creatorAddressWrapperType,
  type creatorContainerType,
  newCreatorContainerType,
  newOperatorContainerType,
  type operatorAddressWrapperType,
  type operatorContainerType,
  validatorsContainerType,
} from './sszTypes';
import {
  ByteListType,
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  fromHexString,
} from '@chainsafe/ssz';
import { type ValueOfFields } from '@chainsafe/ssz/lib/view/container';
import {
  type ClusterDefinition,
  type ClusterLock,
  type DepositData,
} from '../types';
import { verifyDepositData } from './common';
import {
  aggregateSignatures,
  verifyAggregate,
  verifyMultiple,
} from '@chainsafe/bls';

// cluster definition
type DefinitionFieldsV1X6 = {
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

type DefinitionContainerTypeV1X6 = ContainerType<DefinitionFieldsV1X6>;

/**
 * Returns the containerized cluster definition
 * @param cluster ClusterDefinition to calculate the type from
 * @returns SSZ Containerized type of cluster input
 */
export const clusterDefinitionContainerTypeV1X6 = (
  configOnly: boolean,
): DefinitionContainerTypeV1X6 => {
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
  };

  if (!configOnly) {
    returnedContainerType = {
      ...returnedContainerType,
      config_hash: new ByteVectorType(32),
    };
  }

  return new ContainerType(returnedContainerType);
};

export const hashClusterDefinitionV1X6 = (
  cluster: ClusterDefinition,
  configOnly: boolean,
): ValueOfFields<DefinitionFieldsV1X6> => {
  const definitionType = clusterDefinitionContainerTypeV1X6(configOnly);

  const val = definitionType.defaultValue();

  // order should be same as charon https://github.com/ObolNetwork/charon/blob/main/cluster/ssz.go#L276
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
        config_signature: fromHexString(
          cluster.creator.config_signature as string,
        ),
      };
  val.validators = cluster.validators.map(validator => {
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

// cluster lock

const dvContainerTypeV1X6 = new ContainerType({
  distributed_public_key: new ByteVectorType(48),
  public_shares: new ListCompositeType(new ByteVectorType(48), 256),
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8 as UintNumberByteLen),
  signature: new ByteVectorType(96),
});

type LockContainerTypeV1X6 = ContainerType<{
  cluster_definition: DefinitionContainerTypeV1X6;
  distributed_validators: ListCompositeType<typeof dvContainerTypeV1X6>;
}>;

/**
 * @returns SSZ Containerized type of cluster lock
 */
const clusterLockContainerTypeV1X6 = (): LockContainerTypeV1X6 => {
  return new ContainerType({
    cluster_definition: clusterDefinitionContainerTypeV1X6(false),
    distributed_validators: new ListCompositeType(dvContainerTypeV1X6, 65536),
  });
};

/**
 * @param cluster The published cluster lock
 * @returns The lock hash in of the corresponding cluster
 */
export const hashClusterLockV1X6 = (cluster: ClusterLock): string => {
  const lockType = clusterLockContainerTypeV1X6();

  const val = lockType.defaultValue();

  // Check if we can replace with definition_hash
  val.cluster_definition = hashClusterDefinitionV1X6(
    cluster.cluster_definition,
    false,
  );
  val.distributed_validators = cluster.distributed_validators.map(
    dValidator => {
      return {
        distributed_public_key: fromHexString(
          dValidator.distributed_public_key,
        ),
        public_shares: dValidator.public_shares.map(publicShare =>
          fromHexString(publicShare),
        ),
        pubkey: fromHexString(dValidator.deposit_data?.pubkey as string),
        withdrawal_credentials: fromHexString(
          dValidator.deposit_data?.withdrawal_credentials as string,
        ),
        amount: parseInt(dValidator.deposit_data?.amount as string),
        signature: fromHexString(dValidator.deposit_data?.signature as string),
      };
    },
  );

  return '0x' + Buffer.from(lockType.hashTreeRoot(val).buffer).toString('hex');
};

// DV verification
export const verifyDVV1X6 = (clusterLock: ClusterLock): boolean => {
  const validators = clusterLock.distributed_validators;
  const pubShares = [];
  const pubKeys = [];
  const builderRegistrationAndDepositDataMessages = [];
  const blsSignatures = [];

  for (let i = 0; i < validators.length; i++) {
    const validator = validators[i];
    const validatorPublicShares = validator.public_shares;
    const distributedPublicKey = validator.distributed_public_key;

    // Needed in signature_aggregate verification
    for (const element of validatorPublicShares) {
      pubShares.push(fromHexString(element));
    }

    const { isValidDepositData, depositDataMsg } = verifyDepositData(
      distributedPublicKey,
      validator.deposit_data as Partial<DepositData>,
      clusterLock.cluster_definition.validators[i].withdrawal_address,
      clusterLock.cluster_definition.fork_version,
    );

    if (!isValidDepositData) {
      return false;
    }

    pubKeys.push(fromHexString(validator.distributed_public_key));
    builderRegistrationAndDepositDataMessages.push(depositDataMsg);
    blsSignatures.push(
      fromHexString(validator.deposit_data?.signature as string),
    );
  }

  const aggregateBLSSignature = aggregateSignatures(blsSignatures);

  if (
    !verifyMultiple(
      pubKeys,
      builderRegistrationAndDepositDataMessages,
      aggregateBLSSignature,
    )
  ) {
    return false;
  }

  if (
    !verifyAggregate(
      pubShares,
      fromHexString(clusterLock.lock_hash),
      fromHexString(clusterLock.signature_aggregate),
    )
  ) {
    return false;
  }

  return true;
};
