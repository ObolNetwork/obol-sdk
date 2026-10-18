/** Chain helpers shared by the modules. */
import {
  formatLog,
  pad,
  toHex,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type RpcLog,
} from 'viem';
import type { Context } from './context.js';
import { ObolError } from './errors.js';
import type { Finding, Prepared } from './types.js';

const formatRpcLog = (log: RpcLog): Log => formatLog(log);

export const LOG_CHUNK_SIZE = 50_000n;
export const LOG_CHUNK_CONCURRENCY = 4;

export type CodeKind = 'none' | 'delegated' | 'contract';

/**
 * What is at an address: nothing (an EOA, or a precompile, which has no code),
 * an EIP-7702 delegation (`0xef0100` + address), or contract code.
 */
export const codeKind = (code: Hex | undefined): CodeKind => {
  if (code === undefined || code === '0x') return 'none';
  if (code.toLowerCase().startsWith('0xef0100') && code.length === 48) {
    return 'delegated';
  }
  return 'contract';
};

export const getCodeKind = async (
  client: PublicClient,
  address: Address,
  blockNumber?: bigint,
): Promise<CodeKind> =>
  codeKind(
    await client.getCode({
      address,
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }),
  );

export const addressTopic = (address: Address): Hex =>
  pad(address.toLowerCase() as Hex, { size: 32 });

/**
 * Reads logs from `fromBlock` to `toBlock` in LOG_CHUNK_SIZE requests, a few
 * at a time. With `stopOnFirst`, stops after the first group that found a log.
 * Any failed request rejects: a partial scan is never returned as complete.
 */
export const scanLogs = async (
  client: PublicClient,
  filter: { address: Address; topics: Array<Hex | Hex[] | null> },
  fromBlock: bigint,
  toBlock: bigint,
  stopOnFirst = false,
): Promise<Log[]> => {
  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_SIZE) {
    const end = start + LOG_CHUNK_SIZE - 1n;
    ranges.push([start, end < toBlock ? end : toBlock]);
  }
  const logs: Log[] = [];
  for (let i = 0; i < ranges.length; i += LOG_CHUNK_CONCURRENCY) {
    const group = ranges.slice(i, i + LOG_CHUNK_CONCURRENCY);
    const results = await Promise.all(
      group.map(
        async ([from, to]) =>
          await client.request({
            method: 'eth_getLogs',
            params: [
              {
                address: filter.address,
                topics: filter.topics,
                fromBlock: toHex(from),
                toBlock: toHex(to),
              },
            ],
          }),
      ),
    );
    for (const chunk of results) logs.push(...chunk.map(formatRpcLog));
    if (stopOnFirst && logs.length > 0) break;
  }
  return logs;
};

export const chainReadFailed = (what: string, cause: unknown): ObolError =>
  new ObolError('CHAIN_READ_FAILED', `Could not read ${what} from the chain`, {
    hint: 'Retry, or use another RPC',
    cause,
  });

export const contractNotAvailable = (
  address: Address,
  what: string,
  reason = 'has no code on this chain',
): ObolError =>
  new ObolError('CONTRACT_NOT_AVAILABLE', `${what} at ${address} ${reason}`, {
    hint: 'Check the chain; contact Obol if it persists',
    details: { address },
  });

export const finding = (
  code: string,
  severity: Finding['severity'],
  message: string,
  extra: { hint?: string; details?: Record<string, unknown> } = {},
): Finding => ({ code, severity, message, ...extra });

export const prepared = <P>(
  ctx: Context,
  args: {
    to: Address;
    data: Hex;
    value?: bigint;
    checks?: Finding[];
    preview: P;
    blockNumber?: bigint;
  },
): Prepared<P> => ({
  request: {
    to: args.to,
    data: args.data,
    value: args.value ?? 0n,
    chainId: ctx.chain.id,
  },
  checks: args.checks ?? [],
  preview: args.preview,
  ...(args.blockNumber !== undefined ? { blockNumber: args.blockNumber } : {}),
});

/* ------------------------------------------------------------------------ */
/* EIP-7002 / EIP-7251 request fees (vectors request_fees.json)              */
/* ------------------------------------------------------------------------ */

const MAX_FEE_MULTIPLIER = 10n;
const MAX_FEE_FLOOR = 1_000_000_000n; // 1 gwei

/** Reads the current per-request fee of an EIP-7002 / EIP-7251 predeploy. */
export const readRequestFee = async (
  client: PublicClient,
  predeploy: Address,
  blockNumber?: bigint,
): Promise<bigint> => {
  let data: Hex | undefined;
  try {
    ({ data } = await client.call({
      to: predeploy,
      data: '0x',
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }));
  } catch (cause) {
    throw new ObolError(
      'FEE_READ_FAILED',
      `Could not read the request fee from ${predeploy}`,
      { hint: 'Retry; check the chain is post-Pectra', cause },
    );
  }
  if (data === undefined || data === '0x') {
    throw new ObolError(
      'FEE_READ_FAILED',
      `${predeploy} returned no request fee`,
      { hint: 'Retry; check the chain is post-Pectra' },
    );
  }
  return BigInt(data);
};

/**
 * Total fee for `count` requests. Default: `multiplier` × current × count
 * (2 where the excess is refunded, 1 for direct EIP-7002 requests). A given
 * total must be in [current × count, max(10 × current, 1 gwei) × count].
 */
export const resolveRequestFee = ({
  currentFee,
  requestedFee,
  count,
  multiplier,
}: {
  currentFee: bigint;
  requestedFee?: bigint;
  count: number;
  multiplier: bigint;
}): bigint => {
  const n = BigInt(count);
  if (requestedFee === undefined) return currentFee * multiplier * n;
  const minimum = currentFee * n;
  const cap =
    currentFee * MAX_FEE_MULTIPLIER > MAX_FEE_FLOOR
      ? currentFee * MAX_FEE_MULTIPLIER
      : MAX_FEE_FLOOR;
  const maximum = cap * n;
  if (requestedFee < minimum || requestedFee > maximum) {
    throw new ObolError(
      'FEE_OUT_OF_RANGE',
      `Fee ${requestedFee} wei is outside [${minimum}, ${maximum}] wei for ${count} request(s)`,
      {
        hint: 'Omit the fee to use the default, or pass one in range',
        details: { fee: requestedFee, minimum, maximum },
      },
    );
  }
  return requestedFee;
};
