/**
 * ovm.prepareWithdraw (EIP-7002) and ovm.prepareConsolidate (EIP-7251)
 * through the OVM (spec/operations.md).
 */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { ovmAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import { prepared, readRequestFee, resolveRequestFee } from '../chainUtils.js';
import { senderOf, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, invalid, T, ZERO_ADDRESS } from '../schema.js';
import type { Prepared, StatusSource } from '../types.js';
import { GWEI, MAX_UINT64, weiToGwei } from '../units.js';
import {
  StatusSourceFields,
  statusIfAvailable,
  statusSourceOf,
} from '../deposits/status.js';
import {
  checkConsolidationRequests,
  checkWithdrawalRequests,
  noStatusFinding,
  type CheckedWithdrawal,
} from './requestRules.js';
import {
  provenanceFindings,
  readOvmCore,
  requireRole,
  requireSender,
  type OvmCore,
} from './read.js';
import { ovmRouting } from './routing.js';

/** wei → gwei for an EIP-7002 amount: whole gwei and at most 2^64−1 gwei. */
export const requestAmountGwei = (amount: bigint, path: string): bigint => {
  const gwei = weiToGwei(amount, path);
  if (gwei > MAX_UINT64) throw invalid(path, 'must be at most 2^64-1 gwei');
  return gwei;
};

/** FULL_EXIT_NOT_ACKNOWLEDGED unless `acknowledged` is exactly true. */
export const requireFullExitAcknowledged = (
  amounts: bigint[],
  acknowledged: unknown,
): void => {
  if (amounts.some(a => a === 0n) && acknowledged !== true) {
    throw new ObolError(
      'FULL_EXIT_NOT_ACKNOWLEDGED',
      'A withdrawal amount of 0 is a full exit, and acknowledgeFullExit: true was not passed',
      {
        hint: 'Confirm the validator should exit, then pass acknowledgeFullExit: true; or pass the partial amount',
      },
    );
  }
};

/** `excessFeeRecipient`, else `from`, else the wallet account; non-zero. */
const resolveExcessFeeRecipient = (
  ctx: Context,
  given: string | undefined,
  from: string | undefined,
): Address => {
  const recipient = given ?? from ?? senderOf(ctx) ?? undefined;
  if (recipient === undefined) {
    throw invalid(
      'excessFeeRecipient',
      'is required when there is neither from nor a wallet account',
    );
  }
  if (checksum(recipient) === ZERO_ADDRESS) {
    throw invalid('excessFeeRecipient', 'must not be the zero address');
  }
  return checksum(recipient);
};

/* ------------------------------------------------------------------------ */
/* prepareWithdraw                                                           */
/* ------------------------------------------------------------------------ */

export const PrepareWithdrawInputSchema = Type.Object(
  {
    ovm: T.Address,
    requests: Type.Array(Type.Object({ pubkey: T.Pubkey, amount: T.Wei }), {
      minItems: 1,
    }),
    fee: Type.Optional(T.Wei),
    excessFeeRecipient: Type.Optional(T.Address),
    from: Type.Optional(T.Address),
    acknowledgeFullExit: Type.Optional(Type.Boolean()),
    ...StatusSourceFields,
  },
  { additionalProperties: false },
);
export interface PrepareWithdrawInput extends StatusSource {
  ovm: string;
  /** `amount` in wei, whole gwei; 0 is a full exit (needs `acknowledgeFullExit`). */
  requests: Array<{ pubkey: string; amount: bigint }>;
  /** Total fee in wei; default max(10 × current fee, 1 gwei) × n (the OVM refunds the excess to `excessFeeRecipient`). */
  fee?: bigint;
  excessFeeRecipient?: string;
  from?: string;
  acknowledgeFullExit?: boolean;
}

export interface WithdrawRequestPreview {
  pubkey: Hex;
  /** wei in the request: the amount asked for, or the excess balance it was capped to. */
  amount: bigint;
  /** The amount asked for, when it was capped to the excess balance (WITHDRAW_AMOUNT_CAPPED). */
  requestedAmount?: bigint;
  /** How a distribution right after this request's ETH arrives would route it (absent when the amount is unknown). */
  routedAs?: 'principal' | 'reward' | 'mixed';
  principalPart?: bigint;
  rewardPart?: bigint;
}

export interface WithdrawPreview {
  requests: WithdrawRequestPreview[];
  totalFee: bigint;
  maxFeePerRequest: bigint;
}

/**
 * Routing of `amount` arriving on top of what the OVM holds now: the
 * principal payout of that distribution is attributed to this ETH first.
 */
const routeArrival = (
  core: OvmCore,
  amount: bigint,
): Pick<
  WithdrawRequestPreview,
  'routedAs' | 'principalPart' | 'rewardPart'
> => {
  const { principalPayout } = ovmRouting({
    ...core,
    balance: core.balance + amount,
  });
  const principalPart = principalPayout < amount ? principalPayout : amount;
  const rewardPart = amount - principalPart;
  let routedAs: WithdrawRequestPreview['routedAs'] = 'mixed';
  if (rewardPart === 0n) routedAs = 'principal';
  else if (principalPart === 0n) routedAs = 'reward';
  return { routedAs, principalPart, rewardPart };
};

/**
 * ovm.prepareWithdraw (`chain`): EIP-7002 requests through `OVM.withdraw`.
 * Checks, in order: amounts whole gwei ≤ 2^64−1 gwei; a 0 amount (full exit)
 * needs `acknowledgeFullExit: true` (FULL_EXIT_NOT_ACKNOWLEDGED); a non-zero
 * `excessFeeRecipient`; provenance (OVM_NOT_OBOL, or a PROVENANCE_UNKNOWN
 * warning); the sender is owner or holds WITHDRAWAL (OVM_ROLE_MISSING); the
 * fee (FEE_READ_FAILED, FEE_OUT_OF_RANGE; default the top of the accepted
 * range, max(10 × fee, 1 gwei) × n: the OVM refunds the excess to
 * `excessFeeRecipient`); with a status source, per-pubkey warnings
 * (WITHDRAW_CREDENTIALS_NOT_OVM, WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING,
 * WITHDRAW_VALIDATOR_NOT_ACTIVE).
 */
export const prepareWithdraw = async (
  ctx: Context,
  input: PrepareWithdrawInput,
): Promise<Prepared<'withdraw'>> => {
  const args = decode(PrepareWithdrawInputSchema, input);
  const contracts = requireContracts(ctx.chain.id, 'ovm.prepareWithdraw');
  const ovm = checksum(args.ovm);
  args.requests.forEach((r, i) => {
    requestAmountGwei(r.amount, `requests[${i}].amount`);
  });
  requireFullExitAcknowledged(
    args.requests.map(r => r.amount),
    args.acknowledgeFullExit,
  );
  const excessFeeRecipient = resolveExcessFeeRecipient(
    ctx,
    args.excessFeeRecipient,
    args.from,
  );

  const checks = await provenanceFindings(ctx, ovm);
  const from = requireSender(ctx, args.from, 'ovm.prepareWithdraw');
  const core = await readOvmCore(ctx, ovm, {
    from,
    what: 'ovm.prepareWithdraw',
  });
  requireRole(core, from, 'WITHDRAWAL');

  const n = args.requests.length;
  const currentFee = await readRequestFee(
    ctx.publicClient,
    contracts.withdrawalRequest,
  );
  const totalFee = resolveRequestFee({
    currentFee,
    requestedFee: args.fee,
    count: n,
    defaultTo: 'cap',
  });
  const maxFeePerRequest = totalFee / BigInt(n);

  const asked = args.requests.map(r => ({
    pubkey: r.pubkey.toLowerCase() as Hex,
    amount: r.amount,
  }));
  const statuses = await statusIfAvailable(
    ctx,
    asked.map(r => r.pubkey),
    statusSourceOf(args),
  );
  let sent: CheckedWithdrawal[] = asked;
  if (statuses === null) {
    checks.push(noStatusFinding('ovm.prepareWithdraw'));
  } else {
    const result = checkWithdrawalRequests(
      { chain: ctx.chain },
      asked,
      statuses,
      {
        address: ovm,
        what: 'the OVM',
      },
    );
    sent = result.requests;
    checks.push(...result.checks);
  }
  const requests = sent.map((request): WithdrawRequestPreview => {
    const arriving =
      request.amount > 0n
        ? request.amount
        : statuses?.get(request.pubkey)?.balance;
    return {
      ...request,
      ...(arriving !== undefined ? routeArrival(core, arriving) : {}),
    };
  });

  return prepared(ctx, 'withdraw', {
    to: ovm,
    data: encodeFunctionData({
      abi: ovmAbi,
      functionName: 'withdraw',
      args: [
        requests.map(r => r.pubkey),
        requests.map(r => r.amount / GWEI),
        maxFeePerRequest,
        excessFeeRecipient,
      ],
    }),
    value: totalFee,
    checks,
    preview: { requests, totalFee, maxFeePerRequest },
    blockNumber: core.blockNumber,
  });
};

/* ------------------------------------------------------------------------ */
/* prepareConsolidate                                                        */
/* ------------------------------------------------------------------------ */

/** Contract limit on sources per consolidation request. */
export const MAX_CONSOLIDATION_SOURCES = 63;

export const PrepareConsolidateInputSchema = Type.Object(
  {
    ovm: T.Address,
    requests: Type.Array(
      Type.Object({
        sources: Type.Array(T.Pubkey, {
          minItems: 1,
          maxItems: MAX_CONSOLIDATION_SOURCES,
        }),
        target: T.Pubkey,
      }),
      { minItems: 1 },
    ),
    acknowledgeStakeMovesToTarget: Type.Literal(true),
    fee: Type.Optional(T.Wei),
    excessFeeRecipient: Type.Optional(T.Address),
    from: Type.Optional(T.Address),
    ...StatusSourceFields,
  },
  { additionalProperties: false },
);
export interface PrepareConsolidateInput extends StatusSource {
  ovm: string;
  /** A source equal to its target switches it to 0x02 (compounding) credentials. */
  requests: Array<{ sources: string[]; target: string }>;
  acknowledgeStakeMovesToTarget: true;
  /** Total fee in wei; default max(10 × current fee, 1 gwei) × total sources (the OVM refunds the excess). */
  fee?: bigint;
  excessFeeRecipient?: string;
  from?: string;
}

export interface ConsolidatePreview {
  requests: Array<{ sources: Hex[]; target: Hex }>;
  totalFee: bigint;
  maxFeePerRequest: bigint;
}

/**
 * ovm.prepareConsolidate (`chain`): EIP-7251 requests through
 * `OVM.consolidate`. Checks, in order: `acknowledgeStakeMovesToTarget` is
 * exactly true (CONSOLIDATION_NOT_ACKNOWLEDGED, before anything else);
 * 1–63 sources per request; provenance; the sender is owner or holds
 * CONSOLIDATION; the fee over all sources (EIP-7251 predeploy; default as
 * prepareWithdraw, the top of the accepted range); with a
 * status source, warnings CONSOLIDATION_TARGET_NOT_COMPOUNDING and
 * CONSOLIDATION_CREDENTIALS_DIFFER (withdrawal addresses compared).
 */
export const prepareConsolidate = async (
  ctx: Context,
  input: PrepareConsolidateInput,
): Promise<Prepared<'consolidate'>> => {
  // Checked first and at runtime, also for untyped callers.
  if (
    (input as { acknowledgeStakeMovesToTarget?: unknown } | null)
      ?.acknowledgeStakeMovesToTarget !== true
  ) {
    throw new ObolError(
      'CONSOLIDATION_NOT_ACKNOWLEDGED',
      'prepareConsolidate requires acknowledgeStakeMovesToTarget: true',
      {
        hint: "Consolidation moves the source validators' stake to the target; confirm the targets are yours, then pass it",
      },
    );
  }
  const args = decode(PrepareConsolidateInputSchema, input);
  const contracts = requireContracts(ctx.chain.id, 'ovm.prepareConsolidate');
  const ovm = checksum(args.ovm);
  const excessFeeRecipient = resolveExcessFeeRecipient(
    ctx,
    args.excessFeeRecipient,
    args.from,
  );

  const checks = await provenanceFindings(ctx, ovm);
  const from = requireSender(ctx, args.from, 'ovm.prepareConsolidate');
  const core = await readOvmCore(ctx, ovm, {
    from,
    what: 'ovm.prepareConsolidate',
  });
  requireRole(core, from, 'CONSOLIDATION');

  const requests = args.requests.map(r => ({
    sources: r.sources.map(s => s.toLowerCase() as Hex),
    target: r.target.toLowerCase() as Hex,
  }));
  const n = requests.reduce((sum, r) => sum + r.sources.length, 0);
  const currentFee = await readRequestFee(
    ctx.publicClient,
    contracts.consolidationRequest,
  );
  const totalFee = resolveRequestFee({
    currentFee,
    requestedFee: args.fee,
    count: n,
    defaultTo: 'cap',
  });
  const maxFeePerRequest = totalFee / BigInt(n);

  const pubkeys = [...new Set(requests.flatMap(r => [...r.sources, r.target]))];
  const statuses = await statusIfAvailable(ctx, pubkeys, statusSourceOf(args));
  checks.push(
    ...(statuses === null
      ? [noStatusFinding('ovm.prepareConsolidate')]
      : checkConsolidationRequests(
          { chain: ctx.chain },
          requests,
          statuses,
          ovm,
        )),
  );

  return prepared(ctx, 'consolidate', {
    to: ovm,
    data: encodeFunctionData({
      abi: ovmAbi,
      functionName: 'consolidate',
      args: [
        requests.map(r => ({ srcPubKeys: r.sources, targetPubKey: r.target })),
        maxFeePerRequest,
        excessFeeRecipient,
      ],
    }),
    value: totalFee,
    checks,
    preview: { requests, totalFee, maxFeePerRequest },
    blockNumber: core.blockNumber,
  });
};
