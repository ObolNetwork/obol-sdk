import { type ValidatorDeposit } from '../types.js';
import { DepositConflictError } from '../errors.js';
import { verifyDepositPayloads } from '../verification/depositPayload.js';
import { checkExistingDeposits } from './existingDeposits.js';

/**
 * Checks deposits before `eoa.deposit` / `splits.deposit` send them.
 *
 * Without `beaconUrl`, runs {@link verifyDepositPayloads} with the given
 * options. With `beaconUrl`, first runs {@link checkExistingDeposits}: any
 * `conflict` verdict throws a {@link DepositConflictError}. For `top_up`
 * deposits the signature check is skipped and the withdrawal credentials must
 * be the expected ones or all zero; every other deposit must have a valid
 * signature (`skipSignatureVerification` is not applied).
 *
 * @internal
 */
export const verifyDepositsBeforeSend = async (
  deposits: ValidatorDeposit[],
  {
    chainId,
    expectedWithdrawalAddress,
    skipSignatureVerification,
    beaconUrl,
  }: {
    chainId: number;
    expectedWithdrawalAddress?: string;
    skipSignatureVerification?: boolean;
    beaconUrl?: string;
  },
): Promise<void> => {
  if (beaconUrl === undefined) {
    await verifyDepositPayloads(deposits, {
      chainId,
      expectedWithdrawalAddress,
      skipSignatureVerification,
    });
    return;
  }

  const checks = await checkExistingDeposits(deposits, { beaconUrl });
  const conflicts = checks.filter(check => check.status === 'conflict');
  if (conflicts.length > 0) {
    throw new DepositConflictError(conflicts);
  }

  const topUps = new Set<number>();
  checks.forEach((check, index) => {
    if (check.status === 'top_up') {
      topUps.add(index);
    }
  });

  await verifyDepositPayloads(deposits, {
    chainId,
    expectedWithdrawalAddress,
    topUps,
  });
};
