/**
 * Turns a simulated execution into balance changes, state changes and
 * summary lines. Pure: the reads it needs are planned here and run by the
 * backend.
 */
import { encodeFunctionData, hexToBigInt, type Address, type Hex } from 'viem';
import {
  DEPOSIT_CONTRACT,
  multicall3Abi,
  NATIVE_TOKEN,
  ovmAbi,
  warehouseAbi,
} from '../abi.js';
import type { ChainContracts } from '../chains.js';
import { checksum, sameAddress, ZERO_ADDRESS } from '../schema.js';
import { roleNames, type OvmRoleName } from '../ovm/routing.js';
import { GWEI } from '../units.js';
import type { SplitParams } from '../types.js';
import { decodeAggregate3, decodeCall } from './decode.js';
import type { ReadCall, Reads, SimTx } from './backends.js';
import type {
  BalanceChange,
  OvmValueName,
  SimulatedEvent,
  StateChange,
} from './types.js';

const NATIVE_TOKEN_ID = BigInt(NATIVE_TOKEN);

/** Events only an OVM emits. */
const OVM_EVENTS = new Set([
  'DistributeFunds',
  'PrincipalStakeAmountUpdated',
  'WithdrawalRequested',
  'ConsolidationRequested',
  'Swept',
  'PullBalanceWithdrawn',
  'BeneficiaryUpdated',
  'RewardRecipientUpdated',
  'UnsentExcessFee',
  'Transferred',
  'RecoverNonOVMFunds',
  'RolesUpdated',
]);

const OVM_WRITES = new Set(
  ovmAbi
    .filter(
      item =>
        item.type === 'function' &&
        (item.stateMutability as string) !== 'view' &&
        (item.stateMutability as string) !== 'pure',
    )
    .map(item => (item as { name: string }).name),
);

const OVM_VALUES: OvmValueName[] = [
  'amountOfPrincipalStake',
  'fundsPendingWithdrawal',
];

const key = (address: string): string => address.toLowerCase();

/** Address book: first label wins. */
export class Labels {
  private readonly map = new Map<string, string>();
  set(address: string | undefined, label: string): void {
    if (address === undefined) return;
    if (!this.map.has(key(address))) this.map.set(key(address), label);
  }

  get(address: string): string | undefined {
    return this.map.get(key(address));
  }
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                                */
/* ------------------------------------------------------------------------ */

export const shortAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

export const shortPubkey = (pubkey: string): string =>
  `${pubkey.slice(0, 10)}…${pubkey.slice(-4)}`;

/** `3.200000 ETH` (6 decimals, rounded half up); amounts below 0.000001 ETH in wei. */
export const formatEth = (wei: bigint): string => {
  const sign = wei < 0n ? '-' : '';
  const abs = wei < 0n ? -wei : wei;
  if (abs > 0n && abs < 1_000_000_000_000n) return `${sign}${abs} wei`;
  const micro = (abs + 500_000_000_000n) / 1_000_000_000_000n;
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, '0');
  return `${sign}${whole}.${fraction} ETH`;
};

/* ------------------------------------------------------------------------ */
/* Read plan                                                                 */
/* ------------------------------------------------------------------------ */

export interface ReadPlan {
  calls: ReadCall[];
  eth: Address[];
  warehouse: Address[];
  values: Array<{ ovm: Address; name: OvmValueName }>;
  roles: Array<{ ovm: Address; user: Address }>;
}

export interface Facts {
  tx: SimTx;
  contracts: ChainContracts;
  events: SimulatedEvent[];
  ethAddresses: Address[];
}

const uniq = (addresses: Address[]): Address[] => {
  const seen = new Map<string, Address>();
  for (const a of addresses) {
    if (!seen.has(key(a))) seen.set(key(a), checksum(a));
  }
  return [...seen.values()];
};

/** Contracts the transaction treats as OVMs: emitters of OVM events, and OVM calls in the request. */
export const ovmCandidates = (facts: Facts): Address[] => {
  const found: Address[] = facts.events
    .filter(e => e.known && OVM_EVENTS.has(e.name))
    .map(e => e.address);
  const direct = decodeCall(ovmAbi, facts.tx.data);
  if (direct !== null && OVM_WRITES.has(direct.functionName)) {
    found.push(facts.tx.to);
  }
  if (sameAddress(facts.tx.to, facts.contracts.multicall3)) {
    for (const call of decodeAggregate3(facts.tx.data) ?? []) {
      const inner = decodeCall(ovmAbi, call.callData);
      if (inner !== null && OVM_WRITES.has(inner.functionName)) {
        found.push(call.target);
      }
    }
  }
  return uniq(found);
};

const isNativeWarehouseTransfer = (
  event: SimulatedEvent,
  warehouse: Address,
): boolean =>
  event.known &&
  event.name === 'Transfer' &&
  sameAddress(event.address, warehouse) &&
  event.args.id === NATIVE_TOKEN_ID;

export const planReads = (facts: Facts): ReadPlan => {
  const { tx, contracts, events } = facts;
  const eth = uniq([tx.from, tx.to, ...facts.ethAddresses]);
  const warehouse = uniq(
    events
      .filter(e => isNativeWarehouseTransfer(e, contracts.warehouse))
      .flatMap(e => [e.args.sender as Address, e.args.receiver as Address])
      .filter(a => !sameAddress(a, ZERO_ADDRESS)),
  );
  const values = ovmCandidates(facts).flatMap(ovm =>
    OVM_VALUES.map(name => ({ ovm, name })),
  );
  const roles: ReadPlan['roles'] = [];
  for (const e of events) {
    if (!e.known || e.name !== 'RolesUpdated') continue;
    const user = e.args.user as Address;
    if (
      !roles.some(
        r => sameAddress(r.ovm, e.address) && sameAddress(r.user, user),
      )
    ) {
      roles.push({ ovm: e.address, user });
    }
  }
  const calls: ReadCall[] = [
    ...eth.map(address => ({
      target: contracts.multicall3,
      callData: encodeFunctionData({
        abi: multicall3Abi,
        functionName: 'getEthBalance',
        args: [address],
      }),
    })),
    ...warehouse.map(address => ({
      target: contracts.warehouse,
      callData: encodeFunctionData({
        abi: warehouseAbi,
        functionName: 'balanceOf',
        args: [address, NATIVE_TOKEN_ID],
      }),
    })),
    ...values.map(({ ovm, name }) => ({
      target: ovm,
      callData: encodeFunctionData({ abi: ovmAbi, functionName: name }),
    })),
    ...roles.map(({ ovm, user }) => ({
      target: ovm,
      callData: encodeFunctionData({
        abi: ovmAbi,
        functionName: 'rolesOf',
        args: [user],
      }),
    })),
  ];
  return { calls, eth, warehouse, values, roles };
};

// getEthBalance, balanceOf, the OVM getters and rolesOf all return one word.
const uint = (data: Hex | undefined): bigint | undefined => {
  if (data === undefined || data.length < 66) return undefined;
  try {
    return hexToBigInt(data.slice(0, 66) as Hex);
  } catch {
    return undefined;
  }
};

export interface ReadValues {
  eth: Array<{ address: Address; before?: bigint; after?: bigint }>;
  warehouse: Array<{ address: Address; before?: bigint; after?: bigint }>;
  values: Array<{
    ovm: Address;
    name: OvmValueName;
    before?: bigint;
    after?: bigint;
  }>;
  roles: Array<{ ovm: Address; user: Address; before?: bigint }>;
}

export const readValues = (plan: ReadPlan, reads: Reads): ReadValues => {
  let i = 0;
  const next = (): { before?: bigint; after?: bigint } => {
    const before = uint(reads.before[i]);
    const after = uint(reads.after[i]);
    i++;
    return {
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    };
  };
  return {
    eth: plan.eth.map(address => ({ address, ...next() })),
    warehouse: plan.warehouse.map(address => ({ address, ...next() })),
    values: plan.values.map(v => ({ ...v, ...next() })),
    roles: plan.roles.map(r => {
      const { before } = next();
      return { ...r, ...(before !== undefined ? { before } : {}) };
    }),
  };
};

/* ------------------------------------------------------------------------ */
/* Balance and state changes                                                 */
/* ------------------------------------------------------------------------ */

/** Sorted: ETH first, the sender first, then by address. */
export const balanceChanges = (
  values: ReadValues,
  labels: Labels,
  from: Address,
): BalanceChange[] => {
  const out: BalanceChange[] = [];
  for (const { address, before, after } of values.eth) {
    if (before === undefined || after === undefined || before === after) {
      continue;
    }
    const label = labels.get(address);
    out.push({
      address,
      asset: 'ETH',
      ...(label !== undefined ? { label } : {}),
      before,
      after,
      delta: after - before,
    });
  }
  for (const { address, before, after } of values.warehouse) {
    const b = before ?? 0n;
    if (after === undefined || b === after) continue;
    out.push({
      address,
      asset: 'WAREHOUSE_ETH',
      label: `warehouse:${address}`,
      before: b,
      after,
      delta: after - b,
    });
  }
  const rank = (b: BalanceChange): string =>
    `${b.asset === 'ETH' ? 0 : 1}${sameAddress(b.address, from) ? 0 : 1}${key(b.address)}`;
  return out.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
};

const littleEndian = (hex: Hex): bigint => {
  const bytes = hex.slice(2).match(/../g) ?? [];
  return BigInt(`0x${bytes.reverse().join('') || '0'}`);
};

const splitParamsOf = (value: unknown): SplitParams => {
  const v = value as {
    recipients: readonly string[];
    allocations: readonly bigint[];
    totalAllocation: bigint;
    distributionIncentive: number;
  };
  return {
    recipients: v.recipients.map(checksum),
    allocations: [...v.allocations],
    totalAllocation: v.totalAllocation,
    distributionIncentive: Number(v.distributionIncentive),
  };
};

/** Requests the transaction sends straight to the EIP-7002 / EIP-7251 predeploys (they emit no events). */
const calldataRequests = (
  tx: SimTx,
  contracts: ChainContracts,
): StateChange[] => {
  const bytes = (tx.data.length - 2) / 2;
  if (sameAddress(tx.to, contracts.withdrawalRequest) && bytes === 56) {
    const amount = hexToBigInt(`0x${tx.data.slice(98)}`) * GWEI;
    return [
      {
        kind: 'withdrawalRequest',
        source: 'calldata',
        via: tx.to,
        pubkey: tx.data.slice(0, 98) as Hex,
        amount,
        fullExit: amount === 0n,
        fee: tx.value,
      },
    ];
  }
  if (sameAddress(tx.to, contracts.consolidationRequest) && bytes === 96) {
    return [
      {
        kind: 'consolidationRequest',
        source: 'calldata',
        via: tx.to,
        sourcePubkey: tx.data.slice(0, 98) as Hex,
        targetPubkey: `0x${tx.data.slice(98)}`,
        fee: tx.value,
      },
    ];
  }
  return [];
};

export type Created = Extract<StateChange, { kind: 'created' }>;

export const createdContracts = (
  events: SimulatedEvent[],
  contracts: ChainContracts,
): Created[] => {
  const out: Created[] = [];
  for (const e of events) {
    if (!e.known) continue;
    if (
      e.name === 'CreateObolValidatorManager' &&
      sameAddress(e.address, contracts.ovmFactory.address)
    ) {
      out.push({
        kind: 'created',
        contract: 'ovm',
        address: e.args.ovm as Address,
        factory: e.address,
        owner: e.args.owner as Address,
        principalRecipient: e.args.beneficiary as Address,
        rewardRecipient: e.args.rewardRecipient as Address,
        principalThreshold: (e.args.principalThreshold as bigint) * GWEI,
      });
    } else if (
      e.name === 'SplitCreated' &&
      sameAddress(e.address, contracts.pullSplitFactory)
    ) {
      out.push({
        kind: 'created',
        contract: 'split',
        address: e.args.split as Address,
        factory: e.address,
        owner: e.args.owner as Address,
        params: splitParamsOf(e.args.splitParams),
      });
    }
  }
  return out;
};

export const stateChanges = (
  facts: Facts,
  values: ReadValues,
): StateChange[] => {
  const { tx, contracts, events } = facts;
  const created = createdContracts(events, contracts);
  const isCreated = (address: string): boolean =>
    created.some(c => sameAddress(c.address, address));
  const out: StateChange[] = [...calldataRequests(tx, contracts), ...created];
  const roles = new Map<
    string,
    { ovm: Address; user: Address; after: bigint }
  >();
  for (const e of events) {
    if (!e.known) continue;
    const a = e.args;
    switch (e.name) {
      case 'WithdrawalRequested': {
        const amount = (a.amount as bigint) * GWEI;
        out.push({
          kind: 'withdrawalRequest',
          source: 'event',
          via: e.address,
          pubkey: a.pubKey as Hex,
          amount,
          fullExit: amount === 0n,
          fee: a.fee as bigint,
        });
        break;
      }
      case 'ConsolidationRequested':
        out.push({
          kind: 'consolidationRequest',
          source: 'event',
          via: e.address,
          sourcePubkey: a.srcPubKey as Hex,
          targetPubkey: a.targetPubKey as Hex,
          fee: a.fee as bigint,
        });
        break;
      case 'DepositEvent':
        if (sameAddress(e.address, DEPOSIT_CONTRACT)) {
          out.push({
            kind: 'deposit',
            pubkey: a.pubkey as Hex,
            withdrawalCredentials: a.withdrawal_credentials as Hex,
            amount: littleEndian(a.amount as Hex) * GWEI,
            index: littleEndian(a.index as Hex),
          });
        }
        break;
      case 'RolesUpdated': {
        const user = a.user as Address;
        roles.set(`${key(e.address)}:${key(user)}`, {
          ovm: e.address,
          user,
          after: a.roles as bigint,
        });
        break;
      }
      case 'OwnershipTransferred':
        if (!isCreated(e.address)) {
          out.push({
            kind: 'ownership',
            address: e.address,
            previousOwner: a.oldOwner as Address,
            newOwner: a.newOwner as Address,
          });
        }
        break;
      case 'OwnershipHandoverRequested':
      case 'OwnershipHandoverCanceled':
        out.push({
          kind: 'ownershipHandover',
          address: e.address,
          pendingOwner: a.pendingOwner as Address,
          action:
            e.name === 'OwnershipHandoverRequested' ? 'requested' : 'canceled',
        });
        break;
      case 'BeneficiaryUpdated':
      case 'RewardRecipientUpdated':
        out.push({
          kind: 'recipient',
          address: e.address,
          recipient: e.name === 'BeneficiaryUpdated' ? 'principal' : 'reward',
          newAddress: (a.newBeneficiary ?? a.newRewardRecipient) as Address,
        });
        break;
      case 'SplitUpdated':
        if (!isCreated(e.address)) {
          out.push({
            kind: 'splitUpdated',
            address: e.address,
            params: splitParamsOf(a._split),
          });
        }
        break;
      case 'SetPaused':
        out.push({
          kind: 'paused',
          address: e.address,
          paused: a.paused as boolean,
        });
        break;
    }
  }
  for (const { ovm, user, after } of roles.values()) {
    const before = values.roles.find(
      r => sameAddress(r.ovm, ovm) && sameAddress(r.user, user),
    )?.before;
    const prior = before ?? 0n;
    out.push({
      kind: 'roles',
      address: ovm,
      user,
      ...(before !== undefined ? { before } : {}),
      after,
      granted: roleNames(after & ~prior),
      revoked: roleNames(prior & ~after),
    });
  }
  for (const v of values.values) {
    if (v.before === undefined || v.after === undefined) continue;
    if (v.before === v.after) continue;
    out.push({
      kind: 'value',
      address: v.ovm,
      name: v.name,
      before: v.before,
      after: v.after,
      delta: v.after - v.before,
    });
  }
  return out;
};

/* ------------------------------------------------------------------------ */
/* Summary                                                                   */
/* ------------------------------------------------------------------------ */

const roleList = (names: OvmRoleName[]): string =>
  `${names.length > 1 ? 'Roles' : 'Role'} ${names.join(', ')}`;

/** Fees of OVM withdraw / consolidate requests and the excess refunded. */
export const requestFees = (
  tx: SimTx,
  changes: StateChange[],
): { paid: bigint; refund: bigint; recipient: Address } | null => {
  const call = decodeCall(ovmAbi, tx.data);
  if (
    call?.functionName !== 'withdraw' &&
    call?.functionName !== 'consolidate'
  ) {
    return null;
  }
  const recipient = checksum(
    call.args[call.functionName === 'withdraw' ? 3 : 2] as string,
  );
  const paid = changes.reduce(
    (sum, c) =>
      (c.kind === 'withdrawalRequest' || c.kind === 'consolidationRequest') &&
      c.source === 'event' &&
      sameAddress(c.via, tx.to)
        ? sum + c.fee
        : sum,
    0n,
  );
  return { paid, refund: tx.value - paid, recipient };
};

export const summarize = (
  facts: Facts,
  balances: BalanceChange[],
  changes: StateChange[],
  labels: Labels,
): string[] => {
  const name = (address: string): string => {
    const label = labels.get(address);
    return label !== undefined
      ? `${shortAddress(address)} (${label})`
      : shortAddress(address);
  };
  const lines: string[] = [];
  for (const c of changes) {
    switch (c.kind) {
      case 'created':
        lines.push(
          c.contract === 'ovm'
            ? `Creates OVM ${shortAddress(c.address)}: owner ${name(c.owner)}, principal recipient ${name(c.principalRecipient as Address)}, reward recipient ${name(c.rewardRecipient as Address)}, principal threshold ${formatEth(c.principalThreshold ?? 0n)}`
            : `Creates split ${shortAddress(c.address)} with ${c.params?.recipients.length ?? 0} recipients (owner ${sameAddress(c.owner, ZERO_ADDRESS) ? 'none, immutable' : name(c.owner)})`,
        );
        break;
      case 'withdrawalRequest':
        lines.push(
          c.fullExit
            ? `Validator ${shortPubkey(c.pubkey)} full exit requested (irreversible), fee ${formatEth(c.fee)}`
            : `Validator ${shortPubkey(c.pubkey)} partial withdrawal of ${formatEth(c.amount)} requested, fee ${formatEth(c.fee)}`,
        );
        break;
      case 'consolidationRequest':
        lines.push(
          `Validator ${shortPubkey(c.sourcePubkey)} consolidation into ${shortPubkey(c.targetPubkey)} requested (irreversible: its stake moves to the target), fee ${formatEth(c.fee)}`,
        );
        break;
      case 'deposit':
        lines.push(
          `Deposit of ${formatEth(c.amount)} to validator ${shortPubkey(c.pubkey)} (credentials ${c.withdrawalCredentials.slice(0, 4)}…${c.withdrawalCredentials.slice(-8)})`,
        );
        break;
      case 'roles':
        if (c.granted.length > 0) {
          lines.push(
            `${roleList(c.granted)} granted to ${name(c.user)} on OVM ${shortAddress(c.address)}`,
          );
        }
        if (c.revoked.length > 0) {
          lines.push(
            `${roleList(c.revoked)} removed from ${name(c.user)} on OVM ${shortAddress(c.address)}`,
          );
        }
        break;
      case 'ownership':
        lines.push(
          sameAddress(c.newOwner, ZERO_ADDRESS)
            ? `Ownership of ${shortAddress(c.address)} renounced by ${name(c.previousOwner)} (irreversible)`
            : `Ownership of ${shortAddress(c.address)} moves from ${name(c.previousOwner)} to ${name(c.newOwner)}`,
        );
        break;
      case 'ownershipHandover':
        lines.push(
          `Ownership handover of ${shortAddress(c.address)} ${c.action} by ${name(c.pendingOwner)}`,
        );
        break;
      case 'recipient':
        lines.push(
          `${c.recipient === 'principal' ? 'Principal' : 'Reward'} recipient of OVM ${shortAddress(c.address)} set to ${name(c.newAddress)}`,
        );
        break;
      case 'splitUpdated':
        lines.push(
          `Split ${shortAddress(c.address)} recipients updated (${c.params.recipients.length} recipients)`,
        );
        break;
      case 'paused':
        lines.push(
          `Split ${shortAddress(c.address)} ${c.paused ? 'paused' : 'unpaused'}`,
        );
        break;
      case 'value':
        lines.push(
          `OVM ${shortAddress(c.address)} ${c.name}: ${formatEth(c.before)} → ${formatEth(c.after)}`,
        );
        break;
    }
  }
  const fees = requestFees(facts.tx, changes);
  if (fees !== null && fees.refund > 0n) {
    const unsent = facts.events.some(
      e => e.known && e.name === 'UnsentExcessFee',
    );
    lines.push(
      unsent
        ? `Excess fee ${formatEth(fees.refund)} could not be sent to ${name(fees.recipient)} and stays in the OVM`
        : `Excess fee ${formatEth(fees.refund)} refunded to ${name(fees.recipient)}`,
    );
  }
  const eth = balances.filter(b => b.asset === 'ETH');
  const ordered = [
    ...eth.filter(b => sameAddress(b.address, facts.tx.from)),
    ...eth
      .filter(b => !sameAddress(b.address, facts.tx.from))
      .sort((a, b) =>
        a.delta === b.delta
          ? key(a.address) < key(b.address)
            ? -1
            : 1
          : a.delta > b.delta
            ? -1
            : 1,
      ),
  ];
  for (const b of ordered) {
    lines.push(
      b.delta > 0n
        ? `${name(b.address)} receives ${formatEth(b.delta)}`
        : `${name(b.address)} pays ${formatEth(-b.delta)}`,
    );
  }
  for (const b of balances.filter(b => b.asset === 'WAREHOUSE_ETH')) {
    lines.push(
      b.delta > 0n
        ? `${name(b.address)} is credited ${formatEth(b.delta)} in the Warehouse (balance ${formatEth(b.after)})`
        : `${name(b.address)} Warehouse balance falls by ${formatEth(-b.delta)} (balance ${formatEth(b.after)})`,
    );
  }
  return lines;
};
