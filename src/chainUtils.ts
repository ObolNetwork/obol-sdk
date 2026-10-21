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
import { publicForwarder } from './chains.js';
import type { Context } from './context.js';
import { ObolError } from './errors.js';
import type { FindingCode } from './codes.js';
import type {
  Finding,
  FindingSubject,
  Prepared,
  PreparedKind,
  PreviewByKind,
} from './types.js';

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

/**
 * The one head-block helper: the chain head, bypassing the viem client's
 * block-number cache (`cacheTime`, by default the polling interval), since
 * reads pinned to a cached number would miss a transaction the caller has
 * just mined. A failed read is CHAIN_READ_FAILED.
 */
export const latestBlockNumber = async (
  client: PublicClient,
): Promise<bigint> => {
  try {
    return await client.getBlockNumber({ cacheTime: 0 });
  } catch (cause) {
    throw chainReadFailed('the block number', cause);
  }
};

export const addressTopic = (address: Address): Hex =>
  pad(address.toLowerCase() as Hex, { size: 32 });

/** The smallest log window `scanLogs` shrinks to before it gives up. */
export const LOG_CHUNK_FLOOR = 1_000n;

/** The window that last worked, per client: later scans start there. */
const logWindows = new WeakMap<PublicClient, bigint>();

const RANGE_MESSAGE =
  /range|too many|limit exceeded|query returned more than|exceed|too large|response size|max results/i;

/**
 * Whether an eth_getLogs failure is the RPC refusing the size of the range
 * or of the answer (codes -32005, 413; -32600 / -32602 with a range message;
 * the common messages of public RPCs), not a genuine failure.
 */
export const isLogRangeError = (error: unknown): boolean => {
  for (
    let e = error as Record<string, unknown> | undefined, depth = 0;
    e !== undefined && e !== null && depth < 6;
    depth++
  ) {
    const code = e.code;
    const status = e.status;
    const text = [e.message, e.details, e.shortMessage]
      .filter(x => typeof x === 'string')
      .join(' ');
    if (code === -32005 || status === 413) return true;
    if (
      (code === -32600 || code === -32602 || code === -32000) &&
      RANGE_MESSAGE.test(text)
    ) {
      return true;
    }
    if (RANGE_MESSAGE.test(text) && /log|block|result|range/i.test(text)) {
      return true;
    }
    e = e.cause as Record<string, unknown> | undefined;
  }
  return false;
};

/**
 * Reads logs from `fromBlock` to `toBlock` in windows of at most
 * LOG_CHUNK_SIZE blocks, a few requests at a time. Public RPCs cap the range
 * (often 10,000 blocks) or the number of results: on such a refusal the
 * window is halved and that range retried, down to LOG_CHUNK_FLOOR, and the
 * size that works is remembered for the client. With `stopOnFirst` (a
 * "find the event" scan) the ranges are read newest first and the scan stops
 * at the first range with a log, so a recently created contract resolves
 * fast. Any other failure rejects: a partial scan is never returned as
 * complete.
 */
export const scanLogs = async (
  client: PublicClient,
  filter: { address: Address; topics: Array<Hex | Hex[] | null> },
  fromBlock: bigint,
  toBlock: bigint,
  stopOnFirst = false,
): Promise<Log[]> => {
  if (toBlock < fromBlock) return [];
  const request = async (from: bigint, to: bigint): Promise<Log[]> => {
    const chunk = await client.request({
      method: 'eth_getLogs',
      params: [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: toHex(from),
          toBlock: toHex(to),
        },
      ],
    });
    return chunk.map(formatRpcLog);
  };
  /** One range, split in halves while the RPC refuses its size. */
  const fetchRange = async (from: bigint, to: bigint): Promise<Log[]> => {
    try {
      return await request(from, to);
    } catch (error) {
      const size = to - from + 1n;
      if (!isLogRangeError(error) || size <= LOG_CHUNK_FLOOR) throw error;
      // Halves, but not below the floor: a range refused at the floor fails.
      const half =
        (size + 1n) / 2n > LOG_CHUNK_FLOOR ? (size + 1n) / 2n : LOG_CHUNK_FLOOR;
      const known = logWindows.get(client) ?? LOG_CHUNK_SIZE;
      logWindows.set(client, half < known ? half : known);
      const mid = from + half - 1n;
      const first = await fetchRange(from, mid);
      return [...first, ...(await fetchRange(mid + 1n, to))];
    }
  };

  const logs: Log[] = [];
  if (stopOnFirst) {
    // Newest first, one range at a time.
    let end = toBlock;
    for (;;) {
      const size = logWindows.get(client) ?? LOG_CHUNK_SIZE;
      const start = end - size + 1n > fromBlock ? end - size + 1n : fromBlock;
      const found = await fetchRange(start, end);
      if (found.length > 0) return found;
      if (start === fromBlock) return [];
      end = start - 1n;
    }
  }
  let next = fromBlock;
  while (next <= toBlock) {
    const size = logWindows.get(client) ?? LOG_CHUNK_SIZE;
    const group: Array<[bigint, bigint]> = [];
    while (next <= toBlock && group.length < LOG_CHUNK_CONCURRENCY) {
      const end = next + size - 1n < toBlock ? next + size - 1n : toBlock;
      group.push([next, end]);
      next = end + 1n;
    }
    const results = await Promise.all(
      group.map(async ([from, to]) => await fetchRange(from, to)),
    );
    for (const chunk of results) logs.push(...chunk);
  }
  return logs;
};

export const chainReadFailed = (
  what: string,
  cause: unknown,
): ObolError<'CHAIN_READ_FAILED'> =>
  new ObolError('CHAIN_READ_FAILED', `Could not read ${what} from the chain`, {
    hint: 'Retry, or use another RPC',
    cause,
    details: { what },
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
  code: FindingCode,
  severity: Finding['severity'],
  message: string,
  extra: {
    hint?: string;
    subject?: FindingSubject;
    details?: Record<string, unknown>;
  } = {},
): Finding => ({ code, severity, message, ...extra });

export const prepared = <K extends PreparedKind>(
  ctx: Context,
  kind: K,
  args: {
    to: Address;
    data: Hex;
    value?: bigint;
    checks?: Finding[];
    preview: PreviewByKind[K];
    blockNumber?: bigint;
  },
): Prepared<K> => ({
  kind,
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
      {
        hint: 'Retry; check the chain is post-Pectra',
        cause,
        details: { predeploy },
      },
    );
  }
  if (data === undefined || data === '0x') {
    throw new ObolError(
      'FEE_READ_FAILED',
      `${predeploy} returned no request fee`,
      {
        hint: 'Retry; check the chain is post-Pectra',
        details: { predeploy },
      },
    );
  }
  return BigInt(data);
};

/**
 * Total fee for `count` requests. A given total must be in
 * [current × count, max(10 × current, 1 gwei) × count]. Without one:
 * `defaultTo: 'cap'` uses the top of that range (OVM requests: the OVM
 * refunds the excess to `excessFeeRecipient`), `'minimum'` exactly
 * current × count (direct requests: the predeploy keeps any excess).
 */
export const resolveRequestFee = ({
  currentFee,
  requestedFee,
  count,
  defaultTo,
}: {
  currentFee: bigint;
  requestedFee?: bigint;
  count: number;
  defaultTo: 'cap' | 'minimum';
}): bigint => {
  const n = BigInt(count);
  const minimum = currentFee * n;
  const cap =
    currentFee * MAX_FEE_MULTIPLIER > MAX_FEE_FLOOR
      ? currentFee * MAX_FEE_MULTIPLIER
      : MAX_FEE_FLOOR;
  const maximum = cap * n;
  if (requestedFee === undefined) {
    return defaultTo === 'cap' ? maximum : minimum;
  }
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

/**
 * A public forwarder (a contract that makes calls as itself for any caller,
 * such as Multicall3) must not own an OVM or split, nor receive funds from
 * one: anyone could use its ownership, or move ETH it holds.
 * PUBLIC_FORWARDER_AS_OWNER / PUBLIC_FORWARDER_AS_RECIPIENT.
 */
export const refusePublicForwarders = (
  chainId: number,
  entries: Array<{
    path: string;
    address: Address;
    kind: 'owner' | 'recipient';
  }>,
): void => {
  for (const { path, address, kind } of entries) {
    const forwarder = publicForwarder(chainId, address);
    if (forwarder === undefined) continue;
    const reason = `${forwarder.name} makes calls as itself for any caller`;
    if (kind === 'owner') {
      throw new ObolError(
        'PUBLIC_FORWARDER_AS_OWNER',
        `Refusing to make ${address} (${path}) an owner: ${reason}, so anyone could use the ownership`,
        {
          hint: 'Use the account or Safe that will manage the contract',
          details: { path, newOwner: address, reason },
        },
      );
    }
    throw new ObolError(
      'PUBLIC_FORWARDER_AS_RECIPIENT',
      `Refusing ${address} (${path}) as a recipient: ${reason}, so anyone could move ETH sent to it`,
      {
        hint: 'Use the account, Safe or split that should receive the funds',
        details: { path, recipient: address, reason },
      },
    );
  }
};
