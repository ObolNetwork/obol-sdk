/** SSZ roots and signing domains of exit messages. */
import {
  ByteVectorType,
  ContainerType,
  ListCompositeType,
  UintBigintType,
  fromHexString,
} from '@chainsafe/ssz';
import { computeDomain, signingRoot } from '../internal/exitDomain.js';
import type { PartialExitBlob } from './types.js';

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
  message: { epoch: string; validator_index: string },
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
    validator_index: BigInt(message.validator_index),
  });
  return signingRoot(domain, Buffer.from(root));
};

/**
 * Partial exits in the order they are signed: by validator index, ascending
 * (as the Obol API and Charon sort them). Stable for equal indexes.
 */
export const sortedPartialExits = (
  partialExits: readonly PartialExitBlob[],
): PartialExitBlob[] =>
  [...partialExits].sort((a, b) => {
    const x = BigInt(a.signed_exit_message.message.validator_index);
    const y = BigInt(b.signed_exit_message.message.validator_index);
    return x < y ? -1 : x > y ? 1 : 0;
  });

/**
 * SSZ root of a partial exits payload: what the operator's ENR key signs.
 * The partial exits are sorted by validator index first.
 */
export const partialExitsPayloadRoot = (
  partialExits: readonly PartialExitBlob[],
  shareIdx: number,
): Uint8Array =>
  PartialExitsPayloadType.hashTreeRoot({
    partial_exits: sortedPartialExits(partialExits).map(blob => ({
      public_key: fromHexString(blob.public_key),
      signed_exit_message: {
        message: {
          epoch: BigInt(blob.signed_exit_message.message.epoch),
          validator_index: BigInt(
            blob.signed_exit_message.message.validator_index,
          ),
        },
        signature: fromHexString(blob.signed_exit_message.signature),
      },
    })),
    share_idx: BigInt(shareIdx),
  });
