import {
  ByteListType,
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  UintNumberType,
} from '@chainsafe/ssz';
import { type UintNumberByteLen } from '@chainsafe/ssz/lib/type/uint.js';

export const operatorAddressWrapperType = new ContainerType({
  address: new ByteVectorType(20),
});

export const creatorAddressWrapperType = new ContainerType({
  address: new ByteVectorType(20),
});

export const operatorContainerType = new ContainerType({
  address: new ByteVectorType(20),
  enr: new ByteListType(1024), // This needs to be dynamic, since ENRs do not have a fixed length.
  config_signature: new ByteVectorType(65),
  enr_signature: new ByteVectorType(65),
});

export const k1SignatureListType = new ListCompositeType(
  new ByteVectorType(65),
  32,
);

export const operatorContainerTypeV1X11 = new ContainerType({
  address: new ByteVectorType(20),
  enr: new ByteListType(1024), // This needs to be dynamic, since ENRs do not have a fixed length.
  config_signature: k1SignatureListType,
  enr_signature: k1SignatureListType,
});

export const creatorContainerType = new ContainerType({
  address: new ByteVectorType(20),
  config_signature: new ByteVectorType(65),
});

export const creatorContainerTypeV1X11 = new ContainerType({
  address: new ByteVectorType(20),
  config_signature: k1SignatureListType,
});

export const validatorsContainerType = new ContainerType({
  fee_recipient_address: new ByteVectorType(20),
  withdrawal_address: new ByteVectorType(20),
});

export const newCreatorContainerType = (
  configOnly: boolean,
): ContainerType<any> => {
  return configOnly ? creatorAddressWrapperType : creatorContainerType;
};

export const newCreatorContainerTypeV1X11 = (
  configOnly: boolean,
): ContainerType<any> => {
  return configOnly ? creatorAddressWrapperType : creatorContainerTypeV1X11;
};

export const newOperatorContainerType = (
  configOnly: boolean,
): ContainerType<any> => {
  return configOnly ? operatorAddressWrapperType : operatorContainerType;
};

export const newOperatorContainerTypeV1X11 = (
  configOnly: boolean,
): ContainerType<any> => {
  return configOnly ? operatorAddressWrapperType : operatorContainerTypeV1X11;
};

// Lock
export const depositDataContainer = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8 as UintNumberByteLen),
  signature: new ByteVectorType(96),
});

export const builderRegistrationMessageContainer = new ContainerType({
  fee_recipient: new ByteVectorType(20),
  gas_limit: new UintNumberType(8 as UintNumberByteLen),
  timestamp: new UintNumberType(8 as UintNumberByteLen),
  pubkey: new ByteVectorType(48),
});

export const builderRegistrationContainer = new ContainerType({
  message: builderRegistrationMessageContainer,
  signature: new ByteVectorType(96),
});

export const builderRegistrationMessageType = new ContainerType({
  fee_recipient: new ByteVectorType(20),
  gas_limit: new UintNumberType(8 as UintNumberByteLen),
  timestamp: new UintNumberType(8 as UintNumberByteLen),
  pubkey: new ByteVectorType(48),
});

// For domain computation that is used in deposit data and builder registration verification for dv
export const forkDataType = new ContainerType({
  currentVersion: new ByteVectorType(4),
  genesisValidatorsRoot: new ByteVectorType(32),
});

export const depositMessageType = new ContainerType({
  pubkey: new ByteVectorType(48),
  withdrawal_credentials: new ByteVectorType(32),
  amount: new UintNumberType(8),
});

export const signingRootType = new ContainerType({
  objectRoot: new ByteVectorType(32),
  domain: new ByteVectorType(32),
});
