/**
 * exits: partial exit verification and aggregation (spec/operations.md
 * "exits").
 */
import type { Context } from '../context.js';
import type { FullExitBlob } from './types.js';
import { aggregate, type AggregateInput } from './aggregate.js';
import {
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
} from './bls.js';
import { assertPartialExit } from './assertPartialExit.js';

export {
  aggregate,
  blsAggregate,
  blsRecoverPubkey,
  blsThresholdAggregate,
  blsVerify,
  assertPartialExit,
};
export type { AggregateInput };
export type { AssertPartialExitInput } from './assertPartialExit.js';
export type { BlsVerifyOptions } from './bls.js';
export type { ExitCluster } from './assertPartialExit.js';
export type {
  ExitMessage,
  FullExitBlob,
  FullExitResponse,
  PartialExitBlob,
  PartialExitsPayload,
  ShareExitData,
  StoredExitBlob,
} from './types.js';

/**
 * The exits module bound to a client context: `aggregate` takes `chainId`
 * from the client.
 */
export interface ExitsModule {
  assertPartialExit: typeof assertPartialExit;
  aggregate: (input: Omit<AggregateInput, 'chainId'>) => FullExitBlob;
  blsVerify: typeof blsVerify;
  blsAggregate: typeof blsAggregate;
  blsThresholdAggregate: typeof blsThresholdAggregate;
  blsRecoverPubkey: typeof blsRecoverPubkey;
}

export const createExitsModule = (ctx: Context): ExitsModule => ({
  assertPartialExit,
  aggregate: (input: Omit<AggregateInput, 'chainId'>) =>
    aggregate({ ...input, chainId: ctx.chain.id }),
  blsVerify,
  blsAggregate,
  blsThresholdAggregate,
  blsRecoverPubkey,
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
