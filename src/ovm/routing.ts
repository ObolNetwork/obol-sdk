/**
 * OVM distribution routing, as ObolValidatorManager._distributeFunds
 * (vectors distribution.json `routing`). Pure.
 */
import { GWEI } from '../units.js';

export interface OvmRoutingInput {
  balance: bigint;
  fundsPendingWithdrawal: bigint;
  amountOfPrincipalStake: bigint;
  /** wei */
  principalThreshold: bigint;
}

export interface OvmRouting {
  distributable: bigint;
  principalPayout: bigint;
  rewardPayout: bigint;
}

export const ovmRouting = (input: OvmRoutingInput): OvmRouting => {
  const distributable =
    input.balance > input.fundsPendingWithdrawal
      ? input.balance - input.fundsPendingWithdrawal
      : 0n;
  if (
    distributable >= input.principalThreshold &&
    input.amountOfPrincipalStake > 0n
  ) {
    const principalPayout =
      distributable > input.amountOfPrincipalStake
        ? input.amountOfPrincipalStake
        : distributable;
    return {
      distributable,
      principalPayout,
      rewardPayout: distributable - principalPayout,
    };
  }
  return { distributable, principalPayout: 0n, rewardPayout: distributable };
};

/** The contract stores the threshold in gwei. */
export const thresholdGweiToWei = (gwei: bigint): bigint => gwei * GWEI;

/** OVM role bits (match the contract constants). */
export const OVM_ROLES = {
  WITHDRAWAL: 0x01n,
  CONSOLIDATION: 0x02n,
  SET_BENEFICIARY: 0x04n,
  RECOVER_FUNDS: 0x08n,
  SET_REWARD: 0x10n,
  DEPOSIT: 0x20n,
} as const;

export type OvmRoleName = keyof typeof OVM_ROLES;

export const OVM_ALL_ROLES = Object.values(OVM_ROLES).reduce(
  (a, b) => a | b,
  0n,
);

export const roleNames = (roles: bigint): OvmRoleName[] =>
  (Object.keys(OVM_ROLES) as OvmRoleName[]).filter(
    name => (roles & OVM_ROLES[name]) !== 0n,
  );
