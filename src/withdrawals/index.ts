/**
 * withdrawals module: EIP-7002 requests sent by the validator's withdrawal
 * address directly to the predeploy (spec/operations.md
 * "withdrawals.prepareEoaWithdraw").
 */
import { Type } from '@sinclair/typebox';
import { concat, numberToHex, type Address, type Hex } from 'viem';
import { requireContracts } from '../chains.js';
import { prepared, readRequestFee, resolveRequestFee } from '../chainUtils.js';
import { senderOf, type Context } from '../context.js';
import { checksum, decode, T } from '../schema.js';
import type { Prepared } from '../types.js';
import {
  DepositStatusOptionsSchema,
  statusIfAvailable,
} from '../deposits/status.js';
import {
  requestAmountGwei,
  requestStatusFindings,
  requireFullExitAcknowledged,
} from '../ovm/withdraw.js';

export const PrepareEoaWithdrawInputSchema = Type.Object(
  {
    pubkey: T.Pubkey,
    amount: T.Wei,
    fee: Type.Optional(T.Wei),
    acknowledgeFullExit: Type.Optional(Type.Boolean()),
    from: Type.Optional(T.Address),
    beaconUrl: DepositStatusOptionsSchema.properties.beaconUrl,
    lockHash: DepositStatusOptionsSchema.properties.lockHash,
  },
  { additionalProperties: false },
);
export interface PrepareEoaWithdrawInput {
  pubkey: Hex;
  /** wei, whole gwei; 0 = full exit (needs acknowledgeFullExit). */
  amount: bigint;
  /** Total fee in wei; default exactly the current fee (the predeploy keeps any excess). */
  fee?: bigint;
  acknowledgeFullExit?: boolean;
  /** The sender, for the credentials check; default the wallet account. */
  from?: Address;
  beaconUrl?: string;
  lockHash?: Hex;
}

export interface EoaWithdrawPreview {
  pubkey: Hex;
  amount: bigint;
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
): Promise<Prepared<EoaWithdrawPreview>> => {
  const args = decode(PrepareEoaWithdrawInputSchema, input);
  const { withdrawalRequest } = requireContracts(
    ctx.chain.id,
    'withdrawals.prepareEoaWithdraw',
  );
  const amountGwei = requestAmountGwei(args.amount, 'amount');
  requireFullExitAcknowledged([args.amount], args.acknowledgeFullExit);
  const currentFee = await readRequestFee(ctx.publicClient, withdrawalRequest);
  const fee = resolveRequestFee({
    currentFee,
    requestedFee: args.fee,
    count: 1,
    defaultTo: 'minimum',
  });

  const pubkey = args.pubkey.toLowerCase() as Hex;
  const sender = senderOf(ctx, args.from as Address | undefined);
  const statuses = await statusIfAvailable(ctx, [pubkey], {
    ...(args.beaconUrl !== undefined ? { beaconUrl: args.beaconUrl } : {}),
    ...(args.lockHash !== undefined ? { lockHash: args.lockHash as Hex } : {}),
  });
  const status = statuses?.get(pubkey);
  const checks =
    status !== undefined
      ? requestStatusFindings(
          status,
          args.amount,
          sender !== null
            ? {
                address: checksum(sender),
                code: 'WITHDRAW_CREDENTIALS_NOT_SENDER',
                what: 'the sender',
              }
            : null,
        )
      : [];

  return prepared(ctx, {
    to: withdrawalRequest,
    data: concat([pubkey, numberToHex(amountGwei, { size: 8 })]),
    value: fee,
    checks,
    preview: { pubkey, amount: args.amount, fee },
  });
};

/** The withdrawals module, bound to a Context. */
// The module type is inferred from the bound methods.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createWithdrawalsModule = (ctx: Context) => ({
  prepareEoaWithdraw: async (input: PrepareEoaWithdrawInput) =>
    await prepareEoaWithdraw(ctx, input),
});

export type WithdrawalsModule = ReturnType<typeof createWithdrawalsModule>;
