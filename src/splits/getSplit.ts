/** splits.getSplit: SplitV2 state and its params, checked against `splitHash`. */
import { Type } from '@sinclair/typebox';
import {
  decodeEventLog,
  encodeEventTopics,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import {
  multicall3Abi,
  NATIVE_TOKEN,
  splitCreatedEvents,
  splitUpdatedEvent,
  splitWalletAbi,
  warehouseAbi,
} from '../abi.js';
import {
  addressTopic,
  chainReadFailed,
  codeKind,
  scanLogs,
} from '../chainUtils.js';
import { requireContracts, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, sameAddress, T } from '../schema.js';
import type { Source, SplitParams } from '../types.js';
import { headBlock, readAll } from './chain.js';
import {
  checkSplitParams,
  hashSplitParams,
  SplitParamsSchema,
} from './shares.js';

const ZERO_HASH = `0x${'0'.repeat(64)}`;
export const NATIVE_TOKEN_ID = BigInt(NATIVE_TOKEN);

export interface SplitInfo {
  address: Address;
  splitHash: Hex;
  owner: Address;
  paused: boolean;
  /** The split's own ETH balance (wei). */
  balance: bigint;
  /** The split's ETH balance in the Warehouse (wei). */
  warehouseBalance: bigint;
  params: SplitParams | null;
  paramsSource: Source | 'input' | null;
  blockNumber: bigint;
}

const GetSplitInputSchema = Type.Object({
  address: T.Address,
  params: Type.Optional(SplitParamsSchema),
  ovm: Type.Optional(T.Address),
});

export interface GetSplitInput {
  address: Address;
  /** Known params; checked against `splitHash` (SPLIT_PARAMS_MISMATCH). */
  params?: SplitParams;
  /** An OVM paying the split, so the Obol API can be asked for its params. */
  ovm?: Address;
}

export const splitNotFound = (address: Address, reason: string): ObolError =>
  new ObolError(
    'SPLIT_NOT_FOUND',
    `${address} is not a SplitV2 split: ${reason}`,
    {
      hint: 'Check the address',
      details: { address },
    },
  );

export const splitParamsMismatch = (
  address: Address,
  what: string,
): ObolError =>
  new ObolError(
    'SPLIT_PARAMS_MISMATCH',
    `${what} do not match the split at ${address}`,
    {
      hint: 'Pass the exact params the split was created with',
      details: { address },
    },
  );

/**
 * Whether `address` has contract code (not empty, not an EIP-7702
 * delegation) at `blockNumber`. Checked before any call: an address without
 * code, such as a precompile, can still answer calls.
 */
export const hasContractCode = async (
  ctx: Context,
  address: Address,
  blockNumber?: bigint,
): Promise<boolean> => {
  try {
    const code = await ctx.publicClient.getCode({
      address,
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
    return codeKind(code) === 'contract';
  } catch (cause) {
    throw chainReadFailed(`the code at ${address}`, cause);
  }
};

const toBigInt = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
};

// One entry of the API's split params (shape of the planned OVM endpoint);
// anything malformed is ignored.
const parseApiParams = (entry: unknown): SplitParams | null => {
  const e = (entry ?? {}) as Record<string, unknown>;
  if (!Array.isArray(e.recipients) || !Array.isArray(e.allocations)) {
    return null;
  }
  const allocations = e.allocations.map(toBigInt);
  const totalAllocation = toBigInt(e.totalAllocation);
  if (allocations.some(a => a === null) || totalAllocation === null) {
    return null;
  }
  try {
    return checkSplitParams(
      decode(SplitParamsSchema, {
        recipients: e.recipients,
        allocations,
        totalAllocation,
        distributionIncentive: e.distributionIncentive,
      }),
      'params',
    );
  } catch {
    return null;
  }
};

const fromApi = async (
  ctx: Context,
  ovm: Address,
  split: Address,
): Promise<SplitParams[]> => {
  if (ctx.api === null) return [];
  try {
    const body = await ctx.api.request<{ splits?: unknown }>(
      `/v1/ovm/${ctx.chain.network}/${ovm}`,
    );
    const splits = Array.isArray(body?.splits) ? body.splits : [];
    return splits
      .filter(
        (s: unknown) =>
          typeof (s as { address?: unknown })?.address === 'string' &&
          sameAddress((s as { address: string }).address, split),
      )
      .map(parseApiParams)
      .filter((p): p is SplitParams => p !== null);
  } catch {
    // Not found, not live yet, or unavailable: no answer from the API.
    return [];
  }
};

const decodeSplitLog = (log: Log): SplitParams | null => {
  for (const event of [splitUpdatedEvent, ...splitCreatedEvents]) {
    try {
      const { args } = decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const p = (
        '_split' in args ? args._split : args.splitParams
      ) as SplitParams;
      return {
        recipients: p.recipients.map(checksum),
        allocations: [...p.allocations],
        totalAllocation: p.totalAllocation,
        distributionIncentive: p.distributionIncentive,
      };
    } catch {
      // Try the next event shape.
    }
  }
  return null;
};

const byPosition = (a: Log, b: Log): number => {
  const block = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
  return block !== 0 ? block : (a.logIndex ?? 0) - (b.logIndex ?? 0);
};

const fromLogs = async (
  ctx: Context,
  split: Address,
  toBlock: bigint,
): Promise<SplitParams[]> => {
  const { ovmFactory, pullSplitFactory } = requireContracts(
    ctx.chain.id,
    'splits.getSplit',
  );
  const fromBlock = ovmFactory.deployBlock;
  try {
    const [updatedTopic] = encodeEventTopics({ abi: [splitUpdatedEvent] });
    const updates = await scanLogs(
      ctx.publicClient,
      { address: split, topics: [updatedTopic] },
      fromBlock,
      toBlock,
    );
    const createdTopics = splitCreatedEvents.map(
      event => encodeEventTopics({ abi: [event] })[0],
    );
    const created = await scanLogs(
      ctx.publicClient,
      // An array topic matches any of its values (eth_getLogs OR).
      {
        address: pullSplitFactory,
        topics: [createdTopics as unknown as Hex, addressTopic(split)],
      },
      fromBlock,
      toBlock,
      true,
    );
    // Latest update first, then the creation.
    return [
      ...updates
        .filter(log => sameAddress(log.address, split))
        .sort(byPosition)
        .reverse(),
      ...created.filter(log => sameAddress(log.address, pullSplitFactory)),
    ]
      .map(decodeSplitLog)
      .filter((p): p is SplitParams => p !== null);
  } catch {
    // A failed scan is no answer; the caller reports params as unknown.
    return [];
  }
};

/**
 * Params for a split from the Obol API (with `ovm`), then the chain, keeping
 * only an answer that hashes to `splitHash`. The chain source is the latest
 * `SplitUpdated` log of the split, else the factory's `SplitCreated` log,
 * scanned from the OVM factory's deployment block: a split created before
 * that block is not found here and needs its params passed in.
 */
export const findSplitParams = async (
  ctx: Context,
  args: { address: Address; splitHash: Hex; ovm?: Address; toBlock: bigint },
): Promise<{ params: SplitParams; source: Source } | null> => {
  const matches = (p: SplitParams): boolean =>
    hashSplitParams(p).toLowerCase() === args.splitHash.toLowerCase();
  if (args.ovm !== undefined) {
    const api = (await fromApi(ctx, args.ovm, args.address)).find(matches);
    if (api !== undefined) return { params: api, source: 'api' };
  }
  const chain = (await fromLogs(ctx, args.address, args.toBlock)).find(matches);
  return chain !== undefined ? { params: chain, source: 'chain' } : null;
};

/**
 * Reads a SplitV2 split. Checks, in order: the address has contract code and
 * is not an EIP-7702 delegation; `splitHash()`, `owner()`, `paused()` answer
 * and `splitHash` is non-zero (else SPLIT_NOT_FOUND); given `params` hash to
 * `splitHash` (else SPLIT_PARAMS_MISMATCH). Without params it asks the Obol
 * API (when `ovm` is given) and then the split's `SplitUpdated` /
 * `SplitCreated` logs (from the OVM factory's deployment block); answers that
 * do not hash to `splitHash` are discarded. No match: `params: null`.
 */
export const getSplit = async (
  ctx: Context,
  input: GetSplitInput,
): Promise<SplitInfo> => {
  const decoded = decode(GetSplitInputSchema, input);
  const address = checksum(decoded.address);
  const given =
    decoded.params !== undefined
      ? checkSplitParams(decoded.params, 'params')
      : undefined;
  const { multicall3, warehouse } = requireContracts(
    ctx.chain.id,
    'splits.getSplit',
  );

  if (!(await hasContractCode(ctx, address))) {
    throw splitNotFound(
      address,
      'no contract code (or an EIP-7702 delegation)',
    );
  }
  const blockNumber = await headBlock(ctx);
  const [splitHash, owner, paused, balance, warehouseBalance] = await readAll(
    ctx,
    multicall3,
    [
      { address, abi: splitWalletAbi, functionName: 'splitHash' },
      { address, abi: splitWalletAbi, functionName: 'owner' },
      { address, abi: splitWalletAbi, functionName: 'paused' },
      {
        address: multicall3,
        abi: multicall3Abi,
        functionName: 'getEthBalance',
        args: [address],
      },
      {
        address: warehouse,
        abi: warehouseAbi,
        functionName: 'balanceOf',
        args: [address, NATIVE_TOKEN_ID],
      },
    ],
    blockNumber,
    'the split state',
  );
  if (
    typeof splitHash !== 'string' ||
    splitHash === ZERO_HASH ||
    typeof owner !== 'string' ||
    typeof paused !== 'boolean'
  ) {
    throw splitNotFound(address, 'it does not answer the SplitV2 getters');
  }
  if (typeof balance !== 'bigint' || typeof warehouseBalance !== 'bigint') {
    throw chainReadFailed(`the balances of ${address}`, undefined);
  }

  let params: SplitParams | null = null;
  let paramsSource: SplitInfo['paramsSource'] = null;
  if (given !== undefined) {
    if (hashSplitParams(given).toLowerCase() !== splitHash.toLowerCase()) {
      throw splitParamsMismatch(address, 'The given params');
    }
    params = given;
    paramsSource = 'input';
  } else {
    const found = await findSplitParams(ctx, {
      address,
      splitHash: splitHash as Hex,
      ...(decoded.ovm !== undefined ? { ovm: checksum(decoded.ovm) } : {}),
      toBlock: blockNumber,
    });
    if (found !== null) {
      params = found.params;
      paramsSource = found.source;
    }
  }
  return {
    address,
    splitHash: splitHash as Hex,
    owner: checksum(owner),
    paused,
    balance,
    warehouseBalance,
    params,
    paramsSource,
    blockNumber,
  };
};
