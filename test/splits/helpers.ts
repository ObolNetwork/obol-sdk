/** Local helpers for the splits / setup / incentives tests. */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import {
  createOvmEvent,
  multicall3Abi,
  ovmAbi,
  pullSplitFactoryAbi,
  splitMainAbi,
  splitWalletAbi,
  warehouseAbi,
} from '../../src/abi.js';
import { CHAINS } from '../../src/chains.js';
import { ObolError } from '../../src/errors.js';
import type { SplitParams } from '../../src/types.js';
import { hashSplitParams } from '../../src/splits/shares.js';
import {
  HOODI_OVM_FACTORY_BYTECODE,
  HOODI_SPLIT_V2_FACTORY_BYTECODE,
} from '../bytecodes.js';
import type { FakeContract, FakeLog } from '../helpers/fakeChain.js';

export const HOODI = CHAINS[560048].contracts!;
export const PULL_SPLIT_FACTORY_CODE = HOODI_SPLIT_V2_FACTORY_BYTECODE as Hex;
export const OVM_FACTORY_CODE = HOODI_OVM_FACTORY_BYTECODE as Hex;

export const addr = (n: number): Address =>
  getAddress(`0x${n.toString(16).padStart(40, '0')}`);

export const caught = async (
  p: Promise<unknown> | (() => unknown),
): Promise<ObolError> => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e as ObolError;
  }
  throw new Error('expected a throw');
};

/** Encodes a log of `event` with `args` (indexed and not). */
export const eventLog = (
  address: Address,
  event: AbiEvent,
  args: Record<string, unknown>,
  blockNumber: bigint,
  logIndex = 0,
): FakeLog => {
  const topics = encodeEventTopics({ abi: [event], args } as any) as Hex[];
  const data = encodeAbiParameters(
    event.inputs.filter(i => i.indexed !== true),
    event.inputs
      .filter(i => i.indexed !== true)
      .map(i => args[i.name as string]),
  );
  return { address, topics, data, blockNumber, logIndex };
};

/** The factory log that makes `ovm` pass ovm.verify on Hoodi. */
export const ovmCreatedLog = (ovm: Address): FakeLog =>
  eventLog(
    HOODI.ovmFactory.address,
    createOvmEvent,
    {
      ovm,
      owner: addr(0xee),
      beneficiary: addr(0xe1),
      rewardRecipient: addr(0xe2),
      principalThreshold: 16_000_000_000n,
    },
    HOODI.ovmFactory.deployBlock + 10n,
  );

export interface SplitState {
  params: SplitParams;
  splitHash?: Hex;
  paused?: boolean;
  owner?: Address;
  balance?: bigint;
  warehouseBalance?: bigint;
}

export const splitContract = (s: SplitState): FakeContract => ({
  abi: splitWalletAbi,
  read: {
    splitHash: () => s.splitHash ?? hashSplitParams(s.params),
    paused: () => s.paused ?? false,
    owner: () => s.owner ?? addr(0xaa),
    getSplitBalance: () => [s.balance ?? 0n, s.warehouseBalance ?? 0n],
  },
});

export interface OvmState {
  balance: bigint;
  fundsPendingWithdrawal?: bigint;
  amountOfPrincipalStake: bigint;
  principalThresholdGwei?: bigint;
  principalRecipient: Address;
  rewardRecipient: Address;
}

export const ovmContract = (s: OvmState): FakeContract => ({
  abi: ovmAbi,
  read: {
    fundsPendingWithdrawal: () => s.fundsPendingWithdrawal ?? 0n,
    amountOfPrincipalStake: () => s.amountOfPrincipalStake,
    principalThreshold: () => s.principalThresholdGwei ?? 16_000_000_000n,
    principalRecipient: () => s.principalRecipient,
    rewardRecipient: () => s.rewardRecipient,
    owner: () => addr(0xee),
    version: () => '1.0.0',
  },
});

export const warehouseContract = (
  balances: Record<string, bigint> = {},
  paused: Record<string, boolean> = {},
): FakeContract => {
  const lower = (m: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]));
  const b = lower(balances) as Record<string, bigint>;
  const p = lower(paused) as Record<string, boolean>;
  return {
    abi: warehouseAbi,
    read: {
      balanceOf: ([owner]) => b[String(owner).toLowerCase()] ?? 0n,
      withdrawConfig: ([owner]) => [0, p[String(owner).toLowerCase()] ?? false],
    },
  };
};

export const splitMainContract = (
  balances: Record<string, bigint> = {},
): FakeContract => {
  const b = Object.fromEntries(
    Object.entries(balances).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    abi: splitMainAbi,
    read: { getETHBalance: ([a]) => b[String(a).toLowerCase()] ?? 0n },
  };
};

/** A PullSplit factory answering isDeployed with `predicted` / `exists`. */
export const factoryContract = (
  predict: (
    params: SplitParams,
    owner: Address,
    salt: Hex,
  ) => { address: Address; exists: boolean },
  code: Hex = PULL_SPLIT_FACTORY_CODE,
): FakeContract => ({
  abi: pullSplitFactoryAbi,
  code,
  read: {
    isDeployed: ([params, owner, salt]) => {
      const r = predict(params as SplitParams, owner as Address, salt as Hex);
      return [r.address, r.exists];
    },
  },
});

export interface DecodedCall {
  op: string;
  target: Address;
  allowFailure: boolean;
  owner?: Address;
  distributor?: Address;
}

/** Decodes a distribution aggregate3 into the vector `calls` shape. */
export const decodeDistributionCalls = (
  data: Hex,
  ovm?: Address,
): DecodedCall[] => {
  const { args } = decodeFunctionData({ abi: multicall3Abi, data });
  if (args === undefined) return [];
  const calls = args[0] as ReadonlyArray<{
    target: Address;
    allowFailure: boolean;
    callData: Hex;
  }>;
  return calls.map(c => {
    const target = getAddress(c.target);
    const base = { target, allowFailure: c.allowFailure };
    if (ovm !== undefined && target === getAddress(ovm)) {
      return { op: 'ovm.distributeFunds', ...base };
    }
    if (target === HOODI.warehouse) {
      const d = decodeFunctionData({ abi: warehouseAbi, data: c.callData });
      return { op: 'warehouse.withdraw', ...base, owner: (d.args as any)[0] };
    }
    if (target === HOODI.splitMain) {
      const d = decodeFunctionData({ abi: splitMainAbi, data: c.callData });
      return { op: 'splitMain.withdraw', ...base, owner: (d.args as any)[0] };
    }
    const d = decodeFunctionData({ abi: splitWalletAbi, data: c.callData });
    return { op: 'split.distribute', ...base, distributor: (d.args as any)[2] };
  });
};

/** JSON-comparable form: bigints as decimal strings, hex strings lowercase. */
export const norm = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'string' && v.startsWith('0x')) return v.toLowerCase();
      return v;
    }),
  );
