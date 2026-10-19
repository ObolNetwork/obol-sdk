import type { Context } from '../context.js';
import type { Deposit, Hex } from '../types.js';
import { fromLock, type FromLockOptions } from './fromLock.js';
import { prepareDeposit, type PrepareDepositInput } from './prepareDeposit.js';
import { getDepositStatus, type DepositStatusOptions } from './status.js';
import {
  verifyDepositData,
  type VerifyDepositDataOptions,
} from './verifyDepositData.js';

export * from './fromLock.js';
export * from './prepareDeposit.js';
export * from './status.js';
export * from './verifyDepositData.js';

export interface DepositsModule {
  fromLock: (
    lock: Parameters<typeof fromLock>[0],
    options?: FromLockOptions,
  ) => ReturnType<typeof fromLock>;
  verifyDepositData: (
    deposits: Deposit[],
    options?: Partial<VerifyDepositDataOptions>,
  ) => Promise<void>;
  status: (
    pubkeys: Hex[],
    options?: DepositStatusOptions,
  ) => ReturnType<typeof getDepositStatus>;
  prepareDeposit: (
    input: PrepareDepositInput,
  ) => ReturnType<typeof prepareDeposit>;
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
