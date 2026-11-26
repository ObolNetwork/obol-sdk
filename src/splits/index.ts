/** splits: 0xSplits v2 PullSplits (spec/operations.md "splits"). */
import type { Address } from 'viem';
import type { Context } from '../context.js';
import type { Prepared, PreviewResult } from '../types.js';
import {
  predictSplit,
  prepareCreateSplit,
  type CreateSplitInput,
  type PredictSplitInput,
} from './create.js';
import {
  distributionFromReceipt,
  prepareDistributeAll,
  previewDistributeAll,
  type DistributeAllInput,
  type DistributeAllPreview,
  type DistributionReceipt,
  type DistributionResult,
} from './distribution.js';
import { getSplit, type GetSplitInput, type SplitInfo } from './getSplit.js';
import { formatPercent, percent, splitParams } from './shares.js';

export {
  DEFAULT_SPLIT_SALT,
  type CreateSplitInput,
  type CreateSplitPreview,
  type PredictSplitInput,
} from './create.js';
export {
  distributionFromReceipt,
  type DistributeAllInput,
  type DistributeAllPreview,
  type DistributionReceipt,
  type DistributionResult,
  type SkipReason,
} from './distribution.js';
export type { GetSplitInput, SplitInfo } from './getSplit.js';
export {
  formatPercent,
  hashSplitParams,
  MAX_DISTRIBUTION_INCENTIVE,
  percent,
  RAF_SHARE,
  splitAmounts,
  splitParams,
  SPLITS_SCALE,
  type ShareRecipient,
} from './shares.js';

/** The splits module bound to a client context. */
export interface SplitsModule {
  percent: typeof percent;
  formatPercent: typeof formatPercent;
  splitParams: typeof splitParams;
  /**
   * The deterministic (CREATE2) address of a SplitV2 split for these params, owner and salt,
   * and whether it exists already.
   *
   * @see spec/operations.md "splits.predictSplit"
   */
  predictSplit: (
    input: PredictSplitInput,
  ) => Promise<{ address: Address; exists: boolean }>;
  /**
   * Creates a SplitV2 split from recipients and shares (parts per million). Already deployed
   * at the predicted address: SPLIT_ALREADY_EXISTS (use its `address`; nothing to send).
   *
   * @see spec/operations.md "splits.prepareCreateSplit"
   */
  prepareCreateSplit: (
    input: CreateSplitInput,
  ) => Promise<Prepared<'createSplit'>>;
  /** null when the address is not a SplitV2 split; throws for read failures. */
  getSplit: (input: GetSplitInput) => Promise<SplitInfo | null>;
  /**
   * Distributes an OVM, the SplitV2 splits behind its recipients and the recipients'
   * Warehouse balances in one Multicall3 transaction. Splits must be passed with the exact
   * params they were created with (SPLIT_PARAMS_MISMATCH, SPLIT_PARAMS_REQUIRED).
   * `ovm.prepareDistribute` is the OVM alone.
   *
   * @see spec/operations.md "splits.prepareDistributeAll"
   */
  prepareDistributeAll: (
    input: DistributeAllInput,
  ) => Promise<Prepared<'distributeAll'>>;
  /**
   * The reads and amounts of `prepareDistributeAll` without a transaction.
   *
   * @see spec/operations.md "splits.prepareDistributeAll"
   */
  previewDistributeAll: (
    input: DistributeAllInput,
  ) => Promise<PreviewResult<DistributeAllPreview>>;
  distributionFromReceipt: (
    receipt: DistributionReceipt,
    options?: { ovm?: string },
  ) => DistributionResult;
}

export const createSplitsModule = (ctx: Context): SplitsModule => ({
  percent,
  formatPercent,
  splitParams,
  predictSplit: async input => await predictSplit(ctx, input),
  prepareCreateSplit: async input => await prepareCreateSplit(ctx, input),
  getSplit: async input => await getSplit(ctx, input),
  prepareDistributeAll: async input => await prepareDistributeAll(ctx, input),
  previewDistributeAll: async input => await previewDistributeAll(ctx, input),
  distributionFromReceipt: (receipt, options = {}) =>
    distributionFromReceipt(receipt, { ...options, chainId: ctx.chain.id }),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
