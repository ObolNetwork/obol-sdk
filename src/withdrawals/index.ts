/**
 * withdrawals: EIP-7002 requests sent by the validator's withdrawal address
 * directly to the predeploy (spec/operations.md "withdrawals.prepareEoaWithdraw").
 */
export {
  createWithdrawalsModule,
  type EoaWithdrawPreview,
  type PrepareEoaWithdrawInput,
  type WithdrawalsModule,
} from './withdrawals.js';

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
