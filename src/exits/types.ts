/**
 * Exit shapes. These are the Obol API's wire and storage formats, kept as
 * they are (spec/README.md "Wire formats owned by others"), so the API can
 * pass what it receives and stores straight to `verifyPartialExit` and
 * `aggregate`.
 */
import { Type, type Static } from '@sinclair/typebox';
import type { Hex } from 'viem';
import { T } from '../schema.js';

/**
 * uint64 as a decimal string. Leading zeros are accepted (the API accepts
 * them) and normalised away in outputs; the value must fit in uint64.
 */
export const Uint64String = Type.String({
  pattern: '^[0-9]{1,20}$',
  description: 'uint64 as a decimal string',
});

export const ExitMessageSchema = Type.Object({
  epoch: Uint64String,
  validator_index: Uint64String,
});

/** One validator's partial exit, signed by one operator's key share. */
export const PartialExitBlobSchema = Type.Object({
  public_key: T.Pubkey,
  signed_exit_message: Type.Object({
    message: ExitMessageSchema,
    signature: T.BlsSignature,
  }),
});

/**
 * What an operator (Charon) submits: its partial exits, its 1-based share
 * index, and a 65-byte secp256k1 signature (`r ‖ s ‖ v`) by its ENR key over
 * the payload's SSZ root, with `partial_exits` sorted by validator index.
 */
export const PartialExitsPayloadSchema = Type.Object({
  partial_exits: Type.Array(PartialExitBlobSchema),
  share_idx: Type.Integer({ minimum: 0 }),
  signature: T.Hex,
});

/** One operator's stored partial exit for a validator. */
export const ShareExitDataSchema = Type.Object({
  public_share: Type.String(),
  partial_exit_signature: Type.String(),
});

const SharesByIndex = Type.Record(
  Type.String({ pattern: '^[0-9]+$' }),
  ShareExitDataSchema,
);

/**
 * The exit the Obol API stores for one validator: its message and the
 * partial exits received so far, keyed by 0-based operator position
 * (share index − 1). A missing share is an absent key. `shares_exit_data`
 * may come wrapped in a one-element array (as Mongoose exposes it).
 */
export const StoredExitBlobSchema = Type.Object({
  lock_hash: Type.Optional(Type.String()),
  publickey: T.Pubkey,
  validator_index: Uint64String,
  epoch: Uint64String,
  shares_exit_data: Type.Union([SharesByIndex, Type.Array(SharesByIndex)]),
});

/**
 * The full exit the Obol API serves for one validator: the partial
 * signatures by 0-based operator position (`null` where none is stored).
 * The API does not aggregate them.
 */
export const FullExitResponseSchema = Type.Object({
  epoch: Uint64String,
  validator_index: Uint64String,
  signatures: Type.Array(Type.Union([Type.String(), Type.Null()])),
});

export type ExitMessage = Static<typeof ExitMessageSchema>;
export type PartialExitBlob = Static<typeof PartialExitBlobSchema>;
export type PartialExitsPayload = Static<typeof PartialExitsPayloadSchema>;
export type ShareExitData = Static<typeof ShareExitDataSchema>;
export type StoredExitBlob = Static<typeof StoredExitBlobSchema>;
export type FullExitResponse = Static<typeof FullExitResponseSchema>;

/** A signed voluntary exit for one validator (the aggregated result). */
export interface FullExitBlob {
  public_key: Hex;
  signed_exit_message: {
    message: { epoch: string; validator_index: string };
    signature: Hex;
  };
}
