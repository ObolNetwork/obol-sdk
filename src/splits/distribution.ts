/**
 * splits.prepareDistribution / previewDistribution / distributionFromReceipt:
 * distribute an OVM, the splits behind it, and withdraw recipients' Warehouse
 * and SplitMain balances in one Multicall3 transaction. Vectors
 * `distribution.json` (`routing`, `split_distribution`, `prepare`).
 */
import { Type } from '@sinclair/typebox';
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import {
  multicall3Abi,
  NATIVE_TOKEN,
  ovmAbi,
  splitMainAbi,
  splitWalletAbi,
  warehouseAbi,
} from '../abi.js';
import { finding, prepared } from '../chainUtils.js';
import { requireContracts, senderOf, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { ovmRouting, thresholdGweiToWei } from '../ovm/routing.js';
import { requireObolOvm } from '../ovm/verify.js';
import {
  checksum,
  decode,
  invalid,
  sameAddress,
  T,
  ZERO_ADDRESS,
} from '../schema.js';
import type { Finding, Prepared, SplitParams } from '../types.js';
import { headBlock, readAll } from './chain.js';
import {
  findSplitParams,
  hasContractCode,
  NATIVE_TOKEN_ID,
  splitParamsMismatch,
} from './getSplit.js';
import {
  checkSplitParams,
  hashSplitParams,
  splitAmounts,
  SplitParamsSchema,
} from './shares.js';

const ZERO_HASH = `0x${'0'.repeat(64)}`;

const DistributionSplit = Type.Object({
  ...SplitParamsSchema.properties,
  address: Type.Optional(T.Address),
});

const DistributionInputSchema = Type.Object({
  ovm: Type.Optional(T.Address),
  rewardSplit: Type.Optional(DistributionSplit),
  principalSplit: Type.Optional(DistributionSplit),
  recipients: Type.Optional(Type.Array(T.Address)),
  minWithdraw: Type.Optional(Type.BigInt({ minimum: 1n })),
  distributor: Type.Optional(T.Address),
  from: Type.Optional(T.Address),
});

export interface DistributionInput {
  ovm?: Address;
  /** The split params; `address` defaults to the OVM's matching recipient. */
  rewardSplit?: SplitParams & { address?: Address };
  principalSplit?: SplitParams & { address?: Address };
  /** Whose balances to withdraw; default every split recipient except the RAF. */
  recipients?: Address[];
  /** Skip a leg moving less than this (wei, default 1). */
  minWithdraw?: bigint;
  /** Receives split distribution incentives; default the sender. */
  distributor?: Address;
  /** The sender, for the pause rules; default the wallet account. */
  from?: Address;
}

/**
 * Why a leg is left out: `nothing` (0 after the 1 wei kept), `dust` (below
 * `minWithdraw`), `paused` (Warehouse withdrawals paused for the recipient
 * and the sender cannot bypass it).
 */
export type SkipReason = 'nothing' | 'dust' | 'paused';

export interface DistributionPreview {
  blockNumber: bigint;
  ovm?: {
    address: Address;
    distributable: bigint;
    principalPayout: bigint;
    rewardPayout: bigint;
    principalRecipient: Address;
    rewardRecipient: Address;
    skipReason?: SkipReason;
  };
  splits: Array<{
    address: Address;
    kind: 'reward' | 'principal';
    distributable: bigint;
    distributorReward: bigint;
    skipReason?: SkipReason;
  }>;
  recipients: Array<{
    address: Address;
    fromOvm: bigint;
    fromRewardSplit: bigint;
    fromPrincipalSplit: bigint;
    /** Split distribution incentives credited to this address as the distributor (wei); 0 for others. */
    distributorReward: bigint;
    warehouseBalance: bigint;
    splitMainBalance: bigint;
    /** The recipient is in the withdrawal set; `skipReason` says if its withdrawal is left out. */
    withdraw: boolean;
    skipReason?: SkipReason;
    /**
     * What this distribution credits the recipient (wei): `fromOvm +
     * fromRewardSplit + fromPrincipalSplit + distributorReward`, whether or
     * not it is withdrawn in this transaction.
     */
    fromThisDistribution: bigint;
    /**
     * ETH this transaction sends to the recipient's wallet (wei): `fromOvm`,
     * plus, when its withdrawal is included, its whole Warehouse balance
     * (what it already had there, from any split, plus this distribution's
     * split credits, minus the 1 wei kept) and its whole SplitMain v1
     * balance (minus 1 wei). So it can exceed `fromThisDistribution`; use
     * that for "earned by this distribution".
     */
    toWallet: bigint;
  }>;
}

interface Call3 {
  target: Address;
  allowFailure: boolean;
  callData: Hex;
}

interface ResolvedSplit {
  kind: 'reward' | 'principal';
  address: Address;
  params: SplitParams;
}

interface OvmState {
  balance: bigint;
  fundsPendingWithdrawal: bigint;
  amountOfPrincipalStake: bigint;
  principalThreshold: bigint;
  principalRecipient: Address;
  rewardRecipient: Address;
}

// Splits contracts leave 1 wei behind when they move a balance.
const withoutDust = (amount: bigint): bigint =>
  amount > 0n ? amount - 1n : 0n;

const skipFor = (amount: bigint): SkipReason =>
  amount === 0n ? 'nothing' : 'dust';

const readOvm = async (
  ctx: Context,
  multicall3: Address,
  ovm: Address,
  blockNumber: bigint,
): Promise<OvmState> => {
  const getters = [
    'fundsPendingWithdrawal',
    'amountOfPrincipalStake',
    'principalThreshold',
    'principalRecipient',
    'rewardRecipient',
  ] as const;
  const results = await readAll(
    ctx,
    multicall3,
    [
      {
        address: multicall3,
        abi: multicall3Abi,
        functionName: 'getEthBalance',
        args: [ovm],
      },
      ...getters.map(functionName => ({
        address: ovm,
        abi: ovmAbi,
        functionName,
      })),
    ],
    blockNumber,
    'the OVM state',
  );
  if (results.some(r => r === undefined)) {
    throw new ObolError(
      'OVM_READ_FAILED',
      `${ovm} did not answer the OVM getters`,
      {
        hint: 'Check the address and chain; run ovm.verify',
        details: { address: ovm },
      },
    );
  }
  const [balance, pending, stake, thresholdGwei, principal, reward] = results;
  return {
    balance: balance as bigint,
    fundsPendingWithdrawal: pending as bigint,
    amountOfPrincipalStake: stake as bigint,
    principalThreshold: thresholdGweiToWei(thresholdGwei as bigint),
    principalRecipient: checksum(principal as string),
    rewardRecipient: checksum(reward as string),
  };
};

const readSplitHash = async (
  ctx: Context,
  address: Address,
  blockNumber: bigint,
): Promise<Hex | undefined> => {
  try {
    return await ctx.publicClient.readContract({
      address,
      abi: splitWalletAbi,
      functionName: 'splitHash',
      blockNumber,
    });
  } catch {
    return undefined;
  }
};

/** Reads everything at one block and builds the calls, preview and findings. */
const buildDistribution = async (
  ctx: Context,
  input: DistributionInput,
): Promise<{
  calls: Call3[];
  preview: DistributionPreview;
  checks: Finding[];
  blockNumber: bigint;
}> => {
  const d = decode(DistributionInputSchema, input);
  if (
    d.ovm === undefined &&
    d.rewardSplit === undefined &&
    d.principalSplit === undefined
  ) {
    throw invalid('', 'needs at least one of ovm, rewardSplit, principalSplit');
  }
  const given = (
    key: 'rewardSplit' | 'principalSplit',
  ): { address?: Address; params: SplitParams } | undefined => {
    const split = d[key];
    return split === undefined
      ? undefined
      : {
          ...(split.address !== undefined
            ? { address: checksum(split.address) }
            : {}),
          params: checkSplitParams(split, key),
        };
  };
  const rewardGiven = given('rewardSplit');
  const principalGiven = given('principalSplit');
  const minWithdraw = d.minWithdraw ?? 1n;
  const contracts = requireContracts(
    ctx.chain.id,
    'splits.prepareDistribution',
  );
  const { multicall3, warehouse, splitMain, rafRecipient } = contracts;
  const sender = senderOf(
    ctx,
    d.from !== undefined ? checksum(d.from) : undefined,
  );
  const isSender = (address: string): boolean =>
    sender !== null && sameAddress(address, sender);
  const checks: Finding[] = [];

  // OVM: provenance, then its state at the block everything else is read at.
  const ovmAddress = d.ovm !== undefined ? checksum(d.ovm) : undefined;
  if (ovmAddress !== undefined) {
    const { verification, unknownFinding } = await requireObolOvm(
      ctx,
      ovmAddress,
      false,
    );
    if (unknownFinding) {
      checks.push(
        finding(
          'PROVENANCE_UNKNOWN',
          'warning',
          `Could not check that ${ovmAddress} was created by the Obol factory: ${verification.reason}`,
          {
            hint: 'Retry ovm.verify before relying on the contract',
            details: { address: ovmAddress },
          },
        ),
      );
    }
  }
  const blockNumber = await headBlock(ctx);
  const ovm =
    ovmAddress !== undefined
      ? await readOvm(ctx, multicall3, ovmAddress, blockNumber)
      : undefined;
  const routing = ovm !== undefined ? ovmRouting(ovm) : undefined;
  const ovmIncluded =
    routing !== undefined && routing.distributable >= minWithdraw;
  // What the OVM's distributeFunds() pushes to `address` in this transaction.
  const fromOvmTo = (address: string): bigint => {
    if (!ovmIncluded || ovm === undefined || routing === undefined) return 0n;
    return (
      (sameAddress(address, ovm.principalRecipient)
        ? routing.principalPayout
        : 0n) +
      (sameAddress(address, ovm.rewardRecipient) ? routing.rewardPayout : 0n)
    );
  };

  // Each split's address: given, or the OVM's matching recipient.
  const resolve = (
    kind: ResolvedSplit['kind'],
    split: typeof rewardGiven,
  ): ResolvedSplit | undefined => {
    if (split === undefined) return undefined;
    const ovmRecipient =
      ovm === undefined
        ? undefined
        : kind === 'reward'
          ? ovm.rewardRecipient
          : ovm.principalRecipient;
    if (
      split.address !== undefined &&
      ovmRecipient !== undefined &&
      !sameAddress(split.address, ovmRecipient)
    ) {
      throw new ObolError(
        'SPLIT_NOT_OVM_RECIPIENT',
        `${split.address} is not the OVM's ${kind} recipient (${ovmRecipient})`,
        {
          hint: 'Omit the address or fix it',
          details: { address: split.address, kind, ovmRecipient },
        },
      );
    }
    const address = split.address ?? ovmRecipient;
    if (address === undefined) {
      throw invalid(`${kind}Split.address`, 'is required without ovm');
    }
    return { kind, address, params: split.params };
  };
  const splits: ResolvedSplit[] = [];
  const reward = resolve('reward', rewardGiven);
  const principal = resolve('principal', principalGiven);
  if (reward !== undefined) splits.push(reward);
  if (principal !== undefined) {
    if (
      reward !== undefined &&
      sameAddress(reward.address, principal.address)
    ) {
      // One split receives both payouts and is distributed once.
      if (
        hashSplitParams(reward.params) !== hashSplitParams(principal.params)
      ) {
        throw splitParamsMismatch(
          principal.address,
          'The reward and principal params for one address',
        );
      }
    } else {
      splits.push(principal);
    }
  }

  // OVM recipients without params are paid directly, unless they are SplitV2
  // splits: those need params, or their funds would stay undistributed.
  const direct: Address[] = [];
  if (ovm !== undefined) {
    for (const [kind, address] of [
      ['principal', ovm.principalRecipient],
      ['reward', ovm.rewardRecipient],
    ] as const) {
      if (
        splits.some(s => sameAddress(s.address, address)) ||
        direct.some(a => sameAddress(a, address))
      ) {
        continue;
      }
      if (await hasContractCode(ctx, address, blockNumber)) {
        const splitHash = await readSplitHash(ctx, address, blockNumber);
        if (splitHash !== undefined && splitHash !== ZERO_HASH) {
          const found = await findSplitParams(ctx, {
            address,
            splitHash,
            ...(ovmAddress !== undefined ? { ovm: ovmAddress } : {}),
            toBlock: blockNumber,
          });
          if (found === null) {
            throw new ObolError(
              'SPLIT_PARAMS_REQUIRED',
              `The OVM's ${kind} recipient ${address} is a SplitV2 split and its params could not be found`,
              {
                hint: `Pass its params as ${kind}Split`,
                details: { address, kind },
              },
            );
          }
          splits.push({ kind, address, params: found.params });
          continue;
        }
      }
      direct.push(address);
    }
  }

  const distributor =
    d.distributor !== undefined
      ? checksum(d.distributor)
      : (sender ?? undefined);
  const hasIncentive = splits.some(s => s.params.distributionIncentive > 0);
  if (hasIncentive && distributor === undefined) {
    throw invalid(
      'distributor',
      'is required for splits with a distribution incentive when there is no sender',
    );
  }

  // Addresses to preview: split recipients, direct OVM recipients, the
  // recipients to withdraw for and the distributor.
  const withdrawFor = (
    d.recipients ??
    splits
      .flatMap(s => s.params.recipients)
      .filter(a => !sameAddress(a, rafRecipient))
  ).map(checksum);
  const addresses: Address[] = [];
  const addAddress = (address: Address): void => {
    if (!addresses.some(a => sameAddress(a, address))) addresses.push(address);
  };
  splits.forEach(s => {
    s.params.recipients.forEach(addAddress);
  });
  direct.forEach(addAddress);
  withdrawFor.forEach(addAddress);
  if (hasIncentive && distributor !== undefined) addAddress(distributor);

  const results = await readAll(
    ctx,
    multicall3,
    [
      ...splits.flatMap(s => [
        { address: s.address, abi: splitWalletAbi, functionName: 'splitHash' },
        { address: s.address, abi: splitWalletAbi, functionName: 'paused' },
        { address: s.address, abi: splitWalletAbi, functionName: 'owner' },
        {
          address: s.address,
          abi: splitWalletAbi,
          functionName: 'getSplitBalance',
          args: [NATIVE_TOKEN],
        },
      ]),
      ...addresses.flatMap(address => [
        {
          address: warehouse,
          abi: warehouseAbi,
          functionName: 'balanceOf',
          args: [address, NATIVE_TOKEN_ID],
        },
        {
          address: warehouse,
          abi: warehouseAbi,
          functionName: 'withdrawConfig',
          args: [address],
        },
        {
          address: splitMain,
          abi: splitMainAbi,
          functionName: 'getETHBalance',
          args: [address],
        },
      ]),
    ],
    blockNumber,
    'the split and recipient balances',
  );

  // Through Multicall3 the splits and the Warehouse see Multicall3 as
  // msg.sender, so their owner exemptions (a paused split's owner, a paused
  // Warehouse owner) can only match tx.origin: the sender, if it is an EOA (an
  // EIP-7702 delegated account still signs as an EOA). A contract sender (a
  // Safe) never gets them.
  let senderEoa: Promise<boolean> | undefined;
  const senderIsOrigin = async (): Promise<boolean> => {
    if (sender === null) return false;
    senderEoa ??= hasContractCode(ctx, sender, blockNumber).then(c => !c);
    return await senderEoa;
  };
  const ownsPausedSplit = splits.some((_, i) => {
    const [, paused, owner] = results.slice(i * 4, i * 4 + 4);
    return paused === true && typeof owner === 'string' && isSender(owner);
  });
  const splitOwnerBypass = ownsPausedSplit && (await senderIsOrigin());

  const calls: Call3[] = [];
  if (ovmIncluded && ovmAddress !== undefined) {
    calls.push({
      target: ovmAddress,
      allowFailure: false,
      callData: encodeFunctionData({
        abi: ovmAbi,
        functionName: 'distributeFunds',
      }),
    });
  }

  // Warehouse credits per address from the included split distributions.
  const credits = new Map<
    string,
    { reward: bigint; principal: bigint; other: bigint }
  >();
  const credit = (
    address: string,
    kind: 'reward' | 'principal' | 'other',
    amount: bigint,
  ): void => {
    const key = address.toLowerCase();
    const entry = credits.get(key) ?? { reward: 0n, principal: 0n, other: 0n };
    entry[kind] += amount;
    credits.set(key, entry);
  };

  const splitPreviews: DistributionPreview['splits'] = splits.map(
    (split, i) => {
      const [hash, paused, owner, balances] = results.slice(i * 4, i * 4 + 4);
      if (
        typeof hash !== 'string' ||
        hash.toLowerCase() !== hashSplitParams(split.params).toLowerCase()
      ) {
        throw splitParamsMismatch(
          split.address,
          `The ${split.kind} split params`,
        );
      }
      const [splitBalance, warehouseBalance] = (balances as
        | readonly [bigint, bigint]
        | undefined) ?? [0n, 0n];
      // PullSplit.distribute moves (own balance - 1) + (Warehouse balance - 1).
      const distributable =
        withoutDust(splitBalance + fromOvmTo(split.address)) +
        withoutDust(warehouseBalance);
      const { amounts, distributorReward } = splitAmounts(
        split.params,
        distributable,
      );
      const included = distributable >= minWithdraw;
      if (included) {
        const ownedBySender = typeof owner === 'string' && isSender(owner);
        if (paused === true && !(ownedBySender && splitOwnerBypass)) {
          throw new ObolError(
            'SPLIT_PAUSED',
            ownedBySender
              ? `The ${split.kind} split ${split.address} is paused, and its owner ${owner} is a contract: through Multicall3 only an EOA owner passes the pause`
              : `The ${split.kind} split ${split.address} is paused`,
            {
              hint: ownedBySender
                ? "Unpause it first, or call the split's distribute directly from the owner"
                : 'Only its owner can distribute a paused split; ask the owner to unpause it',
              details: {
                address: split.address,
                ...(typeof owner === 'string'
                  ? { owner: checksum(owner) }
                  : {}),
              },
            },
          );
        }
        calls.push({
          target: split.address,
          allowFailure: false,
          callData: encodeFunctionData({
            abi: splitWalletAbi,
            functionName: 'distribute',
            args: [split.params, NATIVE_TOKEN, distributor ?? ZERO_ADDRESS],
          }),
        });
        split.params.recipients.forEach((recipient, j) => {
          credit(recipient, split.kind, amounts[j]);
        });
        if (distributorReward > 0n && distributor !== undefined) {
          credit(distributor, 'other', distributorReward);
        }
      }
      return {
        address: split.address,
        kind: split.kind,
        distributable,
        distributorReward,
        ...(included ? {} : { skipReason: skipFor(distributable) }),
      };
    },
  );

  // Warehouse.withdraw skips the pause check when msg.sender or tx.origin is
  // the owner; through Multicall3 only tx.origin can match (above).
  const balanceResults = results.slice(splits.length * 4);
  const pausedAt = (i: number): boolean =>
    (
      balanceResults[i * 3 + 1] as readonly [number, boolean] | undefined
    )?.[1] === true;
  const warehouseOwnerBypass =
    addresses.some((a, i) => isSender(a) && pausedAt(i)) &&
    (await senderIsOrigin());

  const recipients: DistributionPreview['recipients'] = addresses.map(
    (address, i) => {
      const warehouseBalance =
        (balanceResults[i * 3] as bigint | undefined) ?? 0n;
      const splitMainBalance =
        (balanceResults[i * 3 + 2] as bigint | undefined) ?? 0n;
      const fromSplits = credits.get(address.toLowerCase()) ?? {
        reward: 0n,
        principal: 0n,
        other: 0n,
      };
      const fromOvm = direct.some(a => sameAddress(a, address))
        ? fromOvmTo(address)
        : 0n;
      const withdraw = withdrawFor.some(a => sameAddress(a, address));
      const warehouseAmount = withoutDust(
        warehouseBalance +
          fromSplits.reward +
          fromSplits.principal +
          fromSplits.other,
      );
      const splitMainAmount = withoutDust(splitMainBalance);
      let toWallet = fromOvm;
      let skipReason: SkipReason | undefined;
      if (withdraw) {
        const blocked =
          pausedAt(i) &&
          !(isSender(address) && warehouseOwnerBypass) &&
          warehouseAmount >= minWithdraw;
        let included = false;
        if (warehouseAmount >= minWithdraw && !blocked) {
          toWallet += warehouseAmount;
          included = true;
          calls.push({
            target: warehouse,
            allowFailure: true,
            callData: encodeFunctionData({
              abi: warehouseAbi,
              functionName: 'withdraw',
              args: [address, NATIVE_TOKEN],
            }),
          });
        }
        if (splitMainAmount >= minWithdraw) {
          toWallet += splitMainAmount;
          included = true;
          calls.push({
            target: splitMain,
            allowFailure: true,
            callData: encodeFunctionData({
              abi: splitMainAbi,
              functionName: 'withdraw',
              args: [address, 1n, []],
            }),
          });
        }
        if (blocked) {
          checks.push(
            finding(
              'RECIPIENT_WITHDRAW_PAUSED',
              'info',
              `${address} paused its Warehouse withdrawals; its withdrawal is left out`,
              { hint: 'The recipient withdraws itself', details: { address } },
            ),
          );
        }
        if (!included) {
          skipReason = blocked
            ? 'paused'
            : skipFor(warehouseAmount + splitMainAmount);
        }
      }
      return {
        address,
        fromOvm,
        fromRewardSplit: fromSplits.reward,
        fromPrincipalSplit: fromSplits.principal,
        distributorReward: fromSplits.other,
        warehouseBalance,
        splitMainBalance,
        withdraw,
        ...(skipReason !== undefined ? { skipReason } : {}),
        fromThisDistribution:
          fromOvm + fromSplits.reward + fromSplits.principal + fromSplits.other,
        toWallet,
      };
    },
  );

  const preview: DistributionPreview = {
    blockNumber,
    ...(ovm !== undefined && routing !== undefined && ovmAddress !== undefined
      ? {
          ovm: {
            address: ovmAddress,
            distributable: routing.distributable,
            principalPayout: routing.principalPayout,
            rewardPayout: routing.rewardPayout,
            principalRecipient: ovm.principalRecipient,
            rewardRecipient: ovm.rewardRecipient,
            ...(ovmIncluded
              ? {}
              : { skipReason: skipFor(routing.distributable) }),
          },
        }
      : {}),
    splits: splitPreviews,
    recipients,
  };
  return { calls, preview, checks, blockNumber };
};

/**
 * Builds one Multicall3 `aggregate3`: OVM `distributeFunds()`, each split's
 * `distribute`, then Warehouse / SplitMain withdrawals per recipient. All
 * state is read at one block. Checks, in order: at least one of `ovm`,
 * `rewardSplit`, `principalSplit`, and well-formed params; OVM provenance
 * (OVM_NOT_OBOL; unknown is a PROVENANCE_UNKNOWN warning) and getters
 * (OVM_READ_FAILED); a given split address is the OVM's recipient
 * (SPLIT_NOT_OVM_RECIPIENT); one address with different reward and principal
 * params (SPLIT_PARAMS_MISMATCH); an OVM recipient that is a split without
 * findable params (SPLIT_PARAMS_REQUIRED); a distributor for splits with an
 * incentive (PAYLOAD_INVALID); each split's `splitHash` (SPLIT_PARAMS_MISMATCH);
 * a paused split unless the sender is its owner and an EOA (through Multicall3
 * only tx.origin passes the pause; SPLIT_PAUSED); something to move
 * (NOTHING_TO_DISTRIBUTE). Legs below `minWithdraw` are left out with a
 * `skipReason`; recipients whose paused Warehouse withdrawals the sender cannot
 * bypass get a RECIPIENT_WITHDRAW_PAUSED finding.
 */
export const prepareDistribution = async (
  ctx: Context,
  input: DistributionInput,
): Promise<Prepared<DistributionPreview>> => {
  const { calls, preview, checks, blockNumber } = await buildDistribution(
    ctx,
    input,
  );
  if (calls.length === 0) {
    throw new ObolError('NOTHING_TO_DISTRIBUTE', 'Nothing to distribute', {
      hint: 'The OVM, splits and recipients hold nothing above minWithdraw; prepare again later',
    });
  }
  const { multicall3 } = requireContracts(
    ctx.chain.id,
    'splits.prepareDistribution',
  );
  return prepared(ctx, {
    to: multicall3,
    data: encodeFunctionData({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls],
    }),
    checks,
    preview,
    blockNumber,
  });
};

/**
 * The same reads and checks as `prepareDistribution`, without throwing
 * NOTHING_TO_DISTRIBUTE: for a page that shows the legs with the button
 * disabled.
 */
export const previewDistribution = async (
  ctx: Context,
  input: DistributionInput,
): Promise<{
  preview: DistributionPreview;
  checks: Finding[];
  blockNumber: bigint;
}> => {
  const { preview, checks, blockNumber } = await buildDistribution(ctx, input);
  return { preview, checks, blockNumber };
};

export interface DistributionReceipt {
  logs: ReadonlyArray<{ address: string; topics: readonly Hex[]; data: Hex }>;
}

export interface DistributionResult {
  /** ETH withdrawn to each wallet (Warehouse native-token `Withdraw` and SplitMain `Withdrawal`). */
  withdrawn: Record<Address, bigint>;
  /** The OVM's `DistributeFunds` payout, when `ovm` is given and it emitted one. */
  ovmPayout?: { principal: bigint; reward: bigint };
}

/**
 * Reads a mined distribution: Warehouse `Withdraw` logs for the native token,
 * SplitMain `Withdrawal` logs and the OVM's `DistributeFunds` log. Only logs
 * emitted by the chain's Warehouse / SplitMain and the given OVM count.
 */
export const distributionFromReceipt = (
  receipt: DistributionReceipt,
  options: { chainId: number; ovm?: Address },
): DistributionResult => {
  const { warehouse, splitMain } = requireContracts(
    options.chainId,
    'splits.distributionFromReceipt',
  );
  const withdrawn: Record<Address, bigint> = {};
  let ovmPayout: DistributionResult['ovmPayout'];
  const add = (owner: string, amount: bigint): void => {
    const address = checksum(owner);
    withdrawn[address] = (withdrawn[address] ?? 0n) + amount;
  };
  for (const log of receipt.logs) {
    const topics = log.topics as [Hex, ...Hex[]];
    try {
      if (sameAddress(log.address, warehouse)) {
        const { eventName, args } = decodeEventLog({
          abi: warehouseAbi,
          data: log.data,
          topics,
        });
        if (eventName === 'Withdraw' && sameAddress(args.token, NATIVE_TOKEN)) {
          add(args.owner, args.amount);
        }
      } else if (sameAddress(log.address, splitMain)) {
        const { eventName, args } = decodeEventLog({
          abi: splitMainAbi,
          data: log.data,
          topics,
        });
        if (eventName === 'Withdrawal') add(args.account, args.ethAmount);
      } else if (
        options.ovm !== undefined &&
        sameAddress(log.address, options.ovm)
      ) {
        const { eventName, args } = decodeEventLog({
          abi: ovmAbi,
          data: log.data,
          topics,
        });
        if (eventName === 'DistributeFunds') {
          ovmPayout = {
            principal: args.principalPayout,
            reward: args.rewardPayout,
          };
        }
      }
    } catch {
      // Another event of the same contract.
    }
  }
  return { withdrawn, ...(ovmPayout !== undefined ? { ovmPayout } : {}) };
};
