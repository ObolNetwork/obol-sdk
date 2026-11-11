/**
 * A fake ObolValidatorManager on fakeChain for the ovm, deposit and
 * withdrawal tests: state, roles, provenance (factory log) and the request
 * fee predeploys.
 */
import {
  encodeEventTopics,
  getAddress,
  pad,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { createOvmEvent, ovmAbi, rolesUpdatedEvent } from '../../src/abi.js';
import { CHAINS } from '../../src/chains.js';
import {
  encodeWords,
  fakeChain,
  type FakeChainOptions,
  type FakeContract,
  type FakeLog,
} from '../helpers/fakeChain.js';

export const ETH = 10n ** 18n;
export const GWEI = 10n ** 9n;

/** The vector deposits (deposit_checks.json) point at this address. */
export const OVM = getAddress('0x86b8145c98e5bd25ba722645b15ed65f024a87ec');
export const OWNER = getAddress('0x1000000000000000000000000000000000000001');
export const PRINCIPAL = getAddress(
  '0x2000000000000000000000000000000000000002',
);
export const REWARD = getAddress('0x3000000000000000000000000000000000000003');
export const OTHER = getAddress('0x4000000000000000000000000000000000000004');
export const HOLDER = getAddress('0x5000000000000000000000000000000000000005');

export const PUBKEY_A = `0x${'a1'.repeat(48)}` as Hex;
export const PUBKEY_B = `0x${'b2'.repeat(48)}` as Hex;
export const PUBKEY_C = `0x${'c3'.repeat(48)}` as Hex;

export const credentials = (
  prefix: '00' | '01' | '02',
  address: Address,
): Hex =>
  `0x${prefix}${'00'.repeat(11)}${address.slice(2).toLowerCase()}` as Hex;

export interface OvmFakeState {
  owner: Address;
  principalRecipient: Address;
  rewardRecipient: Address;
  amountOfPrincipalStake: bigint;
  fundsPendingWithdrawal: bigint;
  principalThresholdGwei: bigint;
  version: string | null;
  roles: Record<string, bigint>;
  pull: Record<string, bigint>;
  handoverExpiresAt: Record<string, bigint>;
  /** Getters that revert. */
  failing: string[];
}

export const defaultState = (): OvmFakeState => ({
  owner: OWNER,
  principalRecipient: PRINCIPAL,
  rewardRecipient: REWARD,
  amountOfPrincipalStake: 32n * ETH,
  fundsPendingWithdrawal: 0n,
  principalThresholdGwei: 16n * GWEI,
  version: '1.0.0',
  roles: {},
  pull: {},
  handoverExpiresAt: {},
  failing: [],
});

const lookup = (map: Record<string, bigint>, key: string): bigint =>
  Object.entries(map).find(
    ([k]) => k.toLowerCase() === key.toLowerCase(),
  )?.[1] ?? 0n;

export const ovmContract = (state: OvmFakeState): FakeContract => {
  const guard =
    <T>(name: string, fn: (args: readonly any[]) => T) =>
    (args: readonly any[]): T => {
      if (state.failing.includes(name)) throw new Error(`${name} reverts`);
      return fn(args);
    };
  return {
    abi: ovmAbi,
    read: {
      owner: guard('owner', () => state.owner),
      principalRecipient: guard(
        'principalRecipient',
        () => state.principalRecipient,
      ),
      rewardRecipient: guard('rewardRecipient', () => state.rewardRecipient),
      amountOfPrincipalStake: guard(
        'amountOfPrincipalStake',
        () => state.amountOfPrincipalStake,
      ),
      fundsPendingWithdrawal: guard(
        'fundsPendingWithdrawal',
        () => state.fundsPendingWithdrawal,
      ),
      principalThreshold: guard(
        'principalThreshold',
        () => state.principalThresholdGwei,
      ),
      version: guard('version', () => {
        if (state.version === null) throw new Error('no version');
        return state.version;
      }),
      rolesOf: guard('rolesOf', args => lookup(state.roles, args[0])),
      getPullBalance: guard('getPullBalance', args =>
        lookup(state.pull, args[0]),
      ),
      ownershipHandoverExpiresAt: guard('ownershipHandoverExpiresAt', args =>
        lookup(state.handoverExpiresAt, args[0]),
      ),
    },
  };
};

export const creationLog = (ovm: Address, chainId = 560048): FakeLog => {
  const factory = CHAINS[chainId].contracts!.ovmFactory;
  return {
    address: factory.address,
    topics: encodeEventTopics({
      abi: [createOvmEvent],
      eventName: 'CreateObolValidatorManager',
      args: { ovm, owner: OWNER },
    }) as Hex[],
    data: '0x',
    blockNumber: factory.deployBlock + 10n,
    transactionHash: `0x${'12'.repeat(32)}`,
  };
};

export const rolesLog = (
  ovm: Address,
  user: Address,
  roles: bigint,
  blockNumber: bigint,
): FakeLog => ({
  address: ovm,
  topics: encodeEventTopics({
    abi: [rolesUpdatedEvent],
    eventName: 'RolesUpdated',
    args: { user, roles },
  }) as Hex[],
  data: '0x',
  blockNumber,
});

export const WITHDRAWAL_PREDEPLOY =
  '0x00000961Ef480Eb55e80D19ad83579A64c007002';
export const CONSOLIDATION_PREDEPLOY =
  '0x0000BBdDc7CE488642fb579F8B00f3a590007251';

export const feeHandler = (fee: bigint) => (): Hex =>
  encodeWords(['uint256'], [fee]);

export interface OvmChainOptions extends FakeChainOptions {
  state?: Partial<OvmFakeState>;
  ovmBalance?: bigint;
  provenance?: 'obol' | 'notObol' | 'unknown';
  withdrawalFee?: bigint;
  consolidationFee?: bigint;
  blockTimestamp?: bigint;
}

/** A Hoodi fakeChain with the OVM at OVM (provenance obol unless told otherwise). */
export const ovmChain = (options: OvmChainOptions = {}) => {
  const state: OvmFakeState = { ...defaultState(), ...options.state };
  const chainId = options.chainId ?? 560048;
  const factory = CHAINS[chainId].contracts!.ovmFactory.address;
  const provenance = options.provenance ?? 'obol';
  const chain = fakeChain({
    ...options,
    chainId,
    contracts: { [OVM]: ovmContract(state), ...options.contracts },
    balances: { [OVM]: options.ovmBalance ?? 0n, ...options.balances },
    raw: {
      [WITHDRAWAL_PREDEPLOY]: feeHandler(options.withdrawalFee ?? 1n),
      [CONSOLIDATION_PREDEPLOY]: feeHandler(options.consolidationFee ?? 1n),
      ...options.raw,
    },
    logs: [
      ...(provenance === 'obol' ? [creationLog(OVM, chainId)] : []),
      ...(options.logs ?? []),
    ],
    getLogsError: filter => {
      if (
        provenance === 'unknown' &&
        String(filter.address).toLowerCase() === factory.toLowerCase()
      ) {
        return new Error('internal error');
      }
      return options.getLogsError?.(filter);
    },
    onRequest: (method, params) => {
      const intercepted = options.onRequest?.(method, params);
      if (intercepted !== undefined) return intercepted;
      if (method === 'eth_getBlockByNumber') {
        return {
          number: params[0],
          hash: pad('0x01', { size: 32 }),
          parentHash: pad('0x00', { size: 32 }),
          timestamp: toHex(options.blockTimestamp ?? 1_700_000_000n),
          transactions: [],
        };
      }
      return undefined;
    },
  });
  return { ...chain, state };
};

export const caught = async (promise: Promise<unknown>): Promise<any> => {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
};

export const BEACON_URL = 'http://beacon.local:5052';

/**
 * Hoodi's genesis validators root, as its beacon nodes report it at
 * `/eth/v1/beacon/genesis` (written out here, not read from the SDK's chain
 * table, so a wrong table entry fails the tests).
 */
export const HOODI_GENESIS_VALIDATORS_ROOT =
  '0x212f13fc4df078b6cb7db228f1c8307566dcecf900867401a92023d7ba99cb5f';
/** Mainnet's, likewise. */
export const MAINNET_GENESIS_VALIDATORS_ROOT =
  '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95';

/** What the mocked node says about itself; default a synced Hoodi node. */
export interface MockBeaconNode {
  genesisValidatorsRoot?: string;
  /** The `data` of `/eth/v1/node/syncing`. */
  syncing?: Record<string, unknown>;
  /** Top-level `execution_optimistic` on state reads. */
  executionOptimistic?: boolean;
}

/** Replaces global fetch with a beacon node serving these rows; returns the restore function. */
export const mockBeacon = (
  pending: Array<{ pubkey: Hex; withdrawal_credentials: Hex; amount: string }>,
  validators: unknown[],
  partials: Array<{
    validator_index: string;
    amount: string;
    withdrawable_epoch?: string;
  }> = [],
  node: MockBeaconNode = {},
): (() => void) => {
  const real = global.fetch;
  const bodyFor = (url: string): unknown => {
    if (url.endsWith('/eth/v1/beacon/genesis')) {
      return {
        data: {
          genesis_time: '1742213400',
          genesis_validators_root:
            node.genesisValidatorsRoot ?? HOODI_GENESIS_VALIDATORS_ROOT,
          genesis_fork_version: '0x10000910',
        },
      };
    }
    if (url.endsWith('/eth/v1/node/syncing')) {
      return {
        data: node.syncing ?? {
          head_slot: '1000',
          sync_distance: '0',
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
        },
      };
    }
    const state = {
      execution_optimistic: node.executionOptimistic ?? false,
      finalized: false,
    };
    if (url.endsWith('/pending_deposits')) return { ...state, data: pending };
    if (url.endsWith('/pending_partial_withdrawals')) {
      return { ...state, data: partials };
    }
    return { ...state, data: validators };
  };
  global.fetch = (async (url: unknown) =>
    await Promise.resolve(
      new Response(JSON.stringify(bodyFor(String(url))), {
        status: 200,
      }),
    )) as unknown as typeof fetch;
  return () => {
    global.fetch = real;
  };
};

export const FAR_FUTURE = (2n ** 64n - 1n).toString();

export const registryRow = (
  pubkey: Hex,
  status: string,
  withdrawalCredentials: Hex,
  balanceWei = 32n * ETH,
  extra: {
    index?: string;
    activationEpoch?: string;
    exitEpoch?: string;
    effectiveBalanceWei?: bigint;
  } = {},
) => ({
  index: extra.index ?? '42',
  balance: (balanceWei / GWEI).toString(),
  status,
  validator: {
    pubkey,
    withdrawal_credentials: withdrawalCredentials,
    effective_balance: (
      (extra.effectiveBalanceWei ?? 32n * ETH) / GWEI
    ).toString(),
    activation_epoch: extra.activationEpoch ?? '0',
    exit_epoch:
      extra.exitEpoch ??
      (/^(active_exiting|exited|withdrawal)/.test(status) ? '100' : FAR_FUTURE),
  },
});
