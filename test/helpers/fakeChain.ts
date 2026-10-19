/**
 * A fake EIP-1193 chain for v3 unit tests: a viem PublicClient (and optional
 * WalletClient) whose eth_call is answered by per-contract handlers, with
 * Multicall3 aggregate3 / getEthBalance / getBlockNumber decoded and dispatched.
 *
 *   const chain = fakeChain({
 *     contracts: { [ovm]: { abi: ovmAbi, read: { owner: () => owner } } },
 *     balances: { [ovm]: parseEther('40') },
 *   });
 *   const ctx = chain.context();
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { hoodi, mainnet } from 'viem/chains';
import { CHAINS } from '../../src/chains.js';
import type { Context } from '../../src/context.js';
import { ObolApi } from '../../src/api.js';

export const MULTICALL3 = getAddress(
  '0xcA11bde05977b3631167028862bE2a173976CA11',
);

const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
  'function getBlockNumber() view returns (uint256 blockNumber)',
]);

export interface CallInfo {
  from?: Address;
  value: bigint;
  /** The contract being called. */
  to: Address;
}

export interface FakeContract {
  abi: Abi;
  /** Handlers by function name; return the decoded result (array for several outputs). Throw to revert. */
  read?: Record<string, (args: readonly any[], call: CallInfo) => unknown>;
  /** Runtime code; default a non-empty placeholder. */
  code?: Hex;
}

export interface FakeLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash?: Hex;
  logIndex?: number;
}

export interface FakeChainOptions {
  chainId?: number;
  blockNumber?: bigint;
  contracts?: Record<string, FakeContract>;
  /** Raw eth_call handlers by address (e.g. EIP-7002 predeploy with empty data). */
  raw?: Record<string, (data: Hex, call: CallInfo) => Hex>;
  balances?: Record<string, bigint>;
  /** Code for addresses without a FakeContract ('0x' = none). */
  code?: Record<string, Hex>;
  logs?: FakeLog[];
  /** Fail eth_getLogs (e.g. an RPC that refuses wide ranges). */
  getLogsError?: (filter: any) => Error | undefined;
  receipts?: Record<string, unknown>;
  /** Intercept any request first; return undefined to fall through. */
  onRequest?: (method: string, params: any[]) => unknown;
  /** Timestamp returned by eth_getBlockByNumber. */
  blockTimestamp?: bigint;
  walletAccount?: Address;
  walletChainId?: number;
  /** Called with each eth_sendTransaction; return the hash. */
  onSendTransaction?: (tx: any) => Hex;
}

const lower = (a: string): string => a.toLowerCase();

class Revert extends Error {}

export const fakeChain = (options: FakeChainOptions = {}) => {
  const chainId = options.chainId ?? 560048;
  let blockNumber = options.blockNumber ?? 2_000_000n;
  const contracts = new Map<string, FakeContract>();
  for (const [a, c] of Object.entries(options.contracts ?? {})) {
    contracts.set(lower(a), c);
  }
  const raw = new Map<string, (data: Hex, call: CallInfo) => Hex>();
  for (const [a, h] of Object.entries(options.raw ?? {})) raw.set(lower(a), h);
  const balances = new Map<string, bigint>();
  for (const [a, b] of Object.entries(options.balances ?? {})) {
    balances.set(lower(a), b);
  }
  const code = new Map<string, Hex>();
  for (const [a, c] of Object.entries(options.code ?? {}))
    code.set(lower(a), c);
  const logs = [...(options.logs ?? [])];
  const requests: Array<{ method: string; params: any[] }> = [];
  const sent: any[] = [];

  const callOne = (to: Address, data: Hex, call: CallInfo): Hex => {
    const rawHandler = raw.get(lower(to));
    if (rawHandler !== undefined) return rawHandler(data, call);
    if (lower(to) === lower(MULTICALL3)) {
      const { functionName, args } = decodeFunctionData({
        abi: multicallAbi,
        data,
      });
      if (functionName === 'getEthBalance') {
        return encodeFunctionResult({
          abi: multicallAbi,
          functionName,
          result: balances.get(lower(args[0])) ?? 0n,
        });
      }
      if (functionName === 'getBlockNumber') {
        return encodeFunctionResult({
          abi: multicallAbi,
          functionName,
          result: blockNumber,
        });
      }
      const results = (
        args[0] as ReadonlyArray<{
          target: Address;
          allowFailure: boolean;
          callData: Hex;
        }>
      ).map(c => {
        try {
          return {
            success: true,
            returnData: callOne(c.target, c.callData, {
              ...call,
              from: MULTICALL3,
              to: c.target,
            }),
          };
        } catch (e) {
          if (!c.allowFailure) throw e;
          return { success: false, returnData: '0x' as Hex };
        }
      });
      return encodeFunctionResult({
        abi: multicallAbi,
        functionName: 'aggregate3',
        result: results,
      });
    }
    const contract = contracts.get(lower(to));
    if (contract === undefined) {
      // No code: a call to an EOA returns empty data.
      return '0x';
    }
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: contract.abi, data });
    } catch {
      throw new Revert(`unknown selector ${data.slice(0, 10)} on ${to}`);
    }
    const handler = contract.read?.[decoded.functionName];
    if (handler === undefined) {
      throw new Revert(`no handler for ${decoded.functionName} on ${to}`);
    }
    const result = handler(decoded.args ?? [], { ...call, to });
    return encodeFunctionResult({
      abi: contract.abi,
      functionName: decoded.functionName,
      result,
    } as any);
  };

  const matchesTopics = (log: FakeLog, topics: any[] | undefined): boolean => {
    if (topics === undefined) return true;
    return topics.every((t, i) => {
      if (t === null || t === undefined) return true;
      const actual = log.topics[i]?.toLowerCase();
      if (Array.isArray(t)) return t.some(x => lower(x) === actual);
      return lower(t) === actual;
    });
  };

  const request = async ({
    method,
    params = [],
  }: {
    method: string;
    params?: any[];
  }): Promise<unknown> => {
    requests.push({ method, params });
    const intercepted = options.onRequest?.(method, params);
    if (intercepted !== undefined) return intercepted;
    switch (method) {
      case 'eth_chainId':
        return toHex(chainId);
      case 'eth_blockNumber':
        return toHex(blockNumber);
      case 'eth_getBalance':
        return toHex(balances.get(lower(params[0])) ?? 0n);
      case 'eth_getCode': {
        const addr = lower(params[0]);
        if (code.has(addr)) return code.get(addr);
        const c = contracts.get(addr);
        if (c !== undefined) return c.code ?? '0x6080604052';
        if (raw.has(addr) || addr === lower(MULTICALL3)) return '0x6080604052';
        return '0x';
      }
      case 'eth_call': {
        const [tx] = params;
        try {
          return callOne(tx.to, tx.data ?? tx.input ?? '0x', {
            from: tx.from,
            value: tx.value !== undefined ? BigInt(tx.value) : 0n,
            to: tx.to,
          });
        } catch (e) {
          const err: any = new Error(
            `execution reverted: ${(e as Error).message}`,
          );
          err.code = 3;
          err.data = '0x';
          throw err;
        }
      }
      case 'eth_getLogs': {
        const [filter] = params;
        const failure = options.getLogsError?.(filter);
        if (failure !== undefined) throw failure;
        const from =
          filter.fromBlock !== undefined ? BigInt(filter.fromBlock) : 0n;
        const to =
          filter.toBlock !== undefined && filter.toBlock !== 'latest'
            ? BigInt(filter.toBlock)
            : blockNumber;
        const addresses =
          filter.address === undefined
            ? undefined
            : (Array.isArray(filter.address)
                ? filter.address
                : [filter.address]
              ).map(lower);
        return logs
          .filter(
            l =>
              l.blockNumber >= from &&
              l.blockNumber <= to &&
              (addresses === undefined ||
                addresses.includes(lower(l.address))) &&
              matchesTopics(l, filter.topics),
          )
          .map((l, i) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: toHex(l.blockNumber),
            blockHash: `0x${'ab'.repeat(32)}`,
            transactionHash: l.transactionHash ?? `0x${'cd'.repeat(32)}`,
            transactionIndex: '0x0',
            logIndex: toHex(l.logIndex ?? i),
            removed: false,
          }));
      }
      case 'eth_getBlockByNumber': {
        const tag = params[0];
        const n =
          tag === 'latest' || tag === undefined ? blockNumber : BigInt(tag);
        return {
          number: toHex(n),
          hash: `0x${'ab'.repeat(32)}`,
          parentHash: `0x${'00'.repeat(32)}`,
          timestamp: toHex(options.blockTimestamp ?? 1_760_000_000n),
          transactions: [],
          baseFeePerGas: '0x1',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          logsBloom: `0x${'00'.repeat(256)}`,
          miner: `0x${'00'.repeat(20)}`,
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          extraData: '0x',
          size: '0x0',
          stateRoot: `0x${'00'.repeat(32)}`,
          receiptsRoot: `0x${'00'.repeat(32)}`,
          transactionsRoot: `0x${'00'.repeat(32)}`,
          sha3Uncles: `0x${'00'.repeat(32)}`,
          uncles: [],
        };
      }
      case 'eth_getTransactionReceipt':
        return options.receipts?.[lower(params[0])] ?? null;
      case 'eth_sendTransaction': {
        sent.push(params[0]);
        return options.onSendTransaction?.(params[0]) ?? `0x${'ee'.repeat(32)}`;
      }
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return options.walletAccount !== undefined
          ? [options.walletAccount]
          : [];
      default:
        throw new Error(`fakeChain: unsupported method ${method}`);
    }
  };

  const viemChain: Chain = chainId === 1 ? mainnet : hoodi;
  const publicClient = createPublicClient({
    chain: viemChain,
    transport: custom({ request }),
  }) as PublicClient;

  const walletClient: WalletClient | undefined =
    options.walletAccount !== undefined
      ? createWalletClient({
          chain: viemChain,
          account: options.walletAccount,
          transport: custom({
            request: async (args: { method: string; params?: any[] }) => {
              if (args.method === 'eth_chainId') {
                return toHex(options.walletChainId ?? chainId);
              }
              return await request(args);
            },
          }),
        })
      : undefined;

  return {
    publicClient,
    walletClient,
    requests,
    sent,
    logs,
    balances,
    setBlockNumber: (n: bigint) => {
      blockNumber = n;
    },
    /** A v3 Context on this chain; `api` defaults to disabled. */
    context: (api: ObolApi | null = null): Context => ({
      chain: CHAINS[chainId],
      publicClient,
      ...(walletClient !== undefined ? { walletClient } : {}),
      api,
    }),
  };
};

/** A fake ObolApi answering by `METHOD path` (exact) or path prefix. */
export const fakeApi = (
  routes: Record<string, (body?: unknown) => unknown>,
): ObolApi & {
  calls: Array<{ method: string; endpoint: string; body?: unknown }>;
} => {
  const calls: Array<{ method: string; endpoint: string; body?: unknown }> = [];
  const api = new ObolApi({ baseUrl: 'https://api.obol.tech', timeoutMs: 0 });
  (api as any).request = async (endpoint: string, opts: any = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ method, endpoint, body: opts.body });
    const handler = routes[`${method} ${endpoint}`] ?? routes[endpoint];
    if (handler === undefined) {
      throw new Error(`fakeApi: no route for ${method} ${endpoint}`);
    }
    return handler(opts.body);
  };
  return Object.assign(api, { calls });
};

export const encodeWords = (types: string[], values: unknown[]): Hex =>
  encodeAbiParameters(
    types.map(type => ({ type })),
    values,
  );
