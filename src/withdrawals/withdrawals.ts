/**
 * withdrawals module: EIP-7002 requests sent by the validator's withdrawal
 * address directly to the predeploy (spec/operations.md
 * "withdrawals.prepareEoaWithdraw").
 */
import { Type } from '@sinclair/typebox';
import { concat, numberToHex, type Hex } from 'viem';
import { requireContracts } from '../chains.js';
import { prepared, readRequestFee, resolveRequestFee } from '../chainUtils.js';
import { senderOf, type Context } from '../context.js';
import { decode, T } from '../schema.js';
import type { Prepared, StatusSource } from '../types.js';
import { GWEI } from '../units.js';
import {
  StatusSourceFields,
  statusIfAvailable,
  statusSourceOf,
} from '../deposits/status.js';
import {
  checkWithdrawalRequests,
  noStatusFinding,
} from '../ovm/requestRules.js';
import {
  requestAmountGwei,
  requireFullExitAcknowledged,
} from '../ovm/withdraw.js';

export const PrepareEoaWithdrawInputSchema = Type.Object(
  {
    pubkey: T.Pubkey,
    amount: T.Wei,
    fee: Type.Optional(T.Wei),
    acknowledgeFullExit: Type.Optional(Type.Boolean()),
    from: Type.Optional(T.Address),
    ...StatusSourceFields,
  },
  { additionalProperties: false },
);
export interface PrepareEoaWithdrawInput extends StatusSource {
  pubkey: string;
  /** wei, whole gwei; 0 = full exit (needs acknowledgeFullExit). */
  amount: bigint;
  /** Total fee in wei; default exactly the current fee (the predeploy keeps any excess). */
  fee?: bigint;
  acknowledgeFullExit?: boolean;
  /** The sender, for the credentials check; default the wallet account. */
  from?: string;
}

export interface EoaWithdrawPreview {
  pubkey: Hex;
  /** wei in the request: the amount asked for, or the excess balance it was capped to. */
  amount: bigint;
  /** The amount asked for, when it was capped (WITHDRAW_AMOUNT_CAPPED). */
  requestedAmount?: bigint;
  fee: bigint;
}

/**
 * withdrawals.prepareEoaWithdraw (`chain`): one EIP-7002 request to the
 * predeploy, `data = pubkey ‖ uint64_be(amount_gwei)`, `value = fee`.
 * Checks: amount whole gwei ≤ 2^64−1 gwei; 0 needs `acknowledgeFullExit`
 * (FULL_EXIT_NOT_ACKNOWLEDGED); the fee (FEE_READ_FAILED, FEE_OUT_OF_RANGE;
 * default 1 × current fee); with a status source, warnings
 * WITHDRAW_CREDENTIALS_NOT_SENDER (when a sender is known),
 * WITHDRAW_PARTIAL_REQUIRES_COMPOUNDING and WITHDRAW_VALIDATOR_NOT_ACTIVE.
 */
export const prepareEoaWithdraw = async (
  ctx: Context,
  input: PrepareEoaWithdrawInput,
): Promise<Prepared<'eoaWithdraw'>> => {
  const args = decode(PrepareEoaWithdrawInputSchema, input);
  const { withdrawalRequest } = requireContracts(
    ctx.chain.id,
    'withdrawals.prepareEoaWithdraw',
  );
  requestAmountGwei(args.amount, 'amount');
  requireFullExitAcknowledged([args.amount], args.acknowledgeFullExit);
  const currentFee = await readRequestFee(ctx.publicClient, withdrawalRequest);
  const fee = resolveRequestFee({
    currentFee,
    requestedFee: args.fee,
    count: 1,
    defaultTo: 'minimum',
  });

  const pubkey = args.pubkey.toLowerCase() as Hex;
  const sender = senderOf(ctx, args.from);
  const statuses = await statusIfAvailable(ctx, [pubkey], statusSourceOf(args));
  let request: { pubkey: Hex; amount: bigint; requestedAmount?: bigint } = {
    pubkey,
    amount: args.amount,
  };
  const checks =
    statuses === null
      ? [noStatusFinding('withdrawals.prepareEoaWithdraw')]
      : [];
  if (statuses !== null) {
    const result = checkWithdrawalRequests(
      { chain: ctx.chain },
      [request],
      statuses,
      { address: sender, what: 'the sender' },
    );
    request = result.requests[0];
    checks.push(...result.checks);
  }

  return prepared(ctx, 'eoaWithdraw', {
    to: withdrawalRequest,
    data: concat([pubkey, numberToHex(request.amount / GWEI, { size: 8 })]),
    value: fee,
    checks,
    preview: { ...request, fee },
  });
};

/** The withdrawals module bound to a client context. */
export interface WithdrawalsModule {
  prepareEoaWithdraw: (
    input: PrepareEoaWithdrawInput,
  ) => Promise<Prepared<'eoaWithdraw'>>;
}

/** The withdrawals module, bound to a Context. */
export const createWithdrawalsModule = (ctx: Context): WithdrawalsModule => ({
  prepareEoaWithdraw: async input => await prepareEoaWithdraw(ctx, input),
});
