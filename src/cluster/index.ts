/**
 * cluster: definitions and locks (spec/operations.md "cluster").
 */
import type { Hex, PublicClient } from 'viem';
import type { Context } from '../context.js';
import { accept, create, get, getLock } from './api.js';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
} from './hash.js';
import { assertSignatureClients } from './eip712.js';
import { prepareDefinition } from './prepareDefinition.js';
import type {
  ClusterDefinition,
  ClusterLock,
  PrepareDefinitionInput,
  PreparedDefinition,
} from './schema.js';
import {
  verifyDefinition,
  type DefinitionVerification,
  type VerifyOptions,
} from './verifyDefinition.js';
import {
  isValidLock,
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
  isValidLock,
};
export { isValidEnr, parseEnr, type ParsedEnr } from './enr.js';
export { nobleBls, type BlsBackend, type BlsBatch } from './blsBackend.js';
export {
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
  isValidTypedDataSignature,
  type EIP712TypedData,
  type PublicClients,
  type SignatureClients,
} from './eip712.js';
export {
  DEFAULT_DEFINITION_VERSION,
  SUPPORTED_DEFINITION_VERSIONS,
  type ClusterDefinition,
  type ClusterLock,
  type ClusterOperator,
  type ClusterValidator,
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
 * `chainId` to the client chain, and the verifiers use the client's
 * `publicClient` for contract-wallet signatures on the client chain, after
 * any `publicClient` / `publicClients` the options pass.
 */
export interface ClusterModule {
  computeConfigHash: typeof computeConfigHash;
  computeDefinitionHash: typeof computeDefinitionHash;
  computeLockHash: typeof computeLockHash;
  /** As the pure `prepareDefinition`; `chainId` defaults to the client chain. */
  prepareDefinition: (input: BoundDefinitionInput) => PreparedDefinition;
  /**
   * Takes what `prepareDefinition` returned, or its input (then `creator`
   * defaults to the wallet account and `chainId` to the client chain).
   */
  create: (
    input:
      | PreparedDefinition
      | (Omit<BoundDefinitionInput, 'creator'> & { creator?: string }),
  ) => Promise<Hex>;
  /**
   * Joins a cluster as an operator: fetches the definition, verifies it
   * (`verifyDefinition`, else DEFINITION_INVALID), checks the wallet account is one of its
   * operators (ACCOUNT_NOT_OPERATOR), then signs the config hash and the ENR and posts them.
   * Accepting again with the same ENR returns the definition without signing.
   *
   * @throws ObolError DEFINITION_INVALID, ACCOUNT_NOT_OPERATOR, WALLET_REQUIRED, CHAIN_MISMATCH
   * @see spec/operations.md "cluster.accept"
   */
  accept: (input: {
    configHash: string;
    enr: string;
    version?: string;
  }) => Promise<ClusterDefinition>;
  /**
   * The cluster definition for `configHash` from the Obol API. Not verified: pass it to
   * `verifyDefinition` before acting on it. A file for another hash: API_RESPONSE_MISMATCH.
   *
   * @see spec/operations.md "cluster.get / cluster.getLock"
   */
  get: (configHash: string) => Promise<ClusterDefinition>;
  /**
   * The cluster lock by `configHash` or `lockHash` from the Obol API (API_NOT_FOUND until the
   * DKG has published it). Not verified: use `verifyLock`, or `deposits.fromLock`, which
   * verifies by default.
   *
   * @see spec/operations.md "cluster.get / cluster.getLock"
   */
  getLock: (
    input: { configHash: string } | { lockHash: string },
  ) => Promise<ClusterLock>;
  /**
   * Follows a definition until its lock is published: yields `operator_signed` once per
   * newly signed operator, `definition_ready` once, then `lock_published` and ends. Polls
   * every `intervalMs` (default 12 s) and backs off on rate limits; aborting `signal` ends
   * the iteration without an error.
   *
   * @example
   * ```ts
   * for await (const event of obol.cluster.watch(configHash, { signal })) {
   *   if (event.type === 'lock_published') console.log(event.lockHash);
   * }
   * ```
   * @see spec/operations.md "cluster.watch"
   */
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
  isValidLock: (lock: unknown, options?: VerifyLockOptions) => Promise<boolean>;
}

/** `prepareDefinition`'s input through the client: `chainId` is optional. */
export type BoundDefinitionInput = Omit<PrepareDefinitionInput, 'chainId'> & {
  chainId?: number;
};

export const createClusterModule = (ctx: Context): ClusterModule => ({
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  /** As the pure `prepareDefinition`, with `chainId` defaulting to the client chain. */
  prepareDefinition: input =>
    prepareDefinition({ ...input, chainId: input.chainId ?? ctx.chain.id }),
  create: async input => await create(ctx, input),
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
      withClientFallback(ctx, options),
    ),
  verifyLock: async (lock: unknown, options: VerifyLockOptions = {}) =>
    await verifyLock(lock, withClientFallback(ctx, options)),
  isValidLock: async (lock: unknown, options: VerifyLockOptions = {}) =>
    await isValidLock(lock, withClientFallback(ctx, options)),
});

/**
 * The options' clients, with the client's own `publicClient` for its chain
 * when `publicClients` has none for it.
 */
const withClientFallback = <O extends VerifyLockOptions>(
  ctx: Context,
  options: O,
): O => {
  assertSignatureClients(options, 'options');
  const { publicClients } = options;
  if (publicClients === undefined) {
    return { publicClient: ctx.publicClient, ...options };
  }
  const own = ctx.publicClient;
  const resolve = (chainId: number): PublicClient | undefined =>
    (typeof publicClients === 'function'
      ? publicClients(chainId)
      : publicClients[chainId]) ??
    (own.chain?.id === chainId ? own : undefined);
  return { ...options, publicClients: resolve };
};

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
