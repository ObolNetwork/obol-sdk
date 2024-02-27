import * as semver from 'semver'
import {
  init,
  aggregateSignatures,
  verifyMultiple,
  verifyAggregate,
} from '@chainsafe/bls'
import { ENR } from '@chainsafe/discv5'
import { ByteVectorType, ContainerType, fromHexString } from '@chainsafe/ssz'
import {
  type UintNumberByteLen,
  UintNumberType,
} from '@chainsafe/ssz/lib/type/uint.js'
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'
import elliptic from 'elliptic'
import { ethers } from 'ethers'

import {
  type BuilderRegistrationMessage,
  type ClusterDefintion,
  type ClusterLock,
  type DepositData,
  type DistributedValidator,
  FORK_MAPPING,
} from './types.js'
import { clusterConfigOrDefinitionHash, clusterLockHash } from './hash.js'
import {
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_DEPOSIT,
  DefinitionFlow,
  GENESIS_VALIDATOR_ROOT,
  signCreatorConfigHashPayload,
  signEnrPayload,
  signOperatorConfigHashPayload,
} from './constants.js'
import { hexWithout0x } from './utils.js'

const builderRegistrationMessageType = new ContainerType({
  fee_recipient: new ByteVectorType(20),
  gas_limit: new UintNumberType(8 as UintNumberByteLen),
  timestamp: new UintNumberType(8 as UintNumberByteLen),
  pubkey: new ByteVectorType(48),
})

// For domain computation that is used in deposit data and builder registration verification for dv
const forkDataType = new ContainerType({
  currentVersion: new ByteVectorType(4),
  genesisValidatorsRoot: new ByteVectorType(32),
})

const depositMessageType = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8),
})

const signingRootType = new ContainerType({
  objectRoot: new ByteVectorType(32),
  domain: new ByteVectorType(32),
})

const definitionFlow = (
  clusterDefinition: ClusterDefintion,
): DefinitionFlow | null => {
  if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every((operator) => {
      return (
        operator.address &&
        operator.config_signature &&
        operator.enr &&
        operator.enr_signature
      )
    })
  ) {
    return DefinitionFlow.Group
  } else if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every((operator) => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      )
    })
  ) {
    return DefinitionFlow.Solo
  } else if (
    !clusterDefinition.creator.address &&
    !clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every((operator) => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      )
    })
  ) {
    return DefinitionFlow.Charon
  }
  return null
}

// cluster-definition signatures verificatin

const getPOSTConfigHashSigner = (
  signature: string,
  configHash: string,
  chainId: FORK_MAPPING,
): string => {
  try {
    const sig = ethers.Signature.from(signature)
    const data = signCreatorConfigHashPayload(
      { creator_config_hash: configHash },
      chainId,
    )
    const digest = TypedDataUtils.eip712Hash(data, SignTypedDataVersion.V4)

    return ethers.recoverAddress(digest, sig).toLowerCase()
  } catch (err) {
    throw err
  }
}

const getPUTConfigHashSigner = (
  signature: string,
  configHash: string,
  chainId: number,
): string => {
  try {
    const sig = ethers.Signature.from(signature)
    const data = signOperatorConfigHashPayload(
      { operator_config_hash: configHash },
      chainId,
    )
    const digest = TypedDataUtils.eip712Hash(data, SignTypedDataVersion.V4)

    return ethers.recoverAddress(digest, sig).toLowerCase()
  } catch (err) {
    throw err
  }
}

const getEnrSigner = (
  signature: string,
  payload: string,
  chainId: number,
): string => {
  try {
    const sig = ethers.Signature.from(signature)

    const data = signEnrPayload({ enr: payload }, chainId)
    const digest = TypedDataUtils.eip712Hash(data, SignTypedDataVersion.V4)

    return ethers.recoverAddress(digest, sig).toLowerCase()
  } catch (err) {
    throw err
  }
}

const verifyDefinitionSignatures = (
  clusterDefinition: ClusterDefintion,
  definitionType: DefinitionFlow,
): boolean => {
  if (definitionType === 'Charon-Command') {
    return true
  } else {
    const configSigner = getPOSTConfigHashSigner(
      clusterDefinition.creator.config_signature as string,
      clusterDefinition.config_hash,
      FORK_MAPPING[clusterDefinition.fork_version as keyof typeof FORK_MAPPING],
    )

    if (configSigner !== clusterDefinition.creator.address.toLowerCase()) {
      return false
    }
    if (definitionType === 'LP-Solo') {
      return true
    }
    return clusterDefinition.operators.every((operator) => {
      const configSigner = getPUTConfigHashSigner(
        operator.config_signature as string,
        clusterDefinition.config_hash,
        FORK_MAPPING[
          clusterDefinition.fork_version as keyof typeof FORK_MAPPING
        ],
      )

      const enrSigner = getEnrSigner(
        operator.enr_signature as string,
        operator.enr as string,
        FORK_MAPPING[
          clusterDefinition.fork_version as keyof typeof FORK_MAPPING
        ],
      )

      if (
        configSigner !== operator.address.toLowerCase() ||
        enrSigner !== operator.address.toLowerCase()
      ) {
        return false
      }
      return true
    })
  }
}

// cluster-lock data verification
const computeSigningRoot = (
  sszObjectRoot: Uint8Array,
  domain: Uint8Array,
): Uint8Array => {
  const val1 = signingRootType.defaultValue()
  val1.objectRoot = sszObjectRoot
  val1.domain = domain
  return Buffer.from(signingRootType.hashTreeRoot(val1).buffer)
}

const computeDepositMsgRoot = (msg: Partial<DepositData>): Buffer => {
  const depositMsgVal = depositMessageType.defaultValue()

  depositMsgVal.pubkey = fromHexString(msg.pubkey as string)
  depositMsgVal.withdrawal_credentials = fromHexString(
    msg.withdrawal_credentials as string,
  )
  depositMsgVal.amount = parseInt(msg.amount as string)
  return Buffer.from(depositMessageType.hashTreeRoot(depositMsgVal).buffer)
}

const computeForkDataRoot = (
  currentVersion: Uint8Array,
  genesisValidatorsRoot: Uint8Array,
): Uint8Array => {
  const forkDataVal = forkDataType.defaultValue()
  forkDataVal.currentVersion = currentVersion
  forkDataVal.genesisValidatorsRoot = genesisValidatorsRoot
  return Buffer.from(forkDataType.hashTreeRoot(forkDataVal).buffer)
}

const computebuilderRegistrationMsgRoot = (
  msg: BuilderRegistrationMessage,
): Buffer => {
  const builderRegistrationMsgVal =
    builderRegistrationMessageType.defaultValue()

  builderRegistrationMsgVal.fee_recipient = fromHexString(msg.fee_recipient)
  builderRegistrationMsgVal.gas_limit = msg.gas_limit
  builderRegistrationMsgVal.timestamp = msg.timestamp
  builderRegistrationMsgVal.pubkey = fromHexString(msg.pubkey)
  return Buffer.from(
    builderRegistrationMessageType.hashTreeRoot(builderRegistrationMsgVal)
      .buffer,
  )
}

// DV data verification
const computeDomain = (
  domainType: Uint8Array,
  lockForkVersion: string,
  genesisValidatorsRoot: Uint8Array = fromHexString(GENESIS_VALIDATOR_ROOT),
): Uint8Array => {
  const forkVersion = fromHexString(
    lockForkVersion.substring(2, lockForkVersion.length),
  )

  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorsRoot)
  const domain = new Uint8Array(32)
  domain.set(domainType)
  domain.set(forkDataRoot.subarray(0, 28), 4)
  return domain
}

const verifyDepositData = (
  validator: DistributedValidator,
  withdrawalAddress: string,
): boolean => {
  const eth1AddressWithdrawalPrefix = '0x01'
  if (
    eth1AddressWithdrawalPrefix +
      '0'.repeat(22) +
      withdrawalAddress.toLowerCase().slice(2) !==
    validator.deposit_data.withdrawal_credentials
  ) {
    return false
  }

  if (validator.distributed_public_key !== validator.deposit_data.pubkey) {
    return false
  }

  return true
}

const verifyBuilderRegistration = (
  validator: DistributedValidator,
  feeRecipientAddress: string,
): boolean => {
  if (
    validator.distributed_public_key !==
    validator.builder_registration.message.pubkey
  ) {
    return false
  }
  if (
    feeRecipientAddress.toLowerCase() !==
    validator.builder_registration.message.fee_recipient.toLowerCase()
  ) {
    return false
  }

  return true
}

export const signingRoot = (
  domain: Uint8Array,
  messageBuffer: Buffer,
): Uint8Array => {
  return computeSigningRoot(messageBuffer, domain)
}

const verifyLockData = async (clusterLock: ClusterLock): Promise<boolean> => {
  const ec = new elliptic.ec('secp256k1')
  const validators = clusterLock.distributed_validators
  const nodeSignatures = clusterLock.node_signatures
  const depositDomain = computeDomain(
    fromHexString(DOMAIN_DEPOSIT),
    clusterLock.cluster_definition.fork_version,
  )
  const builderDomain = computeDomain(
    fromHexString(DOMAIN_APPLICATION_BUILDER),
    clusterLock.cluster_definition.fork_version,
  )

  const pubShares = []
  const pubKeys = []
  const builderRegistrationAndDepositDataMessages = []
  const blsSignatures = []

  await init('herumi')

  for (let i = 0; i < validators.length; i++) {
    const validator = validators[i]
    const validatorPublicShares = validator.public_shares

    for (const element of validatorPublicShares) {
      pubShares.push(fromHexString(element))
    }

    // Deposit data signature
    if (semver.gte(clusterLock.cluster_definition.version, 'v1.6.0')) {
      if (
        !verifyDepositData(
          validator,
          clusterLock.cluster_definition.validators[i].withdrawal_address,
        )
      ) {
        return false
      }

      const depositMessageBuffer = computeDepositMsgRoot(validator.deposit_data)
      const depositDataMessage = signingRoot(
        depositDomain,
        depositMessageBuffer,
      )

      pubKeys.push(fromHexString(validator.distributed_public_key))
      builderRegistrationAndDepositDataMessages.push(depositDataMessage)
      blsSignatures.push(fromHexString(validator.deposit_data.signature as string))
    }

    // Builder registration signature
    if (semver.gte(clusterLock.cluster_definition.version, 'v1.7.0')) {
      if (
        !verifyBuilderRegistration(
          validator,
          clusterLock.cluster_definition.validators[i].fee_recipient_address,
        )
      ) {
        return false
      }

      const builderRegistrationMessageBuffer =
        computebuilderRegistrationMsgRoot(
          validator.builder_registration.message,
        )

      const builderRegistrationMessage = signingRoot(
        builderDomain,
        builderRegistrationMessageBuffer,
      )

      pubKeys.push(fromHexString(validator.distributed_public_key))
      builderRegistrationAndDepositDataMessages.push(builderRegistrationMessage)
      blsSignatures.push(
        fromHexString(validator.builder_registration.signature),
      )
    }
  }

  if (
    blsSignatures.length > 0 &&
    pubKeys.length > 0 &&
    builderRegistrationAndDepositDataMessages.length > 0
  ) {
    // verify all deposit data and builder registration bls signatures
    const aggregateBLSSignature = aggregateSignatures(blsSignatures)

    if (
      !verifyMultiple(
        pubKeys,
        builderRegistrationAndDepositDataMessages,
        aggregateBLSSignature,
      )
    ) {
      return false
    }
  }

  if (semver.gte(clusterLock.cluster_definition.version, 'v1.7.0')) {
    const lockHashWithout0x = hexWithout0x(clusterLock.lock_hash)
    // node(ENR) signatures
    for (let i = 0; i < nodeSignatures.length; i++) {
      const pubkey = ENR.decodeTxt(
        clusterLock.cluster_definition.operators[i].enr as string,
      ).publicKey.toString('hex')

      const ENRsignature = {
        r: nodeSignatures[i].slice(2, 66),
        s: nodeSignatures[i].slice(66, 130),
      }

      const nodeSignatureVerification = ec
        .keyFromPublic(pubkey, 'hex')
        .verify(lockHashWithout0x, ENRsignature)

      if (!nodeSignatureVerification) {
        return false
      }
    }
  }

  // signature aggregate
  if (
    !verifyAggregate(
      pubShares,
      fromHexString(clusterLock.lock_hash),
      fromHexString(clusterLock.signature_aggregate),
    )
  ) {
    return false
  }

  return true
}

export const isValidClusterLock = async (
  clusterLock: ClusterLock,
): Promise<boolean> => {
  try {
    const definitionType = definitionFlow(clusterLock.cluster_definition)
    if (definitionType == null) {
      return false
    }
    const isValidDefinitionData = verifyDefinitionSignatures(
      clusterLock.cluster_definition,
      definitionType,
    )
    if (!isValidDefinitionData) {
      return false
    }

    if (
      clusterConfigOrDefinitionHash(clusterLock.cluster_definition, false) !==
      clusterLock.cluster_definition.definition_hash
    ) {
      return false
    }
    if (clusterLockHash(clusterLock) !== clusterLock.lock_hash) {
      return false
    }

    const isValidLockData = await verifyLockData(clusterLock)
    if (!isValidLockData) {
      return false
    }
    return true
  } catch (err) {
    return false
  }
}
