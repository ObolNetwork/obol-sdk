/**
 * Cluster file hashing and the structural parts of the deposit, builder
 * registration and node signature checks (carried over from SDK 2.x). The
 * lock verification steps themselves live in `cluster/verifyLock.ts`.
 */
import {
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  fromHexString,
} from '@chainsafe/ssz';
import { ENR } from '@chainsafe/enr';
import {
  type BuilderRegistrationMessage,
  type ClusterDefinition,
  type ClusterLock,
  type DepositData,
  type DistributedValidator,
} from '../types.js';
import { secp256k1VerifyRecovered } from '../secp256k1.js';
import {
  builderRegistrationMessageType,
  depositMessageType,
  forkDataType,
  listOrEmpty,
  signingRootType,
  toUint64,
} from './sszTypes.js';
import {
  clusterDefinitionContainerTypeV1X6,
  dvContainerTypeV1X6,
  dvValueV1X6,
  hashClusterDefinitionV1X6,
  hashClusterLockV1X6,
} from './v1.6.0.js';
import {
  clusterDefinitionContainerTypeV1X7,
  dvContainerTypeV1X7,
  dvValueV1X7,
  hashClusterDefinitionV1X7,
  hashClusterLockV1X7,
} from './v1.7.0.js';
import {
  clusterDefinitionContainerTypeV1X8,
  dvContainerTypeV1X8,
  dvValueV1X8,
  hashClusterDefinitionV1X8,
  hashClusterLockV1X8,
} from './v1.8.0.js';
import {
  clusterDefinitionContainerTypeV1X10,
  dvContainerTypeV1X10,
  dvValueV1X10,
  hashClusterDefinitionV1X10,
  hashClusterLockV1X10,
} from './v1.10.0.js';
import {
  clusterDefinitionContainerTypeV1X11,
  dvContainerTypeV1X11,
  dvValueV1X11,
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

/** v1.8.0 reads a null `deposit_amounts` as one 32 ETH partial deposit. */
const checkV1X8DepositAmounts = (clusterLock: ClusterLock): void => {
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
};

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
    checkV1X8DepositAmounts(clusterLock);
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

interface DefinitionHashing {
  type: (configOnly: boolean) => ContainerType<any>;
  value: (cluster: ClusterDefinition, configOnly: boolean) => unknown;
}

const DEFINITION_HASHING: Record<string, DefinitionHashing> = {
  'v1.6.0': {
    type: clusterDefinitionContainerTypeV1X6,
    value: hashClusterDefinitionV1X6,
  },
  'v1.7.0': {
    type: clusterDefinitionContainerTypeV1X7,
    value: hashClusterDefinitionV1X7,
  },
  'v1.8.0': {
    type: clusterDefinitionContainerTypeV1X8,
    value: hashClusterDefinitionV1X8,
  },
  'v1.10.0': {
    type: clusterDefinitionContainerTypeV1X10,
    value: hashClusterDefinitionV1X10,
  },
  'v1.11.0': {
    type: clusterDefinitionContainerTypeV1X11,
    value: hashClusterDefinitionV1X11,
  },
};

const bytes32 = new ByteVectorType(32);
/** Element roots between ticks while hashing a long list. */
const ROOTS_PER_TICK = 256;

/**
 * hash_tree_root of a container value, with the elements of its list field
 * `listField` hashed a slice at a time (awaiting `tick` between slices). A
 * list of composite elements merkleizes their roots and a container its
 * field roots, so 32-byte stand-ins for both give the same root.
 */
const containerRootSliced = async (
  type: ContainerType<any>,
  value: Record<string, unknown>,
  listField: string,
  tick: () => Promise<void>,
): Promise<Uint8Array> => {
  const roots: Record<string, Uint8Array> = {};
  const standIns: Record<string, ByteVectorType> = {};
  for (const entry of type.fieldsEntries) {
    const fieldName = String(entry.fieldName);
    const fieldType = entry.fieldType;
    standIns[fieldName] = bytes32;
    if (fieldName !== listField) {
      roots[fieldName] = fieldType.hashTreeRoot(value[fieldName]);
      continue;
    }
    const list = fieldType as ListCompositeType<any>;
    const items = value[fieldName] as unknown[];
    const elementRoots: Uint8Array[] = [];
    for (let i = 0; i < items.length; i++) {
      elementRoots.push(list.elementType.hashTreeRoot(items[i]) as Uint8Array);
      if (i % ROOTS_PER_TICK === ROOTS_PER_TICK - 1) await tick();
    }
    roots[fieldName] = new ListCompositeType(bytes32, list.limit).hashTreeRoot(
      elementRoots,
    );
  }
  return new ContainerType(standIns).hashTreeRoot(roots);
};

/**
 * {@link clusterConfigOrDefinitionHash}, hashing the validators list a slice
 * at a time (awaiting `tick` between slices).
 */
export const clusterConfigOrDefinitionHashSliced = async (
  cluster: ClusterDefinition,
  configOnly: boolean,
  tick: () => Promise<void>,
): Promise<string> => {
  const hashing = DEFINITION_HASHING[cluster.version];
  if (hashing === undefined) throw new Error('unsupported version');
  const root = await containerRootSliced(
    hashing.type(configOnly),
    hashing.value(cluster, configOnly) as Record<string, unknown>,
    'validators',
    tick,
  );
  return '0x' + Buffer.from(root).toString('hex');
};

interface DvHashing {
  type: { hashTreeRoot: (value: never) => Uint8Array };
  value: (dv: ClusterLock['distributed_validators'][number]) => unknown;
}

const DV_HASHING: Record<string, DvHashing> = {
  'v1.6.0': { type: dvContainerTypeV1X6, value: dvValueV1X6 },
  'v1.7.0': { type: dvContainerTypeV1X7, value: dvValueV1X7 },
  'v1.8.0': { type: dvContainerTypeV1X8, value: dvValueV1X8 },
  'v1.10.0': { type: dvContainerTypeV1X10, value: dvValueV1X10 },
  'v1.11.0': { type: dvContainerTypeV1X11, value: dvValueV1X11 },
};

// A list of composite elements merkleizes their roots, and a container its
// field roots, so these 32-byte stand-ins give the same roots.
const dvRootsType = new ListCompositeType(new ByteVectorType(32), 65536);
const lockRootsType = new ContainerType({
  cluster_definition: new ByteVectorType(32),
  distributed_validators: new ByteVectorType(32),
});

/**
 * {@link clusterLockHash} computed one distributed validator at a time,
 * awaiting `tick` between them, from the already checked definition hash.
 */
export const clusterLockHashSliced = async (
  clusterLock: ClusterLock,
  definitionRoot: Uint8Array,
  tick: () => Promise<void>,
): Promise<string> => {
  const version = clusterLock.cluster_definition.version;
  const hashing = DV_HASHING[version];
  if (hashing === undefined) throw new Error('unsupported version');
  if (version === 'v1.8.0') checkV1X8DepositAmounts(clusterLock);
  const roots: Uint8Array[] = [];
  for (const dv of listOrEmpty(clusterLock.distributed_validators)) {
    roots.push(hashing.type.hashTreeRoot(hashing.value(dv) as never));
    await tick();
  }
  const root = lockRootsType.hashTreeRoot({
    cluster_definition: definitionRoot,
    distributed_validators: dvRootsType.hashTreeRoot(roots),
  });
  return '0x' + Buffer.from(root).toString('hex');
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
 * The deposit's pubkey is the group key, its credentials are `0x01` (`0x02`
 * with `compounding`) + 11 zero bytes + the withdrawal address, and it has a
 * signature.
 */
export const depositFieldsMatch = (
  distributedPublicKey: string,
  depositData: Partial<DepositData>,
  withdrawalAddress: string,
  compounding?: boolean,
): boolean => {
  const withdrawalPrefix = compounding ? '0x02' : '0x01';
  const expectedWithdrawalCredentials =
    withdrawalPrefix +
    '0'.repeat(22) +
    withdrawalAddress.toLowerCase().slice(2);
  return (
    expectedWithdrawalCredentials === depositData.withdrawal_credentials &&
    distributedPublicKey === depositData.pubkey &&
    typeof depositData.signature === 'string' &&
    depositData.signature.length > 0
  );
};

/** Signing root of a deposit message in `domain`. */
export const depositSigningRoot = (
  depositData: Partial<DepositData>,
  domain: Uint8Array,
): Uint8Array => signingRoot(domain, computeDepositMsgRoot(depositData));

/**
 * The builder registration is for the group key and the fee recipient, and
 * has a signature.
 */
export const builderFieldsMatch = (
  validator: DistributedValidator,
  feeRecipientAddress: string,
): boolean => {
  const registration = validator.builder_registration;
  return (
    registration !== undefined &&
    registration !== null &&
    validator.distributed_public_key === registration.message.pubkey &&
    feeRecipientAddress.toLowerCase() ===
      registration.message.fee_recipient.toLowerCase() &&
    typeof registration.signature === 'string' &&
    registration.signature.length > 0
  );
};

/** Signing root of a builder registration message in `domain`. */
export const builderSigningRoot = (
  message: BuilderRegistrationMessage,
  domain: Uint8Array,
): Uint8Array =>
  signingRoot(domain, computebuilderRegistrationMsgRoot(message));

export const verifyNodeSignatures = async (
  clusterLock: ClusterLock,
  tick: () => Promise<void> = async () => {},
): Promise<boolean> => {
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
    await tick();

    if (!secp256k1VerifyRecovered(publicKey, lockHash, nodeSignatures[i])) {
      return false;
    }
    await tick();
  }

  return true;
};

export const signingRoot = (
  domain: Uint8Array,
  messageBuffer: Buffer,
): Uint8Array => {
  return computeSigningRoot(messageBuffer, domain);
};
