/**
 * Compares a simulation with the operation's own `preview`, where the two say
 * the same thing (distribution amounts per recipient, request fees and
 * refunds, principal stake changes, created addresses, role bits).
 */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- previews are
   recognised by shape (`Obj`); their values are only compared, never used */
import type { Address, Hex } from 'viem';
import type { ChainContracts } from '../chains.js';
import { DEPOSIT_CONTRACT, ovmAbi } from '../abi.js';
import { sameAddress } from '../schema.js';
import type { AnyPrepared, Prepared } from '../types.js';
import { decodeCall } from './decode.js';
import { requestFees, type ReadValues } from './analyze.js';
import type { SimTx } from './backends.js';
import type {
  OvmValueName,
  PreviewComparison,
  SimulatedEvent,
  StateChange,
} from './types.js';

/** UTF-16 code-unit order, as the default `sort()`; lowercased hex addresses. */
const byCodeUnit = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

export interface CompareInput {
  tx: SimTx;
  contracts: ChainContracts;
  events: SimulatedEvent[];
  changes: StateChange[];
  values: ReadValues;
}

type Obj = Record<string, any>;

const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const lower = (v: unknown): string => String(v).toLowerCase();

class Comparer {
  readonly compared: string[] = [];
  readonly differences: string[] = [];

  constructor(private readonly input: CompareInput) {}

  check(what: string, preview: unknown, simulated: unknown): void {
    this.compared.push(what);
    const same =
      typeof preview === 'string' && typeof simulated === 'string'
        ? lower(preview) === lower(simulated)
        : preview === simulated;
    if (!same) {
      this.differences.push(
        `${what}: preview ${String(preview)}, simulation ${String(simulated)}`,
      );
    }
  }

  ethDelta(address: string): bigint | undefined {
    const entry = this.input.values.eth.find(e =>
      sameAddress(e.address, address),
    );
    if (entry === undefined) return 0n; // not touched
    if (entry.before === undefined || entry.after === undefined) {
      return undefined;
    }
    return entry.after - entry.before;
  }

  valueDelta(ovm: string, name: OvmValueName): bigint | undefined {
    const v = this.input.values.values.find(
      x => sameAddress(x.ovm, ovm) && x.name === name,
    );
    if (v?.before === undefined || v.after === undefined) return undefined;
    return v.after - v.before;
  }

  value(
    ovm: string,
    name: OvmValueName,
  ): { before?: bigint; after?: bigint } | undefined {
    return this.input.values.values.find(
      x => sameAddress(x.ovm, ovm) && x.name === name,
    );
  }

  events(name: string, address?: string): SimulatedEvent[] {
    return this.input.events.filter(
      e =>
        e.known &&
        e.name === name &&
        (address === undefined || sameAddress(e.address, address)),
    );
  }

  /** Warehouse native-token credits from `from` to `to`. */
  warehouseCredit(from: string, to: string): bigint {
    return this.events('Transfer', this.input.contracts.warehouse)
      .filter(
        e =>
          sameAddress(e.args.sender as string, from) &&
          sameAddress(e.args.receiver as string, to),
      )
      .reduce((sum, e) => sum + (e.args.amount as bigint), 0n);
  }

  result(): PreviewComparison {
    return {
      ok: this.differences.length === 0,
      differences: this.differences,
      compared: this.compared,
    };
  }
}

const payouts = (c: Comparer, ovm: string, p: Obj, label: string): void => {
  const events = c.events('DistributeFunds', ovm);
  if (events.length !== 1) {
    c.check(`${label} DistributeFunds events`, 1, events.length);
    return;
  }
  c.check(
    `${label} principal payout`,
    p.principalPayout,
    events[0].args.principalPayout,
  );
  c.check(
    `${label} reward payout`,
    p.rewardPayout,
    events[0].args.rewardPayout,
  );
};

/** ovm.prepareDistribute */
const distribute = (c: Comparer, tx: SimTx, p: Obj): void => {
  payouts(c, tx.to, p, 'OVM');
  const stake = c.valueDelta(tx.to, 'amountOfPrincipalStake');
  if (stake !== undefined) {
    c.check('amountOfPrincipalStake change', -p.principalPayout, stake);
  }
  if (p.mode === 'pull') {
    const pending = c.valueDelta(tx.to, 'fundsPendingWithdrawal');
    c.check(
      'fundsPendingWithdrawal change',
      p.principalPayout + p.rewardPayout,
      pending,
    );
    return;
  }
  const expected = new Map<string, bigint>();
  const add = (a: string, v: bigint): void => {
    expected.set(lower(a), (expected.get(lower(a)) ?? 0n) + v);
  };
  add(p.principalRecipient, p.principalPayout);
  add(p.rewardRecipient, p.rewardPayout);
  for (const [address, amount] of expected) {
    c.check(`ETH to ${address}`, amount, c.ethDelta(address));
  }
};

const withoutDust = (amount: bigint): bigint =>
  amount > 0n ? amount - 1n : 0n;

/**
 * ETH a distribution sends to a recipient's wallet: its direct OVM payout,
 * plus each included withdrawal leg (Warehouse: what was waiting there and
 * this distribution's credits; SplitMain v1), less the 1 wei each leaves.
 */
const walletAmount = (r: Obj, minWithdraw: bigint, paused: boolean): bigint => {
  let amount = r.fromOvm as bigint;
  if (r.withdraw !== true || r.skipReason !== undefined) return amount;
  const warehouse = withoutDust(
    (r.warehouseBalance as bigint) +
      (r.fromRewardSplit as bigint) +
      (r.fromPrincipalSplit as bigint) +
      (r.distributorReward as bigint),
  );
  const splitMain = withoutDust(r.splitMainBalance as bigint);
  if (!paused && warehouse >= minWithdraw) amount += warehouse;
  if (splitMain >= minWithdraw) amount += splitMain;
  return amount;
};

/** splits.prepareDistribution */
const distribution = (
  c: Comparer,
  p: Obj,
  prepared: Prepared<'distribution'>,
): void => {
  const paused = (address: string): boolean =>
    prepared.checks.some(
      f =>
        f.code === 'RECIPIENT_WITHDRAW_PAUSED' &&
        f.subject !== undefined &&
        'address' in f.subject &&
        sameAddress(f.subject.address, address),
    );
  if (isObj(p.ovm) && p.ovm.skipReason === undefined) {
    payouts(c, p.ovm.address, p.ovm, 'OVM');
  }
  const splits: Record<
    string,
    { address: string; reward: bigint; distributor?: string }
  > = {};
  for (const split of p.splits as Obj[]) {
    const events = c.events('SplitDistributed', split.address);
    splits[split.kind] = {
      address: split.address,
      reward: split.distributorReward,
      ...(events.length === 1
        ? { distributor: events[0].args.distributor as string }
        : {}),
    };
    if (split.skipReason !== undefined) {
      c.check(
        `${split.kind} split ${split.address} distributions`,
        0,
        events.length,
      );
      continue;
    }
    c.check(
      `${split.kind} split ${split.address} distributed amount`,
      split.distributable,
      events.length === 1 ? events[0].args.amount : `${events.length} events`,
    );
  }
  for (const r of p.recipients as Obj[]) {
    for (const kind of ['reward', 'principal'] as const) {
      const split = splits[kind];
      if (split === undefined) continue;
      // The distributor's incentive is credited by the split too.
      const incentive =
        split.distributor !== undefined &&
        sameAddress(split.distributor, r.address)
          ? split.reward
          : 0n;
      c.check(
        `${r.address} credit from the ${kind} split`,
        (kind === 'reward' ? r.fromRewardSplit : r.fromPrincipalSplit) +
          incentive,
        c.warehouseCredit(split.address, r.address),
      );
    }
    if (r.distributorReward !== undefined) {
      const earned = Object.values(splits).reduce(
        (sum, split) =>
          split.distributor !== undefined &&
          sameAddress(split.distributor, r.address)
            ? sum + split.reward
            : sum,
        0n,
      );
      c.check(`${r.address} distributor reward`, r.distributorReward, earned);
    }
    c.check(
      `ETH to ${r.address}`,
      walletAmount(r, p.minWithdraw as bigint, paused(r.address as string)),
      c.ethDelta(r.address),
    );
  }
};

/** ovm.prepareWithdraw / ovm.prepareConsolidate */
const requests = (
  c: Comparer,
  input: CompareInput,
  p: Obj,
  fn: 'withdraw' | 'consolidate',
): void => {
  const { tx, changes, contracts } = input;
  const kind = fn === 'withdraw' ? 'withdrawalRequest' : 'consolidationRequest';
  const made = changes.filter(
    (x): x is Extract<StateChange, { kind: typeof kind }> =>
      x.kind === kind && x.source === 'event' && sameAddress(x.via, tx.to),
  );
  const expected: Array<[string, string]> =
    fn === 'withdraw'
      ? (p.requests as Obj[]).map((r): [string, string] => [
          lower(r.pubkey),
          String(r.amount),
        ])
      : (p.requests as Obj[]).flatMap(r =>
          (r.sources as string[]).map((s): [string, string] => [
            lower(s),
            lower(r.target),
          ]),
        );
  const actual: Array<[string, string]> = made.map(x =>
    x.kind === 'withdrawalRequest'
      ? [lower(x.pubkey), String(x.amount)]
      : x.kind === 'consolidationRequest'
        ? [lower(x.sourcePubkey), lower(x.targetPubkey)]
        : ['', ''],
  );
  c.check(`${fn} requests`, expected.length, actual.length);
  expected.forEach(([a, b], i) => {
    if (actual[i] === undefined) return;
    c.check(
      `${fn} request ${i}`,
      `${a} ${b}`,
      `${actual[i][0]} ${actual[i][1]}`,
    );
  });
  c.check('value sent', p.totalFee, tx.value);
  const fees = requestFees(tx, changes);
  if (fees === null) return;
  const overMax = made.filter(x => x.fee > p.maxFeePerRequest).length;
  c.check('requests above maxFeePerRequest', 0, overMax);
  const predeploy =
    fn === 'withdraw'
      ? contracts.withdrawalRequest
      : contracts.consolidationRequest;
  c.check('fees paid to the predeploy', fees.paid, c.ethDelta(predeploy));
  const unsent = c.events('UnsentExcessFee', tx.to).length > 0;
  const refundExpected = unsent ? 0n : fees.refund;
  const recipientDelta = c.ethDelta(fees.recipient);
  c.check(
    `excess fee refund to ${fees.recipient}`,
    sameAddress(fees.recipient, tx.from)
      ? refundExpected - tx.value
      : refundExpected,
    recipientDelta,
  );
};

/** deposits.prepareDeposit */
const deposit = (c: Comparer, input: CompareInput, p: Obj): void => {
  const { tx, changes } = input;
  const deposits = changes.filter(
    (x): x is Extract<StateChange, { kind: 'deposit' }> => x.kind === 'deposit',
  );
  c.check('deposits', (p.pubkeys as Hex[]).length, deposits.length);
  (p.pubkeys as Hex[]).forEach((pubkey, i) => {
    if (deposits[i] !== undefined) {
      c.check(`deposit ${i} pubkey`, pubkey, deposits[i].pubkey);
    }
  });
  c.check(
    'deposited total',
    p.total,
    deposits.reduce((sum, d) => sum + d.amount, 0n),
  );
  c.check('deposit contract ETH change', p.total, c.ethDelta(DEPOSIT_CONTRACT));
  if (decodeCall(ovmAbi, tx.data)?.functionName === 'deposit') {
    c.check(
      'amountOfPrincipalStake change',
      p.total,
      c.valueDelta(tx.to, 'amountOfPrincipalStake'),
    );
  }
};

const ovmWrite = (c: Comparer, input: CompareInput, p: Obj): void => {
  const { tx, changes } = input;
  const args = p.args as readonly unknown[];
  const fn = p.function as string;
  const rolesOf = (
    user: string,
  ): Extract<StateChange, { kind: 'roles' }> | undefined =>
    changes.find(
      (x): x is Extract<StateChange, { kind: 'roles' }> =>
        x.kind === 'roles' &&
        sameAddress(x.address, tx.to) &&
        sameAddress(x.user, user),
    );
  switch (fn) {
    case 'grantRoles':
    case 'revokeRoles':
    case 'renounceRoles': {
      const user = (fn === 'renounceRoles' ? tx.from : args[0]) as string;
      const bits = BigInt(
        (fn === 'renounceRoles' ? args[0] : args[1]) as bigint,
      );
      const change = rolesOf(user);
      if (change === undefined) {
        c.check(`${fn} RolesUpdated for ${user}`, 'emitted', 'none');
        return;
      }
      const prior = change.before ?? 0n;
      c.check(
        `roles of ${user} after ${fn}`,
        fn === 'grantRoles' ? prior | bits : prior & ~bits,
        change.after,
      );
      return;
    }
    case 'setAmountOfPrincipalStake': {
      const v = c.value(tx.to, 'amountOfPrincipalStake');
      c.check('amountOfPrincipalStake before', p.current, v?.before);
      c.check('amountOfPrincipalStake after', p.next, v?.after);
      return;
    }
    case 'withdrawPullBalance':
      c.check(
        `ETH to ${String(args[0])}`,
        p.amount,
        c.ethDelta(args[0] as string),
      );
      return;
    case 'setBeneficiary':
    case 'setRewardRecipient':
    case 'transfer': {
      const kind = fn === 'setRewardRecipient' ? 'reward' : 'principal';
      const change = changes.find(
        x =>
          x.kind === 'recipient' &&
          x.recipient === kind &&
          sameAddress(x.address, tx.to),
      );
      c.check(
        `${kind} recipient`,
        args[0],
        change?.kind === 'recipient' ? change.newAddress : 'unchanged',
      );
      if (fn === 'transfer') {
        const owner = changes.find(
          x => x.kind === 'ownership' && sameAddress(x.address, tx.to),
        );
        c.check(
          'new owner',
          args[1],
          owner?.kind === 'ownership' ? owner.newOwner : 'unchanged',
        );
      }
      return;
    }
    case 'completeOwnershipHandover': {
      const owner = changes.find(
        x => x.kind === 'ownership' && sameAddress(x.address, tx.to),
      );
      c.check(
        'new owner',
        args[0],
        owner?.kind === 'ownership' ? owner.newOwner : 'unchanged',
      );
      return;
    }
    case 'sweep': {
      const swept = c.events('Swept', tx.to);
      c.check('Swept events', 1, swept.length);
      if (swept.length === 1 && (args[1] as bigint) > 0n) {
        c.check('swept amount', args[1], swept[0].args.amount);
      }
    }
  }
};

/** setup.prepareOvmWithSplits / prepareCreateOvm / prepareCreateSplit */
const creates = (c: Comparer, input: CompareInput, p: Obj): void => {
  const created = input.changes.filter(
    (x): x is Extract<StateChange, { kind: 'created' }> => x.kind === 'created',
  );
  const ovms = created.filter(x => x.contract === 'ovm');
  const splits = created.filter(x => x.contract === 'split');
  if (isObj(p.rewardRecipient) && isObj(p.principalRecipient)) {
    c.check('OVMs created', 1, ovms.length);
    if (ovms.length === 1) {
      c.check(
        'OVM principal recipient',
        p.principalRecipient.address,
        ovms[0].principalRecipient,
      );
      c.check(
        'OVM reward recipient',
        p.rewardRecipient.address,
        ovms[0].rewardRecipient,
      );
    }
    const expected = new Set<string>();
    for (const side of [p.rewardRecipient, p.principalRecipient]) {
      if (side.created === true) expected.add(lower(side.address));
    }
    c.check(
      'splits created',
      [...expected].sort(byCodeUnit).join(','),
      splits
        .map(s => lower(s.address))
        .sort(byCodeUnit)
        .join(','),
    );
    return;
  }
  if (typeof p.factory === 'string') {
    c.check(
      'OVMs created',
      1,
      ovms.filter(o => sameAddress(o.factory, p.factory)).length,
    );
    return;
  }
  if (typeof p.address === 'string' && isObj(p.params)) {
    c.check(
      'split created',
      p.address,
      splits.length === 1 ? splits[0].address : `${splits.length} splits`,
    );
  }
};

/** Comparison of a simulation with `prepared.preview`, by the prepared kind. */
export const comparePreview = (
  prepared: AnyPrepared,
  input: CompareInput,
): PreviewComparison => {
  const c = new Comparer(input);
  const p = prepared.preview as unknown;
  const { tx } = input;
  if (!isObj(p)) return c.result();
  switch (prepared.kind) {
    case 'distribute':
      distribute(c, tx, p);
      break;
    case 'distribution':
      distribution(c, p, prepared);
      break;
    case 'withdraw':
    case 'consolidate':
      requests(c, input, p, prepared.kind);
      break;
    case 'deposit':
      deposit(c, input, p);
      break;
    case 'eoaWithdraw': {
      const request = input.changes.find(x => x.kind === 'withdrawalRequest');
      c.check(
        'withdrawal request',
        `${lower(p.pubkey)} ${String(p.amount)}`,
        request?.kind === 'withdrawalRequest'
          ? `${lower(request.pubkey)} ${String(request.amount)}`
          : 'none',
      );
      c.check('fee paid to the predeploy', p.fee, c.ethDelta(tx.to));
      break;
    }
    case 'claim': {
      const claimed = c.events('Claimed', p.contractAddress as Address);
      c.check(
        'claimed amount',
        p.amount,
        claimed.length === 1
          ? claimed[0].args.amount
          : `${claimed.length} Claimed events`,
      );
      break;
    }
    case 'createOvm':
    case 'createSplit':
    case 'ovmWithSplits':
      creates(c, input, p);
      break;
    default:
      ovmWrite(c, input, p);
  }
  return c.result();
};
