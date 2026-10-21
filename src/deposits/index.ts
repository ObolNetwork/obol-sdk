/** deposits: deposit data, deposit status and deposit transactions (spec/operations.md "deposits"). */
import type { Context } from '../context.js';
import type { DepositInput, Prepared } from '../types.js';
import {
  fromLock,
  type FromLockOptions,
  type LockDeposits,
} from './fromLock.js';
import { prepareDeposit, type PrepareDepositInput } from './prepareDeposit.js';
import {
  getDepositStatus,
  type DepositStatus,
  type DepositStatusOptions,
} from './status.js';
import {
  verifyDepositData,
  type VerifyDepositDataOptions,
} from './verifyDepositData.js';

export { fromLock, verifyDepositData };
export { depositDataRoot } from './verifyDepositData.js';
export {
  MAX_COMPOUNDING_DEPOSIT,
  MAX_DEPOSIT,
  MIN_DEPOSIT,
} from './verifyDepositData.js';
export { BATCH_DEPOSIT_SIZE } from './prepareDeposit.js';
export type { FromLockOptions, LockDeposits } from './fromLock.js';
export type { DepositPreview, PrepareDepositInput } from './prepareDeposit.js';
export type {
  DepositStatus,
  DepositStatusName,
  DepositStatusOptions,
  PendingDeposit,
} from './status.js';
export type { VerifyDepositDataOptions } from './verifyDepositData.js';

/** The deposits module bound to a client context. */
export interface DepositsModule {
  fromLock: (
    lock: Parameters<typeof fromLock>[0],
    options?: FromLockOptions,
  ) => Promise<LockDeposits>;
  verifyDepositData: (
    deposits: readonly DepositInput[],
    options?: Partial<VerifyDepositDataOptions>,
  ) => Promise<void>;
  status: (
    pubkeys: readonly string[],
    options?: DepositStatusOptions,
  ) => Promise<DepositStatus[]>;
  prepareDeposit: (
    input: PrepareDepositInput,
  ) => Promise<Array<Prepared<'deposit'>>>;
}

/** The deposits module, bound to a Context (chain and publicClient filled in). */
export const createDepositsModule = (ctx: Context): DepositsModule => ({
  fromLock: async (lock, options = {}) =>
    await fromLock(lock, {
      chainId: ctx.chain.id,
      publicClient: ctx.publicClient,
      ...options,
    }),
  verifyDepositData: async (deposits, options = {}) => {
    await verifyDepositData(deposits, { chainId: ctx.chain.id, ...options });
  },
  status: async (pubkeys, options) =>
    await getDepositStatus(ctx, pubkeys, options),
  prepareDeposit: async input => await prepareDeposit(ctx, input),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
