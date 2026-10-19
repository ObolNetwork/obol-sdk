/**
 * Cluster file hashing and the structural parts of the deposit, builder
 * registration and node signature checks (carried over from SDK 2.x). The
 * lock verification steps themselves live in `cluster/verifyLock.ts`.
 */
import { fromHexString } from '@chainsafe/ssz';
import { ENR } from '@chainsafe/enr';
import {
  type BlsSignatureCheck,
  type BuilderRegistrationMessage,
  type ClusterDefinition,
  type ClusterLock,
  type DepositData,
  type DistributedValidator,
} from '../types.js';
import { secp256k1VerifyDigest } from '../secp256k1.js';
import {
  builderRegistrationMessageType,
  depositMessageType,
  forkDataType,
  signingRootType,
  toUint64,
} from './sszTypes.js';
import {
  clusterDefinitionContainerTypeV1X6,
  hashClusterDefinitionV1X6,
  hashClusterLockV1X6,
} from './v1.6.0.js';
import {
  clusterDefinitionContainerTypeV1X7,
  hashClusterDefinitionV1X7,
  hashClusterLockV1X7,
} from './v1.7.0.js';
import {
  clusterDefinitionContainerTypeV1X8,
  hashClusterDefinitionV1X8,
  hashClusterLockV1X8,
} from './v1.8.0.js';
import {
  clusterDefinitionContainerTypeV1X10,
  hashClusterDefinitionV1X10,
  hashClusterLockV1X10,
} from './v1.10.0.js';
import {
  clusterDefinitionContainerTypeV1X11,
  hashClusterDefinitionV1X11,
  hashClusterLockV1X11,
} from './v1.11.0.js';

const DOMAIN_APPLICATION_BUILDER = '00000001';
const DOMAIN_DEPOSIT = '03000000';
/** Deposits and builder registrations are signed with a zero genesis validators root. */
const GENESIS_VALIDATOR_ROOT =
  '0000000000000000000000000000000000000000000000000000000000000000';

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

  if (cluster.version === 'v1.6.0') {
    definitionType = clusterDefinitionContainerTypeV1X6(configOnly);
    val = hashClusterDefinitionV1X6(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  if (cluster.version === 'v1.7.0') {
    definitionType = clusterDefinitionContainerTypeV1X7(configOnly);
    val = hashClusterDefinitionV1X7(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  if (cluster.version === 'v1.8.0') {
    definitionType = clusterDefinitionContainerTypeV1X8(configOnly);
    val = hashClusterDefinitionV1X8(cluster, configOnly);
    return (
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex')
    );
  }

  if (cluster.version === 'v1.10.0') {
    definitionType = clusterDefinitionContainerTypeV1X10(configOnly);
    val = hashClusterDefinitionV1X10(cluster, configOnly);
    const x =
      '0x' +
      Buffer.from(definitionType.hashTreeRoot(val).buffer).toString('hex');
    return x;
  }

  if (cluster.version === 'v1.11.0') {
    definitionType = clusterDefinitionContainerTypeV1X11(configOnly);
    val = hashClusterDefinitionV1X11(cluster, configOnly);
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
  if (clusterLock.cluster_definition.version === 'v1.6.0') {
    return hashClusterLockV1X6(clusterLock);
  }

  if (clusterLock.cluster_definition.version === 'v1.7.0') {
    return hashClusterLockV1X7(clusterLock);
  }

  if (clusterLock.cluster_definition.version === 'v1.8.0') {
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

  if (clusterLock.cluster_definition.version === 'v1.10.0') {
    // Charon uses the same SSZ DV hashing for v1.8–v1.10 (`hashValidatorV1x8OrLater` in
    // cluster/ssz.go): a list of partial deposits, not the v1.8-only JSON convention
    // where null `deposit_amounts` implies a single 32 ETH partial. The v1.10 fixture
    // `cluster/testdata/cluster_lock_v1_10_0.json` uses explicit partial amounts (e.g.
    // 16+16 ETH) and multiple `partial_deposit_data` entries per validator; do not
    // apply the v1.8.0 guard here.
    return hashClusterLockV1X10(clusterLock);
  }

  if (clusterLock.cluster_definition.version === 'v1.11.0') {
    return hashClusterLockV1X11(clusterLock);
  }

  // other versions
  throw new Error('unsupported version');
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

export const computeDepositMsgRoot = (msg: Partial<DepositData>): Buffer => {
  const depositMsgVal = depositMessageType.defaultValue();

  depositMsgVal.pubkey = fromHexString(msg.pubkey as string);
  depositMsgVal.withdrawal_credentials = fromHexString(
    msg.withdrawal_credentials as string,
  );
  depositMsgVal.amount = toUint64(msg.amount as string);
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

export const depositDomainForFork = (forkVersion: string): Uint8Array =>
  computeDomain(fromHexString(DOMAIN_DEPOSIT), forkVersion);

export const builderDomainForFork = (forkVersion: string): Uint8Array =>
  computeDomain(fromHexString(DOMAIN_APPLICATION_BUILDER), forkVersion);

/**
 * Structural deposit checks + signing root (no BLS). Used before batch BLS verify.
 */
export const validateDepositDataStructure = (
  distributedPublicKey: string,
  depositData: Partial<DepositData>,
  withdrawalAddress: string,
  forkVersion: string,
  compounding?: boolean,
  precomputedDepositDomain?: Uint8Array,
): { valid: boolean; message: Uint8Array } => {
  const depositDomain =
    precomputedDepositDomain ??
    computeDomain(fromHexString(DOMAIN_DEPOSIT), forkVersion);
  const withdrawalPrefix = compounding ? '0x02' : '0x01';
  const expectedWithdrawalCredentials =
    withdrawalPrefix +
    '0'.repeat(22) +
    withdrawalAddress.toLowerCase().slice(2);

  if (expectedWithdrawalCredentials !== depositData.withdrawal_credentials) {
    return { valid: false, message: new Uint8Array(0) };
  }

  if (distributedPublicKey !== depositData.pubkey) {
    return { valid: false, message: new Uint8Array(0) };
  }

  const depositMessageBuffer = computeDepositMsgRoot(depositData);
  const message = signingRoot(depositDomain, depositMessageBuffer);
  if (!depositData.signature) {
    return { valid: false, message };
  }

  return { valid: true, message };
};

/** Deposit fields + BLS triple for batch verification. Returns null if structure is invalid. */
export const depositBlsCheck = (
  distributedPublicKey: string,
  depositData: Partial<DepositData>,
  withdrawalAddress: string,
  forkVersion: string,
  compounding?: boolean,
  precomputedDepositDomain?: Uint8Array,
): BlsSignatureCheck | null => {
  const { valid, message } = validateDepositDataStructure(
    distributedPublicKey,
    depositData,
    withdrawalAddress,
    forkVersion,
    compounding,
    precomputedDepositDomain,
  );
  if (!valid || !depositData.signature || !depositData.pubkey) return null;
  return {
    pubkey: fromHexString(depositData.pubkey),
    message,
    signature: fromHexString(depositData.signature),
  };
};

export const verifyBuilderRegistration = (
  validator: DistributedValidator,
  feeRecipientAddress: string,
  forkVersion: string,
  precomputedBuilderDomain?: Uint8Array,
): {
  isValidBuilderRegistration: boolean;
  builderRegistrationMsg: Uint8Array;
} => {
  const builderDomain =
    precomputedBuilderDomain ??
    computeDomain(fromHexString(DOMAIN_APPLICATION_BUILDER), forkVersion);

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

/** Builder registration BLS triple for batch verification. Returns null if structure is invalid. */
export const builderBlsCheck = (
  validator: DistributedValidator,
  feeRecipientAddress: string,
  forkVersion: string,
  precomputedBuilderDomain?: Uint8Array,
): BlsSignatureCheck | null => {
  const { isValidBuilderRegistration, builderRegistrationMsg } =
    verifyBuilderRegistration(
      validator,
      feeRecipientAddress,
      forkVersion,
      precomputedBuilderDomain,
    );
  const sig = validator.builder_registration?.signature;
  if (!isValidBuilderRegistration || !sig) return null;
  return {
    pubkey: fromHexString(validator.distributed_public_key),
    message: builderRegistrationMsg,
    signature: fromHexString(sig),
  };
};

export const verifyNodeSignatures = (clusterLock: ClusterLock): boolean => {
  const nodeSignatures = clusterLock.node_signatures;

  if (
    !nodeSignatures ||
    nodeSignatures.length !== clusterLock.cluster_definition.operators.length
  ) {
    return false;
  }

  const lockHash = fromHexString(clusterLock.lock_hash);
  // node(ENR) signatures
  for (let i = 0; i < nodeSignatures.length; i++) {
    const publicKey = ENR.decodeTxt(
      clusterLock.cluster_definition.operators[i].enr as string,
    ).publicKey;

    if (!secp256k1VerifyDigest(publicKey, lockHash, nodeSignatures[i])) {
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
