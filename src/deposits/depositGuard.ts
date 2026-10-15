import { type ValidatorDeposit } from '../types.js';
import { DepositConflictError } from '../errors.js';
import { verifyDepositPayloads } from '../verification/depositPayload.js';
import { checkExistingDeposits } from './existingDeposits.js';

/**
 * Checks deposits before `eoa.deposit` / `splits.deposit` send them.
 *
 * Without `beaconUrl`, runs {@link verifyDepositPayloads} with the given
 * options (`skipSignatureVerification` treats every deposit as a top-up). With `beaconUrl`, first runs {@link checkExistingDeposits}: any
 * `conflict` verdict throws a {@link DepositConflictError}. For `top_up`
 * deposits the signature check is skipped and the withdrawal credentials must
 * be the expected ones or all zero, and the maximum amount follows the
 * existing validator's credentials (2048 ETH for 0x02, else 32 ETH); every
 * other deposit must have a valid signature (`skipSignatureVerification` is
 * not applied).
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

  // Top-up index → the existing validator's withdrawal credentials.
  const topUps = new Map<number, string>();
  checks.forEach((check, index) => {
    if (check.status === 'top_up') {
      topUps.set(index, check.existing?.withdrawal_credentials ?? '');
    }
  });

  await verifyDepositPayloads(deposits, {
    chainId,
    expectedWithdrawalAddress,
    topUps,
  });
};
