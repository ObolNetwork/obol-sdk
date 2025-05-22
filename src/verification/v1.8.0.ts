import {
  type UintNumberByteLen,
  UintNumberType,
} from '@chainsafe/ssz/lib/type/uint';
import { strToUint8Array } from '../utils';
import {
  builderRegistrationContainer,
  type creatorAddressWrapperType,
  type creatorContainerType,
  depositDataContainer,
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
  ListBasicType,
  ListCompositeType,
  fromHexString,
} from '@chainsafe/ssz';
import { type ValueOfFields } from '@chainsafe/ssz/lib/view/container';
import {
  type ClusterDefinition,
  type ClusterLock,
  type DepositData,
} from '../types';
import {
  verifyBuilderRegistration,
  verifyDepositData,
  verifyNodeSignatures,
} from './common';
import {
  aggregateSignatures,
  verifyAggregate,
  verifyMultiple,
} from '@chainsafe/bls';

// cluster definition
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
  cluster: ClusterDefinition,
  configOnly: boolean,
): ValueOfFields<DefinitionFieldsV1X8> => {
  const definitionType = clusterDefinitionContainerTypeV1X8(configOnly);

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
  if (cluster.deposit_amounts) {
    val.deposit_amounts = cluster.deposit_amounts.map((amount: string) => {
      return parseInt(amount);
    });
  }

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
});

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
  });
};

/**
 * @param cluster The published cluster lock
 * @returns The lock hash in of the corresponding cluster
 */
export const hashClusterLockV1X8 = (cluster: ClusterLock): string => {
  const lockType = clusterLockContainerTypeV1X8();

  const val = lockType.defaultValue();

  // Check if we can replace with definition_hash
  val.cluster_definition = hashClusterDefinitionV1X8(
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
        // should be fixed
        partial_deposit_data: (
          dValidator.partial_deposit_data as DepositData[]
        ).map(depositData => {
          return {
            pubkey: fromHexString(depositData.pubkey),
            withdrawal_credentials: fromHexString(
              depositData.withdrawal_credentials,
            ),
            amount: parseInt(depositData.amount),
            signature: fromHexString(depositData.signature),
          };
        }),
        builder_registration: {
          message: {
            fee_recipient: fromHexString(
              dValidator.builder_registration?.message.fee_recipient as string,
            ),
            gas_limit: dValidator.builder_registration?.message
              .gas_limit as number,
            timestamp: dValidator.builder_registration?.message
              .timestamp as number,
            pubkey: fromHexString(
              dValidator.builder_registration?.message.pubkey as string,
            ),
          },
          signature: fromHexString(
            dValidator.builder_registration?.signature as string,
          ),
        },
      };
    },
  );

  return '0x' + Buffer.from(lockType.hashTreeRoot(val).buffer).toString('hex');
};

// DV verification
export const verifyDVV1X8 = (clusterLock: ClusterLock): boolean => {
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

    // Check deposit amounts match exactly if they are defined
    const depositAmounts = clusterLock.cluster_definition.deposit_amounts;
    if (depositAmounts !== null) {
      const partialDepositAmounts = (validator.partial_deposit_data as DepositData[]).map(d => d.amount);
      if (depositAmounts?.length !== partialDepositAmounts.length) {
        return false;
      }
      // Check that both arrays contain exactly the same elements
      const sortedDepositAmounts = [...depositAmounts].sort();
      const sortedPartialAmounts = [...partialDepositAmounts].sort();
      if (!sortedDepositAmounts.every((amount, index) => amount === sortedPartialAmounts[index])) {
        return false;
      }
    }
    // Deposit Data Verification
    for (const element of validator.partial_deposit_data as DepositData[]) {
      const depositData = element;
      const { isValidDepositData, depositDataMsg } = verifyDepositData(
        distributedPublicKey,
        depositData as Partial<DepositData>,
        clusterLock.cluster_definition.validators[i].withdrawal_address,
        clusterLock.cluster_definition.fork_version,
        clusterLock.cluster_definition.compounding,
      );

      if (!isValidDepositData) {
        return false;
      }

      pubKeys.push(fromHexString(distributedPublicKey));
      builderRegistrationAndDepositDataMessages.push(depositDataMsg);
      blsSignatures.push(fromHexString(depositData?.signature));
    }

    // Builder Registration Verification
    const { isValidBuilderRegistration, builderRegistrationMsg } =
      verifyBuilderRegistration(
        validator,
        clusterLock.cluster_definition.validators[i].fee_recipient_address,
        clusterLock.cluster_definition.fork_version,
      );

    if (!isValidBuilderRegistration) {
      return false;
    }

    pubKeys.push(fromHexString(distributedPublicKey));
    builderRegistrationAndDepositDataMessages.push(builderRegistrationMsg);
    blsSignatures.push(
      fromHexString(validator.builder_registration?.signature as string),
    );
  }

  // BLS signatures verification
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

  // Node Signatures verification
  if (!verifyNodeSignatures(clusterLock)) {
    return false;
  }

  // signature_aggregate verification
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
