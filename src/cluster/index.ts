/**
 * cluster: definitions and locks (spec/operations.md "cluster").
 */
import type { Hex } from 'viem';
import type { Context } from '../context.js';
import { accept, create, get, getLock } from './api.js';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
} from './hash.js';
import { prepareDefinition } from './prepareDefinition.js';
import type {
  ClusterDefinition,
  ClusterLock,
  PreparedDefinition,
} from './schema.js';
import {
  verifyDefinition,
  type DefinitionVerification,
  type VerifyOptions,
} from './verifyDefinition.js';
import {
  verifyLock,
  type LockVerification,
  type VerifyLockOptions,
} from './verifyLock.js';
import { watch, type ClusterEvent, type WatchOptions } from './watch.js';

export {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  prepareDefinition,
  verifyDefinition,
  verifyLock,
};
export { nobleBls, type BlsBackend, type BlsBatch } from './blsBackend.js';
export {
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
} from './eip712.js';
export {
  DEFAULT_DEFINITION_VERSION,
  SUPPORTED_DEFINITION_VERSIONS,
  type ClusterDefinition,
  type ClusterLock,
  type ClusterOperator,
  type PrepareDefinitionInput,
  type PreparedDefinition,
} from './schema.js';
export type {
  DefinitionIssue,
  DefinitionVerification,
  VerifyOptions,
} from './verifyDefinition.js';
export type {
  LockStep,
  LockVerification,
  LockVerificationLevel,
  VerifyLockOptions,
} from './verifyLock.js';
export type { ClusterEvent, WatchOptions } from './watch.js';

/**
 * The cluster module bound to a client context. `verifyDefinition` defaults
 * `chainId` to the client chain, and both verifiers use the client's
 * `publicClient` for contract-wallet signatures unless the options pass one.
 */
export interface ClusterModule {
  computeConfigHash: typeof computeConfigHash;
  computeDefinitionHash: typeof computeDefinitionHash;
  computeLockHash: typeof computeLockHash;
  prepareDefinition: (
    input: { chainId?: number } & object,
  ) => PreparedDefinition;
  create: (input: unknown) => Promise<Hex>;
  accept: (input: {
    configHash: string;
    enr: string;
    version?: string;
  }) => Promise<ClusterDefinition>;
  get: (configHash: string) => Promise<ClusterDefinition>;
  getLock: (
    input: { configHash: string } | { lockHash: string },
  ) => Promise<ClusterLock>;
  watch: (
    configHash: string,
    options: WatchOptions,
  ) => AsyncIterable<ClusterEvent>;
  verifyDefinition: (
    input: { definition: unknown; configHash?: string; chainId?: number },
    options?: VerifyOptions,
  ) => Promise<DefinitionVerification>;
  verifyLock: (
    lock: unknown,
    options?: VerifyLockOptions,
  ) => Promise<LockVerification>;
}

export const createClusterModule = (ctx: Context): ClusterModule => ({
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  /** As the pure `prepareDefinition`, with `chainId` defaulting to the client chain. */
  prepareDefinition: (input: { chainId?: number } & object) =>
    prepareDefinition({ ...input, chainId: input.chainId ?? ctx.chain.id }),
  create: async (input: unknown) => await create(ctx, input),
  accept: async input => await accept(ctx, input),
  get: async configHash => await get(ctx, configHash),
  getLock: async input => await getLock(ctx, input),
  watch: (configHash, options) => watch(ctx, configHash, options),
  verifyDefinition: async (
    input: { definition: unknown; configHash?: string; chainId?: number },
    options: VerifyOptions = {},
  ) =>
    await verifyDefinition(
      { ...input, chainId: input.chainId ?? ctx.chain.id },
      { ...options, publicClient: options.publicClient ?? ctx.publicClient },
    ),
  verifyLock: async (lock: unknown, options: VerifyLockOptions = {}) =>
    await verifyLock(lock, { publicClient: ctx.publicClient, ...options }),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
