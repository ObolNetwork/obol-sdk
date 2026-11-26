/**
 * ovm module: ObolValidatorManager reads and writes (spec/operations.md
 * "ovm"). The namespace exports the pure helpers, the types and
 * `createOvmModule`; the client binds the rest to its context.
 */
import type { Context } from '../context.js';
import type { Prepared, PreviewResult } from '../types.js';
import { expectedWithdrawalCredentials } from './credentials.js';
import {
  previewDistribute,
  prepareDistribute,
  type DistributePreview,
  type PrepareDistributeInput,
} from './distribute.js';
import {
  prepareCancelOwnershipHandover,
  prepareCompleteOwnershipHandover,
  prepareGrantRoles,
  prepareRecoverFunds,
  prepareRenounceRoles,
  prepareRequestOwnershipHandover,
  prepareRevokeRoles,
  prepareSetAmountOfPrincipalStake,
  prepareSetPrincipalRecipient,
  prepareSetRewardRecipient,
  prepareSweep,
  prepareTransfer,
  prepareWithdrawPullBalance,
  type CompleteOwnershipHandoverInput,
  type GrantRolesInput,
  type OvmOnlyInput,
  type RecoverFundsInput,
  type RenounceRolesInput,
  type RevokeRolesInput,
  type SetAmountOfPrincipalStakeInput,
  type SetPrincipalRecipientInput,
  type SetRewardRecipientInput,
  type SweepInput,
  type TransferInput,
  type WithdrawPullBalanceInput,
} from './roles.js';
import {
  OVM_ALL_ROLES,
  OVM_ROLES,
  ovmRouting,
  roleNames,
  type OvmRouting,
  type OvmRoutingInput,
  type OvmRoleName,
} from './routing.js';
import {
  getOvmRoleHolders,
  getOvmState,
  getOvmValidators,
  type OvmRoleHolders,
  type OvmState,
  type OvmValidators,
} from './state.js';
import {
  getOvmProvenance,
  type OvmProvenance,
  type OvmProvenanceOptions,
} from './provenance.js';
import {
  prepareConsolidate,
  prepareWithdraw,
  type PrepareConsolidateInput,
  type PrepareWithdrawInput,
} from './withdraw.js';

export {
  expectedWithdrawalCredentials,
  OVM_ALL_ROLES,
  OVM_ROLES,
  ovmRouting as routing,
  roleNames,
};
export { MAX_CONSOLIDATION_SOURCES } from './withdraw.js';
export {
  MIN_ACTIVATION_BALANCE,
  SHARD_COMMITTEE_PERIOD,
} from './requestRules.js';
export type {
  DistributePreview,
  PrepareDistributeInput,
} from './distribute.js';
export type {
  CompleteOwnershipHandoverInput,
  GrantRolesInput,
  OvmOnlyInput,
  OvmWritePreview,
  RecoverFundsInput,
  RenounceRolesInput,
  RevokeRolesInput,
  SetAmountOfPrincipalStakeInput,
  SetPrincipalRecipientInput,
  SetPrincipalStakePreview,
  SetRewardRecipientInput,
  SweepInput,
  TransferInput,
  WithdrawPullBalanceInput,
  WithdrawPullBalancePreview,
} from './roles.js';
export type { OvmRoleName, OvmRouting, OvmRoutingInput } from './routing.js';
export type {
  OvmRoleHolder,
  OvmRoleHolders,
  OvmState,
  OvmValidator,
  OvmValidators,
} from './state.js';
export type { OvmProvenance, OvmProvenanceOptions } from './provenance.js';
export type {
  ConsolidatePreview,
  PrepareConsolidateInput,
  PrepareWithdrawInput,
  WithdrawPreview,
  WithdrawRequestPreview,
} from './withdraw.js';

/** The ovm module bound to a client context. */
export interface OvmModule {
  OVM_ROLES: typeof OVM_ROLES;
  /**
   * Every role bit of `OVM_ROLES` set.
   */
  OVM_ALL_ROLES: bigint;
  /**
   * Pure: the names of the role bits set in `roles` (`OVM_ROLES`).
   */
  roleNames: (roles: bigint) => OvmRoleName[];
  /**
   * Pure: how a distribution would route `balance` between the principal and reward
   * recipients, given the principal stake and threshold (as `getState` computes).
   *
   * @see spec/operations.md "ovm.getState"
   */
  routing: (input: OvmRoutingInput) => OvmRouting;
  expectedWithdrawalCredentials: typeof expectedWithdrawalCredentials;
  /**
   * Where a contract came from: `obol` when the Obol OVM factory created it, `notObol`, or
   * `unknown` when that could not be checked. `source` says who vouches: `chain` (the factory's
   * creation log) or `api` (the Obol API alone; refused with `requireChain: true`). Called by
   * every OVM write and deposit.
   *
   * @example
   * ```ts
   * const { status } = await obol.ovm.getProvenance(ovmAddress);
   * ```
   * @see spec/operations.md "ovm.getProvenance"
   */
  getProvenance: (
    ovm: string,
    options?: OvmProvenanceOptions,
  ) => Promise<OvmProvenance>;
  /** null when the address is not an OVM; checks shape, not origin (use `getProvenance`). */
  getState: (ovm: string) => Promise<OvmState | null>;
  /**
   * The owner and every address holding a role, read with `rolesOf` on chain (candidates
   * from the Obol API or `RolesUpdated` logs). Reports PUBLIC_FORWARDER_HOLDS_ROLE in
   * `findings`.
   *
   * @see spec/operations.md "ovm.getRoleHolders"
   */
  getRoleHolders: (ovm: string) => Promise<OvmRoleHolders>;
  /**
   * Every validator whose credentials (or queued deposit's credentials) point at the OVM,
   * plus undeposited validators of its locks, with status and balance (Obol API).
   *
   * @see spec/operations.md "ovm.getValidators"
   */
  getValidators: (ovm: string) => Promise<OvmValidators>;
  /**
   * EIP-7002 withdrawal requests through the OVM: a partial amount, or 0 for a full exit
   * (needs `acknowledgeFullExit: true`). Checks provenance, the WITHDRAWAL role, the fee and,
   * with a status source, every beacon chain rule that would make the chain ignore the
   * request and keep the fee (VALIDATOR_NOT_ACTIVE, CREDENTIALS_NOT_SOURCE, VALIDATOR_EXITING,
   * VALIDATOR_TOO_NEW, ...). Rules it could not check: VALIDATOR_STATUS_UNCHECKED (warning).
   *
   * @example
   * ```ts
   * const tx = await obol.ovm.prepareWithdraw({ ovm, requests: [{ pubkey, amount: parseEther('1') }] });
   * ```
   * @see spec/operations.md "ovm.prepareWithdraw"
   */
  prepareWithdraw: (
    input: PrepareWithdrawInput,
  ) => Promise<Prepared<'withdraw'>>;
  /**
   * EIP-7251 consolidation requests through the OVM. A source equal to its target switches
   * that validator to 0x02 (compounding). A target with another withdrawal address is
   * allowed by the chain but moves the stake out of this OVM: CONSOLIDATION_CREDENTIALS_DIFFER
   * (warning), which `send` asks to be acknowledged.
   *
   * @see spec/operations.md "ovm.prepareConsolidate"
   */
  prepareConsolidate: (
    input: PrepareConsolidateInput,
  ) => Promise<Prepared<'consolidate'>>;
  /**
   * Distributes the OVM's balance to its principal and reward recipients (`distributeFunds`,
   * or `distributeFundsPull` with `mode: 'pull'`). Anyone may send it. Nothing to pay:
   * NOTHING_TO_DISTRIBUTE. To also distribute the splits behind the recipients use
   * `splits.prepareDistributeAll`.
   *
   * @see spec/operations.md "ovm.prepareDistribute"
   */
  prepareDistribute: (
    input: PrepareDistributeInput,
  ) => Promise<Prepared<'distribute'>>;
  /**
   * The reads and routing of `prepareDistribute` without a transaction; zeros instead of
   * NOTHING_TO_DISTRIBUTE, so a page can show the figures with the button disabled.
   *
   * @see spec/operations.md "ovm.prepareDistribute"
   */
  previewDistribute: (
    input: PrepareDistributeInput,
  ) => Promise<PreviewResult<DistributePreview>>;
  /**
   * Grants `roles` to `user` (`grantRoles`); owner only. Reports ROLE_GRANT_CONSOLIDATION
   * and ROLE_GRANT_DEPOSIT_TO_PRINCIPAL (warnings) for the grants that can move the stake.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareGrantRoles: (input: GrantRolesInput) => Promise<Prepared<'role'>>;
  /**
   * Revokes `roles` from `user` (`revokeRoles`); owner only.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareRevokeRoles: (input: RevokeRolesInput) => Promise<Prepared<'role'>>;
  /**
   * Gives up the sender's own `roles` (`renounceRoles`).
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareRenounceRoles: (
    input: RenounceRolesInput,
  ) => Promise<Prepared<'role'>>;
  /**
   * Requests ownership, sent by the future owner (`requestOwnershipHandover`); valid for
   * 48 hours.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareRequestOwnershipHandover: (
    input: OvmOnlyInput,
  ) => Promise<Prepared<'ownership'>>;
  /**
   * Cancels the sender's pending ownership request (`cancelOwnershipHandover`).
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareCancelOwnershipHandover: (
    input: OvmOnlyInput,
  ) => Promise<Prepared<'ownership'>>;
  /**
   * Hands ownership to `pendingOwner` after its request (`completeOwnershipHandover`);
   * owner only. OWNERSHIP_HANDOVER_NOT_PENDING without an unexpired request; roles survive
   * (ROLES_SURVIVE_TRANSFER).
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareCompleteOwnershipHandover: (
    input: CompleteOwnershipHandoverInput,
  ) => Promise<Prepared<'ownership'>>;
  /**
   * Sets a new owner and principal recipient in one call (`transfer`); owner only. Roles
   * survive (ROLES_SURVIVE_TRANSFER).
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareTransfer: (input: TransferInput) => Promise<Prepared<'ownership'>>;
  /** Sets the principal recipient (the contract's `setBeneficiary`). */
  prepareSetPrincipalRecipient: (
    input: SetPrincipalRecipientInput,
  ) => Promise<Prepared<'recipient'>>;
  /**
   * Sets the reward recipient (`setRewardRecipient`); owner or SET_REWARD.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareSetRewardRecipient: (
    input: SetRewardRecipientInput,
  ) => Promise<Prepared<'recipient'>>;
  /**
   * Sets `amountOfPrincipalStake` (`setAmountOfPrincipalStake`); owner or SET_BENEFICIARY.
   * The preview shows `current`, `next` and `delta`: raising it by 32 ETH pays the reward
   * recipients 32 ETH less at the next distribution.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareSetAmountOfPrincipalStake: (
    input: SetAmountOfPrincipalStakeInput,
  ) => Promise<Prepared<'principalStake'>>;
  /**
   * Sends the principal recipient's pull balance (`sweep`): to the principal recipient by
   * anyone, or to `to` by the owner. `amount` 0 sweeps all.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareSweep: (input: SweepInput) => Promise<Prepared<'sweep'>>;
  /**
   * Pays out `account`'s pull balance (`withdrawPullBalance`); anyone may send it.
   * NOTHING_TO_DISTRIBUTE when it is 0.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareWithdrawPullBalance: (
    input: WithdrawPullBalanceInput,
  ) => Promise<Prepared<'withdrawPullBalance'>>;
  /**
   * Recovers `token` sent to the OVM by mistake to `recipient` (`recoverFunds`); owner or
   * RECOVER_FUNDS.
   *
   * @see spec/operations.md "ovm role and ownership writes"
   */
  prepareRecoverFunds: (
    input: RecoverFundsInput,
  ) => Promise<Prepared<'recoverFunds'>>;
}

/** The ovm module, bound to a Context. */
export const createOvmModule = (ctx: Context): OvmModule => ({
  OVM_ROLES,
  OVM_ALL_ROLES,
  roleNames,
  routing: ovmRouting,
  expectedWithdrawalCredentials,
  getProvenance: async (ovm, options) =>
    await getOvmProvenance(ctx, ovm, options),
  getState: async ovm => await getOvmState(ctx, ovm),
  getRoleHolders: async ovm => await getOvmRoleHolders(ctx, ovm),
  getValidators: async ovm => await getOvmValidators(ctx, ovm),
  prepareWithdraw: async input => await prepareWithdraw(ctx, input),
  prepareConsolidate: async input => await prepareConsolidate(ctx, input),
  prepareDistribute: async input => await prepareDistribute(ctx, input),
  previewDistribute: async input => await previewDistribute(ctx, input),
  prepareGrantRoles: async input => await prepareGrantRoles(ctx, input),
  prepareRevokeRoles: async input => await prepareRevokeRoles(ctx, input),
  prepareRenounceRoles: async input => await prepareRenounceRoles(ctx, input),
  prepareRequestOwnershipHandover: async input =>
    await prepareRequestOwnershipHandover(ctx, input),
  prepareCancelOwnershipHandover: async input =>
    await prepareCancelOwnershipHandover(ctx, input),
  prepareCompleteOwnershipHandover: async input =>
    await prepareCompleteOwnershipHandover(ctx, input),
  prepareTransfer: async input => await prepareTransfer(ctx, input),
  prepareSetPrincipalRecipient: async input =>
    await prepareSetPrincipalRecipient(ctx, input),
  prepareSetRewardRecipient: async input =>
    await prepareSetRewardRecipient(ctx, input),
  prepareSetAmountOfPrincipalStake: async input =>
    await prepareSetAmountOfPrincipalStake(ctx, input),
  prepareSweep: async input => await prepareSweep(ctx, input),
  prepareWithdrawPullBalance: async input =>
    await prepareWithdrawPullBalance(ctx, input),
  prepareRecoverFunds: async input => await prepareRecoverFunds(ctx, input),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
