import { Type, type Static } from '@sinclair/typebox';
import { T } from '../schema.js';

/** uint64 as a decimal string (epochs and validator indexes on the wire). */
export const Uint64String = Type.String({
  pattern: '^(0|[1-9][0-9]{0,19})$',
  description: 'uint64 as a decimal string',
});

export const ExitMessageSchema = Type.Object({
  epoch: Uint64String,
  validatorIndex: Uint64String,
});

/** One validator's partial exit, signed by one operator's share. */
export const ExitBlobSchema = Type.Object({
  publicKey: T.Pubkey,
  signedExitMessage: Type.Object({
    message: ExitMessageSchema,
    signature: T.BlsSignature,
  }),
});

/**
 * The exit stored for a validator: its message and the partial signatures
 * collected so far, keyed by 0-based operator index (share index − 1), as
 * the Obol API stores them. Empty strings are shares not yet received.
 */
export const ExistingExitSchema = Type.Object({
  publicKey: T.Pubkey,
  epoch: Uint64String,
  validatorIndex: Uint64String,
  partialSignatures: Type.Record(
    Type.String({ pattern: '^(0|[1-9][0-9]*)$' }),
    Type.String(),
  ),
});

export type ExitMessage = Static<typeof ExitMessageSchema>;
export type ExitBlob = Static<typeof ExitBlobSchema>;
export type ExistingExit = Static<typeof ExistingExitSchema>;

export interface SignedExit {
  publicKey: `0x${string}`;
  signedExitMessage: {
    message: ExitMessage;
    signature: `0x${string}`;
  };
}
