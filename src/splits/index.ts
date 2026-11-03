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
  prepareDistribution,
  previewDistribution,
  type DistributionInput,
  type DistributionPreview,
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
  type DistributionInput,
  type DistributionPreview,
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
  predictSplit: (
    input: PredictSplitInput,
  ) => Promise<{ address: Address; exists: boolean }>;
  prepareCreateSplit: (
    input: CreateSplitInput,
  ) => Promise<Prepared<'createSplit'>>;
  /** null when the address is not a SplitV2 split; throws for read failures. */
  getSplit: (input: GetSplitInput) => Promise<SplitInfo | null>;
  prepareDistribution: (
    input: DistributionInput,
  ) => Promise<Prepared<'distribution'>>;
  previewDistribution: (
    input: DistributionInput,
  ) => Promise<PreviewResult<DistributionPreview>>;
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
  prepareDistribution: async input => await prepareDistribution(ctx, input),
  previewDistribution: async input => await previewDistribution(ctx, input),
  distributionFromReceipt: (receipt, options = {}) =>
    distributionFromReceipt(receipt, { ...options, chainId: ctx.chain.id }),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
