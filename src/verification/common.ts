import { fromHexString } from '@chainsafe/ssz';
import elliptic from 'elliptic';
import { init } from '@chainsafe/bls';

import {
  FORK_MAPPING,
  type ClusterDefinition,
  type ClusterLock,
  type DepositData,
  type BuilderRegistrationMessage,
  type DistributedValidator,
} from '../types.js';
import * as semver from 'semver';
import {
  clusterDefinitionContainerTypeV1X6,
  hashClusterDefinitionV1X6,
  hashClusterLockV1X6,
  verifyDVV1X6,
} from './v1.6.0.js';
import {
  clusterDefinitionContainerTypeV1X7,
  hashClusterDefinitionV1X7,
  hashClusterLockV1X7,
  verifyDVV1X7,
} from './v1.7.0.js';
import {
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_DEPOSIT,
  DefinitionFlow,
  GENESIS_VALIDATOR_ROOT,
  signCreatorConfigHashPayload,
  signEnrPayload,
  signOperatorConfigHashPayload,
} from '../constants.js';
import {
  builderRegistrationMessageType,
  depositMessageType,
  forkDataType,
  signingRootType,
} from './sszTypes.js';
import { definitionFlow, hexWithout0x } from '../utils.js';
import { ENR } from '@chainsafe/discv5';
import {
  clusterDefinitionContainerTypeV1X8,
  hashClusterDefinitionV1X8,
  hashClusterLockV1X8,
  verifyDVV1X8,
} from './v1.8.0.js';
import { validateAddressSignature } from './signature-validator.js';

// cluster-definition hash

/**
 * @param cluster The cluster configuration or the cluster definition
 * @param configOnly a boolean to indicate config hash or definition hash
 * @returns The config hash or the definition hash in of the corresponding cluster
 */
export const clusterConfigOrDefinitionHash = (
  cluster: ClusterDefinition,
  configOnly: boolean,
): string => {
  let definitionType, val;

  if (semver.eq(cluster.version, 'v1.6.0')) {
    definitionType = clusterDefinitionContainerTypeV1X6(configOnly);
    val = hashClusterDefinitionV1X6(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  if (semver.eq(cluster.version, 'v1.7.0')) {
    definitionType = clusterDefinitionContainerTypeV1X7(configOnly);
    val = hashClusterDefinitionV1X7(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  if (semver.eq(cluster.version, 'v1.8.0')) {
    definitionType = clusterDefinitionContainerTypeV1X8(configOnly);
    val = hashClusterDefinitionV1X8(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  throw new Error('unsupported version');
};

// cluster-lock hash

/**
 * Returns the SSZ cluster lock hash of the given cluster lock object
 * @param cluster The cluster lock whose lock hash needs to be calculated
 * @returns The cluster lock hash in of the corresponding cluster lock
 */
export const clusterLockHash = (clusterLock: ClusterLock): string => {
  if (semver.eq(clusterLock.cluster_definition.version, 'v1.6.0')) {
    return hashClusterLockV1X6(clusterLock);
  }

  if (semver.eq(clusterLock.cluster_definition.version, 'v1.7.0')) {
    return hashClusterLockV1X7(clusterLock);
  }

  if (semver.eq(clusterLock.cluster_definition.version, 'v1.8.0')) {
    if (
      clusterLock.cluster_definition.deposit_amounts === null &&
      clusterLock.distributed_validators.some(
        distributedValidator =>
          distributedValidator.partial_deposit_data?.length !== 1 ||
          distributedValidator.partial_deposit_data[0].amount !== '32000000000',
      )
    ) {
      throw new Error(
        'mismatch between deposit_amounts and partial_deposit_data fields',
      );
    }
    return hashClusterLockV1X8(clusterLock);
  }

  // other versions
  throw new Error('unsupported version');
};

// Lock verification

// cluster-definition signatures verification

const validatePOSTConfigHashSigner = async (
  address: string,
  signature: string,
  configHash: string,
  chainId: FORK_MAPPING,
): Promise<boolean> => {
  try {
    const data = signCreatorConfigHashPayload(
      { creator_config_hash: configHash },
      chainId,
    );

    return await validateAddressSignature({
      address,
      token: signature,
      data,
      chainId,
    });
  } catch (err) {
    throw err;
  }
};

const validatePUTConfigHashSigner = async (
  address: string,
  signature: string,
  configHash: string,
  chainId: number,
): Promise<boolean> => {
  try {
    const data = signOperatorConfigHashPayload(
      { operator_config_hash: configHash },
      chainId,
    );
    return await validateAddressSignature({
      address,
      token: signature,
      data,
      chainId,
    });
  } catch (err) {
    throw err;
  }
};

const validateEnrSigner = async (
  address: string,
  signature: string,
  payload: string,
  chainId: number,
): Promise<boolean> => {
  try {
    const data = signEnrPayload({ enr: payload }, chainId);

    return await validateAddressSignature({
      address,
      token: signature,
      data,
      chainId,
    });
  } catch (err) {
    throw err;
  }
};

const verifyDefinitionSignatures = async (
  clusterDefinition: ClusterDefinition,
  definitionType: DefinitionFlow,
): Promise<boolean> => {
  if (definitionType === DefinitionFlow.Charon) {
    return true;
  } else {
    const isPOSTConfigHashSignerValid = await validatePOSTConfigHashSigner(
      clusterDefinition.creator.address,
      clusterDefinition.creator.config_signature as string,
      clusterDefinition.config_hash,
      FORK_MAPPING[clusterDefinition.fork_version as keyof typeof FORK_MAPPING],
    );

    if (!isPOSTConfigHashSignerValid) {
      return false;
    }
    if (definitionType === DefinitionFlow.Solo) {
      return true;
    }

    for (const operator of clusterDefinition.operators) {
      const isPUTConfigHashSignerValid = await validatePUTConfigHashSigner(
        operator.address,
        operator.config_signature as string,
        clusterDefinition.config_hash,
        FORK_MAPPING[
          clusterDefinition.fork_version as keyof typeof FORK_MAPPING
        ],
      );

      const isENRSignerValid = await validateEnrSigner(
        operator.address,
        operator.enr_signature as string,
        operator.enr as string,
        FORK_MAPPING[
          clusterDefinition.fork_version as keyof typeof FORK_MAPPING
        ],
      );

      if (!isPUTConfigHashSignerValid || !isENRSignerValid) {
        return false;
      }
    }

    return true;
  }
};

// cluster-lock data verification
const computeSigningRoot = (
  sszObjectRoot: Uint8Array,
  domain: Uint8Array,
): Uint8Array => {
  const signingRootDefaultValue = signingRootType.defaultValue();
  signingRootDefaultValue.objectRoot = sszObjectRoot;
  signingRootDefaultValue.domain = domain;
  return Buffer.from(
    signingRootType.hashTreeRoot(signingRootDefaultValue).buffer,
  );
};

const computeDepositMsgRoot = (msg: Partial<DepositData>): Buffer => {
  const depositMsgVal = depositMessageType.defaultValue();

  depositMsgVal.pubkey = fromHexString(msg.pubkey as string);
  depositMsgVal.withdrawal_credentials = fromHexString(
    msg.withdrawal_credentials as string,
  );
  depositMsgVal.amount = parseInt(msg.amount as string);
  return Buffer.from(depositMessageType.hashTreeRoot(depositMsgVal).buffer);
};

const computeForkDataRoot = (
  currentVersion: Uint8Array,
  genesisValidatorsRoot: Uint8Array,
): Uint8Array => {
  const forkDataVal = forkDataType.defaultValue();
  forkDataVal.currentVersion = currentVersion;
  forkDataVal.genesisValidatorsRoot = genesisValidatorsRoot;
  return Buffer.from(forkDataType.hashTreeRoot(forkDataVal).buffer);
};

const computebuilderRegistrationMsgRoot = (
  msg: BuilderRegistrationMessage,
): Buffer => {
  const builderRegistrationMsgVal =
    builderRegistrationMessageType.defaultValue();

  builderRegistrationMsgVal.fee_recipient = fromHexString(msg.fee_recipient);
  builderRegistrationMsgVal.gas_limit = msg.gas_limit;
  builderRegistrationMsgVal.timestamp = msg.timestamp;
  builderRegistrationMsgVal.pubkey = fromHexString(msg.pubkey);
  return Buffer.from(
    builderRegistrationMessageType.hashTreeRoot(builderRegistrationMsgVal)
      .buffer,
  );
};

const computeDomain = (
  domainType: Uint8Array,
  lockForkVersion: string,
  genesisValidatorsRoot: Uint8Array = fromHexString(GENESIS_VALIDATOR_ROOT),
): Uint8Array => {
  const forkVersion = fromHexString(
    lockForkVersion.substring(2, lockForkVersion.length),
  );

  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorsRoot);
  const domain = new Uint8Array(32);
  domain.set(domainType);
  domain.set(forkDataRoot.subarray(0, 28), 4);
  return domain;
};

/**
 * Verify deposit data withdrawal credintials and signature
 * @param {string} forkVersion - fork version in definition file.
 * @param {DistributedValidatorDto} validator - distributed validator.
 * @param {string} withdrawalAddress - withdrawal address in definition file.
 * @returns {boolean} - return if deposit data is valid.
 */
export const verifyDepositData = (
  distributedPublicKey: string,
  depositData: Partial<DepositData>,
  withdrawalAddress: string,
  forkVersion: string,
): { isValidDepositData: boolean; depositDataMsg: Uint8Array } => {
  const depositDomain = computeDomain(
    fromHexString(DOMAIN_DEPOSIT),
    forkVersion,
  );
  const eth1AddressWithdrawalPrefix = '0x01';
  if (
    eth1AddressWithdrawalPrefix +
      '0'.repeat(22) +
      withdrawalAddress.toLowerCase().slice(2) !==
    depositData.withdrawal_credentials
  ) {
    return { isValidDepositData: false, depositDataMsg: new Uint8Array(0) };
  }

  if (distributedPublicKey !== depositData.pubkey) {
    return { isValidDepositData: false, depositDataMsg: new Uint8Array(0) };
  }

  const depositMessageBuffer = computeDepositMsgRoot(depositData);
  const depositDataMessage = signingRoot(depositDomain, depositMessageBuffer);

  return { isValidDepositData: true, depositDataMsg: depositDataMessage };
};

export const verifyBuilderRegistration = (
  validator: DistributedValidator,
  feeRecipientAddress: string,
  forkVersion: string,
): {
  isValidBuilderRegistration: boolean;
  builderRegistrationMsg: Uint8Array;
} => {
  const builderDomain = computeDomain(
    fromHexString(DOMAIN_APPLICATION_BUILDER),
    forkVersion,
  );

  if (
    validator.distributed_public_key !==
    validator.builder_registration?.message.pubkey
  ) {
    return {
      isValidBuilderRegistration: false,
      builderRegistrationMsg: new Uint8Array(0),
    };
  }
  if (
    feeRecipientAddress.toLowerCase() !==
    validator.builder_registration.message.fee_recipient.toLowerCase()
  ) {
    return {
      isValidBuilderRegistration: false,
      builderRegistrationMsg: new Uint8Array(0),
    };
  }

  const builderRegistrationMessageBuffer = computebuilderRegistrationMsgRoot(
    validator.builder_registration.message,
  );

  const builderRegistrationMessage = signingRoot(
    builderDomain,
    builderRegistrationMessageBuffer,
  );

  return {
    isValidBuilderRegistration: true,
    builderRegistrationMsg: builderRegistrationMessage,
  };
};

export const verifyNodeSignatures = (clusterLock: ClusterLock): boolean => {
  const ec = new elliptic.ec('secp256k1');
  const nodeSignatures = clusterLock.node_signatures;

  const lockHashWithout0x = hexWithout0x(clusterLock.lock_hash);
  // node(ENR) signatures
  for (let i = 0; i < (nodeSignatures as string[]).length; i++) {
    const pubkey = ENR.decodeTxt(
      clusterLock.cluster_definition.operators[i].enr as string,
    ).publicKey.toString('hex');

    const ENRsignature = {
      r: (nodeSignatures as string[])[i].slice(2, 66),
      s: (nodeSignatures as string[])[i].slice(66, 130),
    };

    const nodeSignatureVerification = ec
      .keyFromPublic(pubkey, 'hex')
      .verify(lockHashWithout0x, ENRsignature);

    if (!nodeSignatureVerification) {
      return false;
    }
  }

  return true;
};

export const signingRoot = (
  domain: Uint8Array,
  messageBuffer: Buffer,
): Uint8Array => {
  return computeSigningRoot(messageBuffer, domain);
};

const verifyLockData = async (clusterLock: ClusterLock): Promise<boolean> => {
  await init('herumi');

  if (semver.eq(clusterLock.cluster_definition.version, 'v1.6.0')) {
    return verifyDVV1X6(clusterLock);
  }

  if (semver.eq(clusterLock.cluster_definition.version, 'v1.7.0')) {
    return verifyDVV1X7(clusterLock);
  }

  if (semver.eq(clusterLock.cluster_definition.version, 'v1.8.0')) {
    return verifyDVV1X8(clusterLock);
  }
  return false;
};

export const isValidClusterLock = async (
  clusterLock: ClusterLock,
): Promise<boolean> => {
  try {
    const definitionType = definitionFlow(clusterLock.cluster_definition);
    if (definitionType == null) {
      return false;
    }
    const isValidDefinitionData = await verifyDefinitionSignatures(
      clusterLock.cluster_definition,
      definitionType,
    );
    if (!isValidDefinitionData) {
      return false;
    }

    if (
      clusterConfigOrDefinitionHash(clusterLock.cluster_definition, false) !==
      clusterLock.cluster_definition.definition_hash
    ) {
      return false;
    }
    if (clusterLockHash(clusterLock) !== clusterLock.lock_hash) {
      return false;
    }

    const isValidLockData = await verifyLockData(clusterLock);
    if (!isValidLockData) {
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
};
