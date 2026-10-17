import { parseUnits } from 'ethers';
import { type ProviderType } from './types.js';

/** EIP-7002 withdrawal request predeploy (same address on every chain). */
export const WITHDRAWAL_REQUEST_CONTRACT_ADDRESS =
  '0x00000961Ef480Eb55e80D19ad83579A64c007002';

// A caller-supplied fee may exceed the current fee (to absorb a fee increase
// before inclusion), but not by more than this factor or the floor below.
const MAX_FEE_MULTIPLIER = BigInt(10);
const MAX_FEE_FLOOR = parseUnits('1', 'gwei');
// When no fee is supplied, send twice the current fee for the same reason.
const DEFAULT_FEE_MULTIPLIER = BigInt(2);

/**
 * Reads the current per-request fee (wei) from the EIP-7002 withdrawal
 * request contract. A call with empty calldata returns the fee.
 */
export const getWithdrawalRequestFee = async (
  provider: ProviderType,
  contractAddress: string = WITHDRAWAL_REQUEST_CONTRACT_ADDRESS,
): Promise<bigint> => {
  let result: string;
  try {
    result = await provider.call({ to: contractAddress, data: '0x' });
  } catch (error) {
    throw Object.assign(
      new Error('Failed to read the withdrawal request fee'),
      { cause: error },
    );
  }
  if (!result || result === '0x') {
    throw new Error('Failed to read the withdrawal request fee');
  }
  return BigInt(result);
};

/**
 * Returns the total fee (wei) to send for `requestCount` withdrawal requests.
 *
 * Without `requestedFee`, returns `defaultMultiplier` (default 2) times the
 * current fee per request. Headroom only makes sense where the excess is
 * refunded (the OVM refunds it; the EIP-7002 contract itself does not). With
 * `requestedFee` (a total for all requests), returns it unchanged after
 * checking it covers the current fee and is not more than
 * max(10x the current fee, 1 gwei) per request.
 */
export const resolveWithdrawalFee = ({
  currentFee,
  requestedFee,
  requestCount = 1,
  defaultMultiplier = DEFAULT_FEE_MULTIPLIER,
}: {
  currentFee: bigint;
  requestedFee?: string;
  requestCount?: number;
  defaultMultiplier?: bigint;
}): bigint => {
  const count = BigInt(requestCount);
  if (requestedFee === undefined) {
    return currentFee * defaultMultiplier * count;
  }

  const requested = BigInt(requestedFee);
  const minimum = currentFee * count;
  if (requested < minimum) {
    throw new Error(
      `Withdrawal fee ${requested} wei is below the current withdrawal request fee of ${minimum} wei`,
    );
  }

  const perRequestCap =
    currentFee * MAX_FEE_MULTIPLIER > MAX_FEE_FLOOR
      ? currentFee * MAX_FEE_MULTIPLIER
      : MAX_FEE_FLOOR;
  const maximum = perRequestCap * count;
  if (requested > maximum) {
    throw new Error(
      `Withdrawal fee ${requested} wei is far above the current withdrawal request fee of ${minimum} wei (maximum accepted: ${maximum} wei)`,
    );
  }
  return requested;
};
