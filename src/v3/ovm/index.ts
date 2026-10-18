/**
 * ovm module: ObolValidatorManager reads and writes (spec/operations.md
 * "ovm"). Pure helpers are plain exports; `createOvmModule` binds the rest
 * to a Context.
 */
import type { Address } from 'viem';
import type { Context } from '../context.js';
import { expectedWithdrawalCredentials } from './credentials.js';
import {
  previewDistribute,
  prepareDistribute,
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
  prepareSetBeneficiary,
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
  type SetBeneficiaryInput,
  type SetRewardRecipientInput,
  type SweepInput,
  type TransferInput,
  type WithdrawPullBalanceInput,
} from './roles.js';
import { OVM_ALL_ROLES, OVM_ROLES, ovmRouting, roleNames } from './routing.js';
import { getOvmRoleHolders, getOvmState, getOvmValidators } from './state.js';
import { verifyOvm } from './verify.js';
import {
  prepareConsolidate,
  prepareWithdraw,
  type PrepareConsolidateInput,
  type PrepareWithdrawInput,
} from './withdraw.js';

export * from './credentials.js';
export * from './distribute.js';
export * from './roles.js';
export * from './routing.js';
export * from './state.js';
export * from './verify.js';
export * from './withdraw.js';

/** The ovm module, bound to a Context. */
// The module type is inferred from the bound methods.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const createOvmModule = (ctx: Context) => ({
  OVM_ROLES,
  OVM_ALL_ROLES,
  roleNames,
  routing: ovmRouting,
  expectedWithdrawalCredentials,
  verify: async (ovm: Address) => await verifyOvm(ctx, ovm),
  getState: async (ovm: Address) => await getOvmState(ctx, ovm),
  getRoleHolders: async (ovm: Address) => await getOvmRoleHolders(ctx, ovm),
  getValidators: async (ovm: Address) => await getOvmValidators(ctx, ovm),
  prepareWithdraw: async (input: PrepareWithdrawInput) =>
    await prepareWithdraw(ctx, input),
  prepareConsolidate: async (input: PrepareConsolidateInput) =>
    await prepareConsolidate(ctx, input),
  prepareDistribute: async (input: PrepareDistributeInput) =>
    await prepareDistribute(ctx, input),
  previewDistribute: async (input: PrepareDistributeInput) =>
    await previewDistribute(ctx, input),
  prepareGrantRoles: async (input: GrantRolesInput) =>
    await prepareGrantRoles(ctx, input),
  prepareRevokeRoles: async (input: RevokeRolesInput) =>
    await prepareRevokeRoles(ctx, input),
  prepareRenounceRoles: async (input: RenounceRolesInput) =>
    await prepareRenounceRoles(ctx, input),
  prepareRequestOwnershipHandover: async (input: OvmOnlyInput) =>
    await prepareRequestOwnershipHandover(ctx, input),
  prepareCancelOwnershipHandover: async (input: OvmOnlyInput) =>
    await prepareCancelOwnershipHandover(ctx, input),
  prepareCompleteOwnershipHandover: async (
    input: CompleteOwnershipHandoverInput,
  ) => await prepareCompleteOwnershipHandover(ctx, input),
  prepareTransfer: async (input: TransferInput) =>
    await prepareTransfer(ctx, input),
  prepareSetBeneficiary: async (input: SetBeneficiaryInput) =>
    await prepareSetBeneficiary(ctx, input),
  prepareSetRewardRecipient: async (input: SetRewardRecipientInput) =>
    await prepareSetRewardRecipient(ctx, input),
  prepareSetAmountOfPrincipalStake: async (
    input: SetAmountOfPrincipalStakeInput,
  ) => await prepareSetAmountOfPrincipalStake(ctx, input),
  prepareSweep: async (input: SweepInput) => await prepareSweep(ctx, input),
  prepareWithdrawPullBalance: async (input: WithdrawPullBalanceInput) =>
    await prepareWithdrawPullBalance(ctx, input),
  prepareRecoverFunds: async (input: RecoverFundsInput) =>
    await prepareRecoverFunds(ctx, input),
});

export type OvmModule = ReturnType<typeof createOvmModule>;
