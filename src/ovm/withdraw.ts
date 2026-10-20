/**
 * ovm.prepareWithdraw (EIP-7002) and ovm.prepareConsolidate (EIP-7251)
 * through the OVM (spec/operations.md).
 */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { ovmAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import {
  finding,
  prepared,
  readRequestFee,
  resolveRequestFee,
} from '../chainUtils.js';
import { senderOf, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, invalid, T, ZERO_ADDRESS } from '../schema.js';
import type { Finding, Prepared } from '../types.js';
import { MAX_UINT64, weiToGwei } from '../units.js';
import {
  DepositStatusOptionsSchema,
  statusIfAvailable,
  type DepositStatus,
} from '../deposits/status.js';
import {
  credentialsAddress,
  credentialsPointAt,
  credentialsPrefix,
} from './credentials.js';
import {
  provenanceFindings,
  readOvmCore,
  requireRole,
  requireSender,
  type OvmCore,
} from './read.js';
import { ovmRouting } from './routing.js';

const statusOptionFields = {
  beaconUrl: DepositStatusOptionsSchema.properties.beaconUrl,
  lockHash: DepositStatusOptionsSchema.properties.lockHash,
};

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

/**
 * Findings for one withdrawal request from the validator's status
 * (spec "prepareWithdraw" 6, "prepareEoaWithdraw" 2–3). `target` is the
 * address the credentials must point at, with the finding code to use.
 */
export const requestStatusFindings = (
  status: DepositStatus,
  amount: bigint,
  target: { address: Address; code: string; what: string } | null,
): Finding[] => {
  const findings: Finding[] = [];
  const details = { pubkey: status.pubkey };
  const credentials = status.withdrawalCredentials;
  if (
    target !== null &&
    credentials !== undefined &&
    !credentialsPointAt(credentials, target.address)
  ) {
    findings.push(
      finding(
        target.code,
        'warning',
        `The credentials of ${status.pubkey} do not point at ${target.what} ${target.address}: the request would be ignored and the fee kept`,
        {
          hint: 'Send the request from the address the validator credentials point at',
          details: { ...details, withdrawalCredentials: credentials },
        },
      ),
    );
  }
  if (
    amount > 0n &&
    credentials !== undefined &&
    credentialsPrefix(credentials) !== '0x02'
  ) {
    findings.push(
      finding(
        'WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING',
        'warning',
        `${status.pubkey} does not have 0x02 credentials: the beacon chain ignores a partial withdrawal and keeps the fee`,
        { hint: 'Consolidate to 0x02 first, or exit', details },
      ),
    );
  }
  if (status.status !== 'active') {
    findings.push(
      finding(
        'WITHDRAW_VALIDATOR_NOT_ACTIVE',
        'warning',
        `${status.pubkey} is not active (${status.beaconStatus ?? status.status})`,
        { hint: 'Wait for activation, or drop the request', details },
      ),
    );
  }
  return findings;
};

/** `excessFeeRecipient`, else `from`, else the wallet account; non-zero. */
const resolveExcessFeeRecipient = (
  ctx: Context,
  given: string | undefined,
  from: string | undefined,
): Address => {
  const recipient = given ?? from ?? senderOf(ctx, undefined) ?? undefined;
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
    ...statusOptionFields,
  },
  { additionalProperties: false },
);
export interface PrepareWithdrawInput {
  ovm: Address;
  requests: Array<{ pubkey: Hex; amount: bigint }>;
  /** Total fee in wei; default max(10 × current fee, 1 gwei) × n (the OVM refunds the excess to `excessFeeRecipient`). */
  fee?: bigint;
  excessFeeRecipient?: Address;
  from?: Address;
  acknowledgeFullExit?: boolean;
  beaconUrl?: string;
  lockHash?: Hex;
}

export interface WithdrawRequestPreview {
  pubkey: Hex;
  amount: bigint;
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
  const routedAs =
    rewardPart === 0n ? 'principal' : principalPart === 0n ? 'reward' : 'mixed';
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
): Promise<Prepared<WithdrawPreview>> => {
  const args = decode(PrepareWithdrawInputSchema, input);
  const contracts = requireContracts(ctx.chain.id, 'ovm.prepareWithdraw');
  const ovm = checksum(args.ovm);
  const amountsGwei = args.requests.map((r, i) =>
    requestAmountGwei(r.amount, `requests[${i}].amount`),
  );
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
  const from = requireSender(
    ctx,
    args.from as Address | undefined,
    'ovm.prepareWithdraw',
  );
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

  const pubkeys = args.requests.map(r => r.pubkey.toLowerCase() as Hex);
  const statuses = await statusIfAvailable(ctx, pubkeys, {
    ...(args.beaconUrl !== undefined ? { beaconUrl: args.beaconUrl } : {}),
    ...(args.lockHash !== undefined ? { lockHash: args.lockHash as Hex } : {}),
  });
  const requests = args.requests.map((request, i): WithdrawRequestPreview => {
    const pubkey = pubkeys[i];
    const status = statuses?.get(pubkey);
    if (status !== undefined) {
      checks.push(
        ...requestStatusFindings(status, request.amount, {
          address: ovm,
          code: 'WITHDRAW_CREDENTIALS_NOT_OVM',
          what: 'the OVM',
        }),
      );
    }
    const arriving = request.amount > 0n ? request.amount : status?.balance;
    return {
      pubkey,
      amount: request.amount,
      ...(arriving !== undefined ? routeArrival(core, arriving) : {}),
    };
  });

  return prepared(ctx, {
    to: ovm,
    data: encodeFunctionData({
      abi: ovmAbi,
      functionName: 'withdraw',
      args: [pubkeys, amountsGwei, maxFeePerRequest, excessFeeRecipient],
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
    ...statusOptionFields,
  },
  { additionalProperties: false },
);
export interface PrepareConsolidateInput {
  ovm: Address;
  requests: Array<{ sources: Hex[]; target: Hex }>;
  acknowledgeStakeMovesToTarget: true;
  /** Total fee in wei; default max(10 × current fee, 1 gwei) × total sources (the OVM refunds the excess). */
  fee?: bigint;
  excessFeeRecipient?: Address;
  from?: Address;
  beaconUrl?: string;
  lockHash?: Hex;
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
): Promise<Prepared<ConsolidatePreview>> => {
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
  const from = requireSender(
    ctx,
    args.from as Address | undefined,
    'ovm.prepareConsolidate',
  );
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
  const statuses = await statusIfAvailable(ctx, pubkeys, {
    ...(args.beaconUrl !== undefined ? { beaconUrl: args.beaconUrl } : {}),
    ...(args.lockHash !== undefined ? { lockHash: args.lockHash as Hex } : {}),
  });
  if (statuses !== null) {
    for (const request of requests) {
      const target = statuses.get(request.target);
      const targetCredentials = target?.withdrawalCredentials;
      if (
        target?.status !== 'active' ||
        targetCredentials === undefined ||
        credentialsPrefix(targetCredentials) !== '0x02'
      ) {
        checks.push(
          finding(
            'CONSOLIDATION_TARGET_NOT_COMPOUNDING',
            'warning',
            `Target ${request.target} is not active with 0x02 credentials`,
            {
              hint: 'Switch the target to 0x02 first',
              details: { pubkey: request.target },
            },
          ),
        );
      }
      if (targetCredentials === undefined) continue;
      for (const source of request.sources) {
        const sourceCredentials = statuses.get(source)?.withdrawalCredentials;
        if (
          sourceCredentials !== undefined &&
          credentialsAddress(sourceCredentials) !==
            credentialsAddress(targetCredentials)
        ) {
          checks.push(
            finding(
              'CONSOLIDATION_CREDENTIALS_DIFFER',
              'warning',
              `Source ${source} and target ${request.target} have different withdrawal addresses`,
              {
                hint: 'Check the pubkeys',
                details: { source, target: request.target },
              },
            ),
          );
        }
      }
    }
  }

  return prepared(ctx, {
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
