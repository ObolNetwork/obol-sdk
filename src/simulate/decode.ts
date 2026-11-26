/**
 * Event and revert decoding for simulations, from the ABIs in `src/abi.ts`
 * (OVM and its factory, PullSplit factory, split wallet, Warehouse, SplitMain,
 * Multicall3, deposit contracts, Merkle distributor, ERC-20 transfers).
 */
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import {
  batchDepositAbi,
  depositContractAbi,
  erc20TransferEvent,
  multicall3Abi,
  ovmAbi,
  ovmFactoryAbi,
  pullSplitFactoryAbi,
  splitMainAbi,
  splitWalletAbi,
  warehouseAbi,
} from '../abi.js';
import { merkleDistributorAbi } from '../incentives/merkle.js';
import { checksum } from '../schema.js';
import type { RevertReason, SimulatedEvent } from './types.js';

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
}

const ABIS: Abi[] = [
  ovmAbi,
  ovmFactoryAbi,
  pullSplitFactoryAbi,
  splitWalletAbi,
  warehouseAbi,
  splitMainAbi,
  depositContractAbi,
  merkleDistributorAbi,
  multicall3Abi,
  batchDepositAbi,
  [erc20TransferEvent],
];

const EVENT_ABI: Abi = ABIS.flatMap(abi =>
  abi.filter(item => item.type === 'event'),
);
const ERROR_ABI: Abi = ABIS.flatMap(abi =>
  abi.filter(item => item.type === 'error'),
);

/** Synthetic ETH transfer logs of `eth_simulateV1` with `traceTransfers`. */
export const ETH_TRANSFER_LOG_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return checksum(value);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  }
  return value;
};

// EIP-7002 / EIP-7251 system contracts: an anonymous log (LOG0) per queued
// request, `source ‖ pubkey ‖ amount (uint64 BE gwei)` / `source ‖ source
// pubkey ‖ target pubkey`.
const WITHDRAWAL_PREDEPLOY = '0x00000961ef480eb55e80d19ad83579a64c007002';
const CONSOLIDATION_PREDEPLOY = '0x0000bbddc7ce488642fb579f8b00f3a590007251';

const predeployLog = (log: RawLog): SimulatedEvent | null => {
  if (log.topics.length !== 0) return null;
  const at = log.address.toLowerCase();
  const hex = log.data.slice(2);
  const source = checksum(`0x${hex.slice(0, 40)}`);
  if (at === WITHDRAWAL_PREDEPLOY && hex.length === 152) {
    return {
      address: checksum(log.address),
      name: 'WithdrawalRequest',
      args: {
        sourceAddress: source,
        validatorPubkey: `0x${hex.slice(40, 136)}`,
        amountGwei: BigInt(`0x${hex.slice(136)}`),
      },
      known: true,
      trusted: false,
    };
  }
  if (at === CONSOLIDATION_PREDEPLOY && hex.length === 232) {
    return {
      address: checksum(log.address),
      name: 'ConsolidationRequest',
      args: {
        sourceAddress: source,
        sourcePubkey: `0x${hex.slice(40, 136)}`,
        targetPubkey: `0x${hex.slice(136)}`,
      },
      known: true,
      trusted: false,
    };
  }
  return null;
};

/** Decodes a log with the known ABIs; unknown logs keep their topics and data. */
export const decodeLog = (log: RawLog): SimulatedEvent => {
  const address = checksum(log.address);
  const request = predeployLog(log);
  if (request !== null) return request;
  try {
    const { eventName, args } = decodeEventLog({
      abi: EVENT_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
    return {
      address,
      name: eventName ?? 'Unknown',
      args: plain(args ?? {}) as Record<string, unknown>,
      known: true,
      trusted: false,
    };
  } catch {
    return {
      address,
      name: 'Unknown',
      args: { topics: log.topics, data: log.data },
      known: false,
      trusted: false,
    };
  }
};

const formatArg = (value: unknown): string =>
  typeof value === 'bigint' ? value.toString() : String(value);

/** Decodes revert data: custom errors of the known contracts, Error(string), Panic(uint256). */
export const decodeRevert = (
  data: Hex | undefined,
  fallbackMessage = 'execution reverted',
): RevertReason => {
  if (data === undefined || data === '0x' || data.length < 10) {
    return {
      message: fallbackMessage,
      ...(data !== undefined ? { data } : {}),
    };
  }
  try {
    const { errorName, args } = decodeErrorResult({ abi: ERROR_ABI, data });
    const list = args ?? [];
    const message =
      errorName === 'Error' && typeof list[0] === 'string'
        ? list[0]
        : `${errorName}(${list.map(formatArg).join(', ')})`;
    return { message, name: errorName, args: list, data };
  } catch {
    return {
      message: `${fallbackMessage} (unknown error ${data.slice(0, 10)})`,
      data,
    };
  }
};

/** The function a calldata calls on a known contract, or null. */
export const decodeCall = (
  abi: Abi,
  data: Hex,
): { functionName: string; args: readonly unknown[] } | null => {
  try {
    const { functionName, args } = decodeFunctionData({ abi, data });
    return { functionName, args: args ?? [] };
  } catch {
    return null;
  }
};

/** Multicall3 `aggregate3` calls of `data`, or null. */
export const decodeAggregate3 = (
  data: Hex,
): Array<{ target: Address; allowFailure: boolean; callData: Hex }> | null => {
  const call = decodeCall(multicall3Abi, data);
  if (call?.functionName !== 'aggregate3') return null;
  return (
    call.args[0] as ReadonlyArray<{
      target: Address;
      allowFailure: boolean;
      callData: Hex;
    }>
  ).map(c => ({ ...c, target: checksum(c.target) }));
};
