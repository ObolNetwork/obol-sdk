import { type DepositKind, type ValidatorDeposit } from '../types.js';
import { verifyDepositPayloads } from '../verification/depositPayload.js';

/**
 * Checks deposits before `eoa.deposit` / `splits.deposit` send them, with
 * {@link verifyDepositPayloads} for the deposit kind (default `'deposit'`).
 *
 * @internal
 */
export const verifyDepositsBeforeSend = async (
  deposits: ValidatorDeposit[],
  {
    chainId,
    expectedWithdrawalAddress,
    kind,
  }: {
    chainId: number;
    expectedWithdrawalAddress?: string;
    kind?: DepositKind;
  },
): Promise<void> => {
  await verifyDepositPayloads(deposits, {
    chainId,
    expectedWithdrawalAddress,
    kind: kind ?? 'deposit',
  });
};
