/**
 * Simulation backends: `eth_simulateV1` (with `traceTransfers`), then
 * `debug_traceCall` (callTracer with logs + prestateTracer in diff mode),
 * then plain `eth_call` (success or revert only). Which ones a node supports
 * is detected once per PublicClient.
 */
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isHex,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { multicall3Abi } from '../abi.js';
import { ObolError } from '../errors.js';
import { ZERO_ADDRESS } from '../schema.js';
import { ETH_TRANSFER_LOG_ADDRESS, type RawLog } from './decode.js';
import type { SimulationBackend } from './types.js';

export interface SimTx {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

export interface ReadCall {
  target: Address;
  callData: Hex;
}

export interface Failure {
  message: string;
  data?: Hex;
}

export interface Execution {
  success: boolean;
  gasUsed: bigint;
  failure?: Failure;
  /** Logs of the calls that did not revert, in order (no synthetic transfer logs). */
  logs: RawLog[];
  /** Addresses whose ETH balance the call changes. */
  ethAddresses: Address[];
  /** For a failed batch: the first inner call that failed, when the backend can tell. */
  inner?: { index: number; target: Address; failure: Failure };
}

export interface Reads {
  before: Array<Hex | undefined>;
  after: Array<Hex | undefined>;
}

/** A backend bound to one transaction and block. */
export interface FullBackend {
  name: 'eth_simulateV1' | 'debug_traceCall';
  execute: () => Promise<Execution>;
  /** Runs `calls` (as Multicall3 reads that may fail) before and after the transaction. */
  read: (calls: ReadCall[]) => Promise<Reads>;
  /** Inner calls of a Multicall3 batch, run one by one from Multicall3; index of the first failing required call. */
  innerFailure?: (
    calls: Array<{ target: Address; allowFailure: boolean; callData: Hex }>,
    multicall3: Address,
  ) => Promise<Execution['inner']>;
}

type Request = (args: { method: string; params: unknown[] }) => Promise<any>;

const requester = (client: PublicClient): Request =>
  client.request as unknown as Request;

/* ------------------------------------------------------------------------ */
/* Errors                                                                    */
/* ------------------------------------------------------------------------ */

export interface RpcErrorInfo {
  code?: number;
  message: string;
  data?: Hex;
}

/** Code, message and revert data from a viem / JSON-RPC error chain. */
export const rpcErrorInfo = (error: unknown): RpcErrorInfo => {
  const info: RpcErrorInfo = {
    message: error instanceof Error ? error.message : String(error),
  };
  let current: any = error;
  let detailsSet = false;
  for (let depth = 0; current != null && depth < 10; depth++) {
    // -1 is viem's "unknown": keep looking for the node's own code.
    if (
      info.code === undefined &&
      typeof current.code === 'number' &&
      current.code !== -1
    ) {
      info.code = current.code;
    }
    if (info.data === undefined) {
      const data =
        typeof current.data === 'string'
          ? current.data
          : typeof current.data?.data === 'string'
            ? current.data.data
            : undefined;
      if (data !== undefined && isHex(data)) info.data = data;
    }
    if (!detailsSet && typeof current.details === 'string') {
      info.message = current.details;
      detailsSet = true;
    }
    current = current.cause;
  }
  return info;
};

// Method not found, method not supported, invalid params (an older or partial implementation).
const UNSUPPORTED_CODES = new Set([-32601, -32004, -32602]);
const UNSUPPORTED_MESSAGE =
  /method.*(not (found|supported|available|allowed|whitelisted|exist)|does not exist|unsupported)|unsupported method|unknown method|no such method/i;

/** The node does not offer the method (as opposed to the call failing). */
export const isUnsupported = (error: unknown): boolean => {
  const info = rpcErrorInfo(error);
  return (
    (info.code !== undefined && UNSUPPORTED_CODES.has(info.code)) ||
    UNSUPPORTED_MESSAGE.test(info.message)
  );
};

/** A JSON-RPC error answer (it has a code), as opposed to a transport failure. */
export const isRpcAnswer = (error: unknown): boolean =>
  rpcErrorInfo(error).code !== undefined;

export const simulationFailed = (
  backend: SimulationBackend,
  cause: unknown,
): ObolError =>
  new ObolError(
    'SIMULATION_FAILED',
    `${backend} failed: ${rpcErrorInfo(cause).message}`,
    {
      hint: 'Retry, simulate at the latest block, or use another RPC',
      details: { backend },
      cause,
    },
  );

/* ------------------------------------------------------------------------ */
/* Support detection (once per client)                                       */
/* ------------------------------------------------------------------------ */

const support = new WeakMap<
  object,
  Partial<Record<'eth_simulateV1' | 'debug_traceCall', boolean>>
>();

export const knownSupport = (
  client: PublicClient,
): Partial<Record<'eth_simulateV1' | 'debug_traceCall', boolean>> => {
  let entry = support.get(client);
  if (entry === undefined) {
    entry = {};
    support.set(client, entry);
  }
  return entry;
};

/* ------------------------------------------------------------------------ */
/* Shared encoding                                                           */
/* ------------------------------------------------------------------------ */

const rpcTx = (tx: SimTx): Record<string, string> => ({
  from: tx.from,
  to: tx.to,
  data: tx.data,
  value: toHex(tx.value),
});

const encodeReads = (calls: ReadCall[]): Hex =>
  encodeFunctionData({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [calls.map(c => ({ ...c, allowFailure: true }))],
  });

const decodeReads = (data: Hex | undefined, n: number): Reads['before'] => {
  if (data === undefined || data === '0x') return new Array(n).fill(undefined);
  const results = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    data,
  }) as ReadonlyArray<{ success: boolean; returnData: Hex }>;
  return results.map(r =>
    r.success && r.returnData !== '0x' ? r.returnData : undefined,
  );
};

const topicAddress = (topic: Hex | undefined): Address | undefined =>
  topic === undefined ? undefined : getAddress(`0x${topic.slice(26)}`);

/* ------------------------------------------------------------------------ */
/* eth_simulateV1                                                            */
/* ------------------------------------------------------------------------ */

interface SimulateCallResult {
  status: Hex;
  returnData: Hex;
  gasUsed: Hex;
  logs?: Array<{ address: Address; topics: Hex[]; data: Hex }>;
  error?: { message?: string; code?: number; data?: Hex };
}

const simulateV1 = async (
  request: Request,
  calls: SimTx[],
  block: bigint,
): Promise<SimulateCallResult[]> => {
  const result = await request({
    method: 'eth_simulateV1',
    params: [
      {
        blockStateCalls: [{ calls: calls.map(rpcTx) }],
        traceTransfers: true,
        validation: false,
      },
      toHex(block),
    ],
  });
  const out = (result as Array<{ calls: SimulateCallResult[] }>)?.[0]?.calls;
  if (!Array.isArray(out) || out.length !== calls.length) {
    throw new ObolError(
      'SIMULATION_FAILED',
      'eth_simulateV1 returned an unexpected result',
      {
        hint: 'Use another RPC',
        details: { backend: 'eth_simulateV1' },
      },
    );
  }
  return out;
};

const isTransferLog = (log: { address: string }): boolean =>
  log.address.toLowerCase() === ETH_TRANSFER_LOG_ADDRESS;

const callFailure = (call: SimulateCallResult): Failure => {
  const data =
    call.error?.data !== undefined && isHex(call.error.data)
      ? call.error.data
      : call.returnData !== '0x'
        ? call.returnData
        : undefined;
  return {
    message: call.error?.message ?? 'execution reverted',
    ...(data !== undefined ? { data } : {}),
  };
};

const readTx = (multicall3: Address, calls: ReadCall[]): SimTx => ({
  from: ZERO_ADDRESS,
  to: multicall3,
  data: encodeReads(calls),
  value: 0n,
});

export const simulateV1Backend = (
  client: PublicClient,
  tx: SimTx,
  block: bigint,
  multicall3: Address,
): FullBackend => {
  const request = requester(client);
  return {
    name: 'eth_simulateV1',
    execute: async () => {
      const [call] = await simulateV1(request, [tx], block);
      const success = call.status === '0x1';
      const logs = call.logs ?? [];
      const eth = new Map<string, Address>();
      for (const log of logs.filter(isTransferLog)) {
        for (const topic of [log.topics[1], log.topics[2]]) {
          const address = topicAddress(topic);
          if (address !== undefined) eth.set(address.toLowerCase(), address);
        }
      }
      return {
        success,
        gasUsed: BigInt(call.gasUsed),
        ...(success ? {} : { failure: callFailure(call) }),
        logs: success
          ? logs
              .filter(log => !isTransferLog(log))
              .map(({ address, topics, data }) => ({ address, topics, data }))
          : [],
        ethAddresses: success ? [...eth.values()] : [],
      };
    },
    read: async calls => {
      const read = readTx(multicall3, calls);
      const [before, main, after] = await simulateV1(
        request,
        [read, tx, read],
        block,
      );
      if (main.status !== '0x1') {
        throw new ObolError(
          'SIMULATION_FAILED',
          'The transaction reverted when simulated a second time',
          {
            hint: 'Retry',
            details: { backend: 'eth_simulateV1' },
          },
        );
      }
      return {
        before: decodeReads(
          before.status === '0x1' ? before.returnData : undefined,
          calls.length,
        ),
        after: decodeReads(
          after.status === '0x1' ? after.returnData : undefined,
          calls.length,
        ),
      };
    },
    innerFailure: async (calls, multicall) => {
      const results = await simulateV1(
        request,
        calls.map(c => ({
          from: multicall,
          to: c.target,
          data: c.callData,
          value: 0n,
        })),
        block,
      );
      const index = results.findIndex(
        (r, i) => r.status !== '0x1' && !calls[i].allowFailure,
      );
      if (index < 0) return undefined;
      return {
        index,
        target: calls[index].target,
        failure: callFailure(results[index]),
      };
    },
  };
};

/* ------------------------------------------------------------------------ */
/* debug_traceCall                                                           */
/* ------------------------------------------------------------------------ */

interface Frame {
  type?: string;
  from?: Address;
  to?: Address;
  value?: Hex;
  gasUsed?: Hex;
  input?: Hex;
  output?: Hex;
  error?: string;
  calls?: Frame[];
  logs?: Array<{
    address: Address;
    topics: Hex[];
    data: Hex;
    position?: Hex | number;
  }>;
}

interface AccountState {
  balance?: Hex;
  nonce?: number | Hex;
  code?: Hex;
  storage?: Record<Hex, Hex>;
}

interface PrestateDiff {
  pre: Record<string, AccountState>;
  post: Record<string, AccountState>;
}

/** Logs of the frames that did not revert, in emission order. */
const frameLogs = (frame: Frame): RawLog[] => {
  if (frame.error !== undefined) return [];
  const calls = frame.calls ?? [];
  const logs = frame.logs ?? [];
  const out: RawLog[] = [];
  let next = 0;
  for (let i = 0; i <= calls.length; i++) {
    while (
      next < logs.length &&
      (logs[next].position === undefined
        ? i === calls.length
        : Number(logs[next].position) <= i)
    ) {
      const { address, topics, data } = logs[next];
      out.push({ address, topics, data });
      next++;
    }
    if (i < calls.length) out.push(...frameLogs(calls[i]));
  }
  return out;
};

const frameFailure = (frame: Frame): Failure => ({
  message: frame.error ?? 'execution reverted',
  ...(frame.output !== undefined && frame.output !== '0x'
    ? { data: frame.output }
    : {}),
});

const ZERO_WORD: Hex = `0x${'0'.repeat(64)}`;

/** eth_call state overrides that turn the pre-state into the post-state. */
const postStateOverride = (
  diff: PrestateDiff,
): Record<string, Record<string, unknown>> => {
  const override: Record<string, Record<string, unknown>> = {};
  const addresses = new Set([
    ...Object.keys(diff.pre ?? {}),
    ...Object.keys(diff.post ?? {}),
  ]);
  for (const address of addresses) {
    const pre = diff.pre?.[address] ?? {};
    const post = diff.post?.[address];
    const entry: Record<string, unknown> = {};
    if (post?.balance !== undefined) entry.balance = post.balance;
    if (post?.nonce !== undefined) entry.nonce = toHex(BigInt(post.nonce));
    if (post?.code !== undefined) entry.code = post.code;
    const stateDiff: Record<string, Hex> = {};
    // A slot in pre and not in post was cleared.
    for (const slot of Object.keys(pre.storage ?? {})) {
      stateDiff[slot] = ZERO_WORD;
    }
    Object.assign(stateDiff, post?.storage ?? {});
    if (Object.keys(stateDiff).length > 0) entry.stateDiff = stateDiff;
    if (Object.keys(entry).length > 0) override[address] = entry;
  }
  return override;
};

export const traceBackend = (
  client: PublicClient,
  tx: SimTx,
  block: bigint,
  multicall3: Address,
): FullBackend => {
  const request = requester(client);
  let diff: PrestateDiff | undefined;
  let root: Frame | undefined;
  const trace = async (tracer: string, config: object): Promise<any> =>
    await request({
      method: 'debug_traceCall',
      params: [rpcTx(tx), toHex(block), { tracer, tracerConfig: config }],
    });
  const call = async (
    calls: ReadCall[],
    override?: Record<string, Record<string, unknown>>,
  ): Promise<Hex | undefined> => {
    const params: unknown[] = [rpcTx(readTx(multicall3, calls)), toHex(block)];
    if (override !== undefined) params.push(override);
    try {
      return (await request({ method: 'eth_call', params })) as Hex;
    } catch (cause) {
      if (isRpcAnswer(cause)) return undefined;
      throw cause;
    }
  };
  return {
    name: 'debug_traceCall',
    execute: async () => {
      root = (await trace('callTracer', { withLog: true })) as Frame;
      const success = root.error === undefined;
      if (!success) {
        const index = (root.calls ?? []).findIndex(c => c.error !== undefined);
        const child = index >= 0 ? root.calls?.[index] : undefined;
        return {
          success,
          gasUsed: BigInt(root.gasUsed ?? '0x0'),
          failure: frameFailure(root),
          logs: [],
          ethAddresses: [],
          ...(child?.to !== undefined
            ? {
                inner: {
                  index,
                  target: getAddress(child.to),
                  failure: frameFailure(child),
                },
              }
            : {}),
        };
      }
      diff = (await trace('prestateTracer', {
        diffMode: true,
      })) as PrestateDiff;
      const ethAddresses: Address[] = [];
      for (const address of Object.keys(diff.post ?? {})) {
        const after = diff.post[address]?.balance;
        const before = diff.pre?.[address]?.balance ?? '0x0';
        if (after !== undefined && BigInt(after) !== BigInt(before)) {
          ethAddresses.push(getAddress(address));
        }
      }
      return {
        success,
        gasUsed: BigInt(root.gasUsed ?? '0x0'),
        logs: frameLogs(root),
        ethAddresses,
      };
    },
    read: async calls => {
      const override = diff !== undefined ? postStateOverride(diff) : {};
      const [before, after] = await Promise.all([
        call(calls),
        call(calls, override),
      ]);
      return {
        before: decodeReads(before, calls.length),
        after: decodeReads(after, calls.length),
      };
    },
  };
};

/* ------------------------------------------------------------------------ */
/* eth_call                                                                  */
/* ------------------------------------------------------------------------ */

const EXECUTION_MESSAGE =
  /revert|insufficient funds|out of gas|invalid opcode|stack (under|over)flow|invalid jump/i;

/** The call failed when executed (as opposed to the node failing, e.g. missing state). */
const isExecutionError = (error: unknown): boolean => {
  const info = rpcErrorInfo(error);
  return (
    info.code !== undefined &&
    (info.code === 3 ||
      info.data !== undefined ||
      EXECUTION_MESSAGE.test(info.message))
  );
};

export const callOnly = async (
  client: PublicClient,
  tx: SimTx,
  block: bigint,
): Promise<{ success: boolean; failure?: Failure }> => {
  try {
    await requester(client)({
      method: 'eth_call',
      params: [rpcTx(tx), toHex(block)],
    });
    return { success: true };
  } catch (cause) {
    if (!isExecutionError(cause)) throw simulationFailed('eth_call', cause);
    const info = rpcErrorInfo(cause);
    return {
      success: false,
      failure: {
        message: info.message,
        ...(info.data !== undefined ? { data: info.data } : {}),
      },
    };
  }
};
