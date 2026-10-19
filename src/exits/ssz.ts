/** SSZ roots and signing domains of exit messages. */
import {
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  UintBigintType,
  fromHexString,
} from '@chainsafe/ssz';
import { computeDomain, signingRoot } from '../internal/exitDomain.js';
import type { ExitBlob } from './types.js';

export const DOMAIN_VOLUNTARY_EXIT = '0x04000000';

const uint64 = new UintBigintType(8);

const VoluntaryExitType = new ContainerType({
  epoch: uint64,
  validator_index: uint64,
});

const PartialExitsPayloadType = new ContainerType({
  partial_exits: new ListCompositeType(
    new ContainerType({
      public_key: new ByteVectorType(48),
      signed_exit_message: new ContainerType({
        message: VoluntaryExitType,
        signature: new ByteVectorType(96),
      }),
    }),
    65536,
  ),
  share_idx: uint64,
});

/** Signing root of `VoluntaryExit{epoch, validator_index}` in the EIP-7044 exit domain. */
export const exitSigningRoot = (
  message: { epoch: string; validatorIndex: string },
  capellaForkVersion: string,
  genesisValidatorsRoot: string,
): Uint8Array => {
  const domain = computeDomain(
    fromHexString(DOMAIN_VOLUNTARY_EXIT),
    capellaForkVersion,
    fromHexString(genesisValidatorsRoot),
  );
  const root = VoluntaryExitType.hashTreeRoot({
    epoch: BigInt(message.epoch),
    validator_index: BigInt(message.validatorIndex),
  });
  return signingRoot(domain, Buffer.from(root));
};

/** SSZ root of a partial exits payload: what the operator's ENR key signs. */
export const partialExitsPayloadRoot = (
  partialExits: ExitBlob[],
  shareIdx: number,
): Uint8Array =>
  PartialExitsPayloadType.hashTreeRoot({
    partial_exits: partialExits.map(blob => ({
      public_key: fromHexString(blob.publicKey),
      signed_exit_message: {
        message: {
          epoch: BigInt(blob.signedExitMessage.message.epoch),
          validator_index: BigInt(
            blob.signedExitMessage.message.validatorIndex,
          ),
        },
        signature: fromHexString(blob.signedExitMessage.signature),
      },
    })),
    share_idx: BigInt(shareIdx),
  });
