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
  assertDepositData,
  type AssertDepositDataOptions,
} from './assertDepositData.js';

export { fromLock, assertDepositData };
export { depositDataRoot } from './assertDepositData.js';
export {
  MAX_COMPOUNDING_DEPOSIT,
  MAX_DEPOSIT,
  MIN_DEPOSIT,
} from './assertDepositData.js';
export { BATCH_DEPOSIT_SIZE } from './prepareDeposit.js';
export type { FromLockOptions, LockDeposits } from './fromLock.js';
export type { DepositPreview, PrepareDepositInput } from './prepareDeposit.js';
export type {
  DepositStatus,
  DepositStatusName,
  DepositStatusOptions,
  PendingDeposit,
} from './status.js';
export type { AssertDepositDataOptions } from './assertDepositData.js';

/** The deposits module bound to a client context. */
export interface DepositsModule {
  fromLock: (
    lock: Parameters<typeof fromLock>[0],
    options?: FromLockOptions,
  ) => Promise<LockDeposits>;
  assertDepositData: (
    deposits: readonly DepositInput[],
    options?: Partial<AssertDepositDataOptions>,
  ) => Promise<void>;
  /**
   * What the beacon chain has for each pubkey: `new`, `queued` (EIP-6110 pending deposits or
   * a pending registry entry), `active` or `exited`, with credentials, balances and epochs
   * when known. From the Obol API, else a beacon node (`beaconUrl`), which is first checked
   * to be on the client chain and in sync. A failed or untrusted source: STATUS_UNAVAILABLE.
   *
   * @see spec/operations.md "deposits.status"
   */
  status: (
    pubkeys: readonly string[],
    options?: DepositStatusOptions,
  ) => Promise<DepositStatus[]>;
  /**
   * Prepares deposits via an OVM (`via: { ovm }`) or the batch deposit contract
   * (`via: { batch: true }`). Checks the deposit data, OVM provenance (on chain) and the
   * sender's DEPOSIT role, and, with a status source, that a `kind: 'deposit'` validator
   * does not exist yet (DEPOSIT_VALIDATOR_EXISTS, or DEPOSIT_CONFLICT when its credentials
   * are someone else's). Returns one `Prepared` per transaction (OVM deposits one each;
   * one per 500 deposits via the batch contract.
   *
   * @throws ObolError DEPOSIT_INVALID, DEPOSIT_CONFLICT, DEPOSIT_VALIDATOR_EXISTS, OVM_NOT_OBOL,
   * PROVENANCE_UNKNOWN, OVM_ROLE_MISSING, STATUS_UNAVAILABLE
   * @see spec/operations.md "deposits.prepareDeposit"
   */
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
  assertDepositData: async (deposits, options = {}) => {
    await assertDepositData(deposits, { chainId: ctx.chain.id, ...options });
  },
  status: async (pubkeys, options) =>
    await getDepositStatus(ctx, pubkeys, options),
  prepareDeposit: async input => await prepareDeposit(ctx, input),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
