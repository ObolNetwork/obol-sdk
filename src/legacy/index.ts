/**
 * legacy module: reads of existing OptimisticWithdrawalRecipient (OWR)
 * contracts. v3 does not create OWR or SplitMain v1 contracts.
 */
import type { Address } from 'viem';
import { owrAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import {
  chainReadFailed,
  contractNotAvailable,
  getCodeKind,
} from '../chainUtils.js';
import type { Context } from '../context.js';
import { checksum, decode, T } from '../schema.js';

export interface OwrTranches {
  principalRecipient: Address;
  rewardRecipient: Address;
  /** wei */
  amountOfPrincipalStake: bigint;
}

/**
 * legacy.getOwrTranches (`chain`): `getTranches()` of an existing OWR.
 * CONTRACT_NOT_AVAILABLE if the address has no contract code;
 * CHAIN_READ_FAILED if the call fails.
 */
export const getOwrTranches = async (
  ctx: Context,
  input: Address,
): Promise<OwrTranches> => {
  const owr = checksum(decode(T.Address, input, 'owr'));
  requireContracts(ctx.chain.id, 'legacy.getOwrTranches');
  let kind;
  try {
    kind = await getCodeKind(ctx.publicClient, owr);
  } catch (cause) {
    throw chainReadFailed(`the code at ${owr}`, cause);
  }
  if (kind !== 'contract') throw contractNotAvailable(owr, 'The OWR');
  let result: readonly [Address, Address, bigint];
  try {
    result = await ctx.publicClient.readContract({
      address: owr,
      abi: owrAbi,
      functionName: 'getTranches',
    });
  } catch (cause) {
    throw chainReadFailed(`getTranches() of ${owr}`, cause);
  }
  return {
    principalRecipient: checksum(result[0]),
    rewardRecipient: checksum(result[1]),
    amountOfPrincipalStake: result[2],
  };
};

/** The legacy module, bound to a Context. */
// The module type is inferred from the bound methods.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createLegacyModule = (ctx: Context) => ({
  getOwrTranches: async (owr: Address) => await getOwrTranches(ctx, owr),
});

export type LegacyModule = ReturnType<typeof createLegacyModule>;
