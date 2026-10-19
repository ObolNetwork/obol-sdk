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
  accept,
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  create,
  get,
  getLock,
  prepareDefinition,
  verifyDefinition,
  verifyLock,
  watch,
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
    configHash: Hex;
    enr: string;
    version?: string;
  }) => Promise<ClusterDefinition>;
  get: (configHash: Hex) => Promise<ClusterDefinition>;
  getLock: (
    input: { configHash: Hex } | { lockHash: Hex },
  ) => Promise<ClusterLock>;
  watch: (
    configHash: Hex,
    options: WatchOptions,
  ) => AsyncIterable<ClusterEvent>;
  verifyDefinition: (
    input: { definition: unknown; configHash?: Hex; chainId?: number },
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
  accept: async (input: { configHash: Hex; enr: string; version?: string }) =>
    await accept(ctx, input),
  get: async (configHash: Hex) => await get(ctx, configHash),
  getLock: async (input: { configHash: Hex } | { lockHash: Hex }) =>
    await getLock(ctx, input),
  watch: (configHash: Hex, options: WatchOptions) =>
    watch(ctx, configHash, options),
  verifyDefinition: async (
    input: { definition: unknown; configHash?: Hex; chainId?: number },
    options: VerifyOptions = {},
  ) =>
    await verifyDefinition(
      { ...input, chainId: input.chainId ?? ctx.chain.id },
      { ...options, publicClient: options.publicClient ?? ctx.publicClient },
    ),
  verifyLock: async (lock: unknown, options: VerifyLockOptions = {}) =>
    await verifyLock(lock, { publicClient: ctx.publicClient, ...options }),
});
