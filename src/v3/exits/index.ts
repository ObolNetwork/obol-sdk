/**
 * exits: partial exit verification and aggregation (spec/operations.md
 * "exits").
 */
import type { Context } from '../context.js';
import type { SignedExit } from './types.js';
import { aggregate, type AggregateInput } from './aggregate.js';
import {
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
} from './bls.js';
import {
  verifyPartialExit,
  type VerifyPartialExitInput,
} from './verifyPartialExit.js';

export {
  aggregate,
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
  verifyPartialExit,
};
export type { AggregateInput, VerifyPartialExitInput };
export type {
  ExistingExit,
  ExitBlob,
  ExitMessage,
  SignedExit,
} from './types.js';

/**
 * The exits module bound to a client context: `aggregate` defaults
 * `forkVersion` to the client chain's.
 */
export interface ExitsModule {
  verifyPartialExit: typeof verifyPartialExit;
  aggregate: (
    input: Omit<AggregateInput, 'forkVersion'> & { forkVersion?: string },
  ) => SignedExit;
  blsVerify: typeof blsVerify;
  blsAggregate: typeof blsAggregate;
  blsThresholdAggregate: typeof blsThresholdAggregate;
  blsRecoverPubkey: typeof blsRecoverPubkey;
}

export const createExitsModule = (ctx: Context): ExitsModule => ({
  verifyPartialExit,
  aggregate: (
    input: Omit<AggregateInput, 'forkVersion'> & { forkVersion?: string },
  ) =>
    aggregate({
      ...input,
      forkVersion: input.forkVersion ?? ctx.chain.forkVersion,
    }),
  blsVerify,
  blsAggregate,
  blsThresholdAggregate,
  blsRecoverPubkey,
});
