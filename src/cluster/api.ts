/**
 * Cluster operations that talk to the Obol API: get, getLock, create, accept.
 */
import { ENR } from '@chainsafe/enr';
import { Type } from '@sinclair/typebox';
import type { Hex } from 'viem';
import type { ObolApi } from '../api.js';
import {
  accountAddress,
  requireApi,
  requireWallet,
  type Context,
} from '../context.js';
import { ObolApiError, ObolError } from '../errors.js';
import {
  checksum,
  decode,
  invalid,
  sameAddress,
  sameHex,
  T,
} from '../schema.js';
import {
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
  signTypedData,
} from './eip712.js';
import { definitionHash } from './hash.js';
import { prepareDefinition } from './prepareDefinition.js';
import {
  DefinitionSchema,
  type ClusterDefinition,
  type ClusterLock,
  type PreparedDefinition,
} from './schema.js';
import { verifyDefinition } from './verifyDefinition.js';

const responseMismatch = (
  endpoint: string,
  body: unknown,
  message: string,
): ObolApiError =>
  new ObolApiError(
    'API_RESPONSE_MISMATCH',
    message,
    { status: 200, endpoint, method: 'GET', body },
    { hint: 'Report it; do not use the answer' },
  );

/** GET that checks the answer is the file asked for. */
const getChecked = async <R>(
  api: ObolApi,
  endpoint: string,
  hashOf: (body: any) => unknown,
  expected: string,
  options: { signal?: AbortSignal } = {},
): Promise<R> => {
  const body = await api.request<unknown>(endpoint, options);
  let actual: unknown;
  try {
    actual = hashOf(body);
  } catch {
    actual = undefined;
  }
  if (typeof actual !== 'string' || !sameHex(actual, expected)) {
    throw responseMismatch(
      endpoint,
      body,
      `Obol API answered ${endpoint} with a file for ${String(actual)}`,
    );
  }
  return body as R;
};

export const definitionEndpoint = (configHash: string): string =>
  `/v1/definition/${configHash}`;
export const lockByConfigHashEndpoint = (configHash: string): string =>
  `/v1/lock/configHash/${configHash}`;

/** @internal Shared with watch, which passes an AbortSignal. */
export const fetchDefinition = async (
  api: ObolApi,
  configHash: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClusterDefinition> =>
  await getChecked(
    api,
    definitionEndpoint(configHash),
    body => body.config_hash,
    configHash,
    options,
  );

/** @internal Shared with watch. */
export const fetchLockByConfigHash = async (
  api: ObolApi,
  configHash: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClusterLock> =>
  await getChecked(
    api,
    lockByConfigHashEndpoint(configHash),
    body => body.cluster_definition.config_hash,
    configHash,
    options,
  );

/**
 * Fetches a cluster definition by config hash. The file is not verified
 * (use `verifyDefinition`), but its `config_hash` must be the requested one.
 *
 * @throws PAYLOAD_INVALID, API_DISABLED, API_* (API_NOT_FOUND),
 *   API_RESPONSE_MISMATCH.
 */
export const get = async (
  ctx: Context,
  configHash: string,
): Promise<ClusterDefinition> => {
  const hash = decode(T.Hash32, configHash, 'configHash');
  return await fetchDefinition(requireApi(ctx, 'cluster.get'), hash);
};

export const GetLockSchema = Type.Union([
  Type.Object({ configHash: T.Hash32 }, { additionalProperties: false }),
  Type.Object({ lockHash: T.Hash32 }, { additionalProperties: false }),
]);

/**
 * Fetches a cluster lock by config hash or lock hash. The lock is not
 * verified (use `verifyLock` or `deposits.fromLock`), but its `config_hash`
 * / `lock_hash` must be the requested one.
 *
 * @throws PAYLOAD_INVALID, API_DISABLED, API_* (API_NOT_FOUND while the DKG
 *   has not published a lock), API_RESPONSE_MISMATCH.
 */
export const getLock = async (
  ctx: Context,
  input: { configHash: string } | { lockHash: string },
): Promise<ClusterLock> => {
  const args = decode(GetLockSchema, input);
  const api = requireApi(ctx, 'cluster.getLock');
  if ('configHash' in args) {
    return await fetchLockByConfigHash(api, args.configHash);
  }
  return await getChecked(
    api,
    `/v1/lock/${args.lockHash}`,
    body => body.lock_hash,
    args.lockHash,
  );
};

const isPrepared = (input: unknown): input is PreparedDefinition =>
  typeof input === 'object' &&
  input !== null &&
  'definition' in input &&
  'configHash' in input;

/**
 * Signs `CreatorConfigHash` with the wallet and posts the definition.
 * Takes the output of `prepareDefinition`, or its input (then `creator` and
 * `chainId` default to the wallet account and the client chain).
 *
 * Checks: the wallet is on the client chain; the definition is for the
 * client chain; the wallet account is the definition's creator; the config
 * hash recomputed from the definition equals the given one.
 *
 * @returns The config hash.
 * @throws WALLET_REQUIRED, CHAIN_MISMATCH, PAYLOAD_INVALID (`creator`),
 *   DEFINITION_INVALID, API_DISABLED, API_* (API_CONFLICT: it exists; read
 *   it with `cluster.get`; API_UNAUTHORIZED: terms not accepted).
 */
export const create = async (ctx: Context, input: unknown): Promise<Hex> => {
  const api = requireApi(ctx, 'cluster.create');
  const { walletClient, account } = await requireWallet(ctx, 'cluster.create');
  const address = accountAddress(account);

  let prepared: PreparedDefinition;
  if (isPrepared(input)) {
    prepared = {
      definition: decode(DefinitionSchema, input.definition, 'definition'),
      configHash: decode(T.Hash32, input.configHash, 'configHash') as Hex,
    };
  } else {
    prepared = prepareDefinition({
      creator: address,
      chainId: ctx.chain.id,
      ...(input as object),
    });
  }
  const { definition, configHash } = prepared;

  if (definition.fork_version.toLowerCase() !== ctx.chain.forkVersion) {
    throw definitionInvalid(configHash, [
      {
        code: 'fork_version_mismatch',
        message: `fork_version ${definition.fork_version} is not the client chain's ${ctx.chain.forkVersion}`,
      },
    ]);
  }
  if (!sameAddress(definition.creator.address, address)) {
    throw invalid(
      'creator',
      `the wallet account ${address} is not the definition creator ${definition.creator.address}`,
    );
  }
  const computed = definitionHash(definition, true);
  if (
    !sameHex(computed, configHash) ||
    !sameHex(computed, definition.config_hash)
  ) {
    throw definitionInvalid(configHash, [
      {
        code: 'config_hash_mismatch',
        message: `the definition hashes to ${computed}, not ${configHash}`,
      },
    ]);
  }

  const signature = await signTypedData(
    walletClient,
    account,
    creatorConfigHashTypedData(computed, ctx.chain.id),
  );
  try {
    await api.request('/v1/definition', {
      method: 'POST',
      body: { ...definition, config_hash: computed },
      headers: {
        Authorization: `Bearer ${signature}`,
        'fork-version': ctx.chain.forkVersion,
      },
    });
  } catch (error) {
    if (error instanceof ObolApiError && error.code === 'API_CONFLICT') {
      throw new ObolApiError(error.code, error.message, error, {
        hint: `This definition exists; read it with cluster.get('${computed}')`,
        cause: error,
      });
    }
    throw error;
  }
  return computed;
};

const definitionInvalid = (
  configHash: string,
  issues: Array<{ code: string; message: string }>,
): ObolError =>
  new ObolError(
    'DEFINITION_INVALID',
    `Cluster definition ${configHash} failed verification: ${issues
      .map(i => i.message)
      .join('; ')}`,
    {
      hint: 'Do not sign it; check the config hash and the client chain',
      details: { issues },
    },
  );

export const AcceptSchema = Type.Object(
  {
    configHash: T.Hash32,
    enr: Type.String({ pattern: '^enr:' }),
    version: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Joins a cluster as an operator: signs `OperatorConfigHash` and `ENR` with
 * the wallet and puts the operator payload.
 *
 * Checks, in order: the wallet is on the client chain; the fetched
 * definition passes `verifyDefinition` for the client chain (config hash,
 * fork version, signatures); an explicit `version` equals the definition's;
 * the wallet account is one of the operators. If that operator already
 * signed with the same ENR, the definition is returned without signing.
 *
 * @returns The updated definition.
 * @throws WALLET_REQUIRED, CHAIN_MISMATCH, PAYLOAD_INVALID (`enr`),
 *   DEFINITION_INVALID, ACCOUNT_NOT_OPERATOR, API_DISABLED, API_* (API_CONFLICT
 *   when the API refuses a different ENR).
 */
export const accept = async (
  ctx: Context,
  input: { configHash: string; enr: string; version?: string },
): Promise<ClusterDefinition> => {
  const args = decode(AcceptSchema, input);
  try {
    ENR.decodeTxt(args.enr);
  } catch {
    throw invalid('enr', 'must be a valid ENR');
  }
  const api = requireApi(ctx, 'cluster.accept');
  const { walletClient, account } = await requireWallet(ctx, 'cluster.accept');
  const address = accountAddress(account);

  const definition = await fetchDefinition(api, args.configHash);
  const verification = await verifyDefinition(
    { definition, configHash: args.configHash, chainId: ctx.chain.id },
    { publicClient: ctx.publicClient },
  );
  if (!verification.ok) {
    throw definitionInvalid(args.configHash, verification.issues);
  }
  if (args.version !== undefined && args.version !== definition.version) {
    throw definitionInvalid(args.configHash, [
      {
        code: 'version_mismatch',
        message: `version ${args.version} is not the definition's ${definition.version}`,
      },
    ]);
  }

  const operator = (definition.operators ?? []).find(
    o => typeof o.address === 'string' && sameAddress(o.address, address),
  );
  if (operator === undefined) {
    throw new ObolError(
      'ACCOUNT_NOT_OPERATOR',
      `${address} is not an operator of cluster ${args.configHash}`,
      {
        hint: 'Use the wallet of one of the operator addresses',
        details: { address: checksum(address), configHash: args.configHash },
      },
    );
  }
  if (
    typeof operator.config_signature === 'string' &&
    operator.config_signature !== '' &&
    operator.enr === args.enr
  ) {
    return definition;
  }

  // Sign the stored config_hash: verifiers check the signature against it.
  const configHash = definition.config_hash;
  const operatorSignature = await signTypedData(
    walletClient,
    account,
    operatorConfigHashTypedData(configHash, ctx.chain.id),
  );
  const enrSignature = await signTypedData(
    walletClient,
    account,
    enrTypedData(args.enr, ctx.chain.id),
  );
  return await api.request<ClusterDefinition>(definitionEndpoint(configHash), {
    method: 'PUT',
    body: {
      address: checksum(address),
      enr: args.enr,
      version: definition.version,
      enr_signature: enrSignature,
      fork_version: ctx.chain.forkVersion,
    },
    headers: { Authorization: `Bearer ${operatorSignature}` },
  });
};
