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
import { verifyOvm, type OvmVerification } from './verify.js';
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
export type { OvmVerification } from './verify.js';
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
  OVM_ALL_ROLES: bigint;
  roleNames: (roles: bigint) => OvmRoleName[];
  routing: (input: OvmRoutingInput) => OvmRouting;
  expectedWithdrawalCredentials: typeof expectedWithdrawalCredentials;
  verify: (ovm: string) => Promise<OvmVerification>;
  /** null when the address is not an OVM; checks shape, not origin (use `verify`). */
  getState: (ovm: string) => Promise<OvmState | null>;
  getRoleHolders: (ovm: string) => Promise<OvmRoleHolders>;
  getValidators: (ovm: string) => Promise<OvmValidators>;
  prepareWithdraw: (
    input: PrepareWithdrawInput,
  ) => Promise<Prepared<'withdraw'>>;
  prepareConsolidate: (
    input: PrepareConsolidateInput,
  ) => Promise<Prepared<'consolidate'>>;
  prepareDistribute: (
    input: PrepareDistributeInput,
  ) => Promise<Prepared<'distribute'>>;
  previewDistribute: (
    input: PrepareDistributeInput,
  ) => Promise<PreviewResult<DistributePreview>>;
  prepareGrantRoles: (input: GrantRolesInput) => Promise<Prepared<'role'>>;
  prepareRevokeRoles: (input: RevokeRolesInput) => Promise<Prepared<'role'>>;
  prepareRenounceRoles: (
    input: RenounceRolesInput,
  ) => Promise<Prepared<'role'>>;
  prepareRequestOwnershipHandover: (
    input: OvmOnlyInput,
  ) => Promise<Prepared<'ownership'>>;
  prepareCancelOwnershipHandover: (
    input: OvmOnlyInput,
  ) => Promise<Prepared<'ownership'>>;
  prepareCompleteOwnershipHandover: (
    input: CompleteOwnershipHandoverInput,
  ) => Promise<Prepared<'ownership'>>;
  prepareTransfer: (input: TransferInput) => Promise<Prepared<'ownership'>>;
  /** Sets the principal recipient (the contract's `setBeneficiary`). */
  prepareSetPrincipalRecipient: (
    input: SetPrincipalRecipientInput,
  ) => Promise<Prepared<'recipient'>>;
  prepareSetRewardRecipient: (
    input: SetRewardRecipientInput,
  ) => Promise<Prepared<'recipient'>>;
  prepareSetAmountOfPrincipalStake: (
    input: SetAmountOfPrincipalStakeInput,
  ) => Promise<Prepared<'principalStake'>>;
  prepareSweep: (input: SweepInput) => Promise<Prepared<'sweep'>>;
  prepareWithdrawPullBalance: (
    input: WithdrawPullBalanceInput,
  ) => Promise<Prepared<'withdrawPullBalance'>>;
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
  verify: async ovm => await verifyOvm(ctx, ovm),
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
