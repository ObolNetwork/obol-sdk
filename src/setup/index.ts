/** setup: OVM and split creation flows (spec/operations.md "setup"). */
import type { Context } from '../context.js';
import type { Prepared } from '../types.js';
import {
  ovmFromReceipt,
  prepareCreateOvm,
  type CreateOvmInput,
  type OvmCreated,
} from './ovm.js';
import { ovmSplitParams, rewardsSplit, solo, totalSplit } from './presets.js';
import { prepareOvmWithSplits, type OvmWithSplitsInput } from './withSplits.js';

export {
  DEFAULT_PRINCIPAL_THRESHOLD,
  MAX_PRINCIPAL_THRESHOLD,
  MIN_PRINCIPAL_THRESHOLD,
  ovmFromReceipt,
  type CreateOvmInput,
  type CreateOvmPreview,
  type OvmCreated,
} from './ovm.js';
export {
  ovmSplitParams,
  rewardsSplit,
  solo,
  totalSplit,
  type PresetOptions,
} from './presets.js';
export {
  type OvmRecipientInput,
  type OvmWithSplitsInput,
  type OvmWithSplitsPreview,
  type SplitSpec,
} from './withSplits.js';

type Preset<F extends (input: never) => unknown> = Omit<
  Parameters<F>[0],
  'chainId'
>;

/** The setup module bound to a client context (presets use the client chain). */
export interface SetupModule {
  /**
   * Deploys an OVM through the Obol factory with the given owner, recipients and principal
   * threshold (default 16 ETH). The address is known after mining: `ovmFromReceipt`.
   * A recipient with no code: RECIPIENT_NOT_CONTRACT (info).
   *
   * @see spec/operations.md "setup.prepareCreateOvm"
   */
  prepareCreateOvm: (input: CreateOvmInput) => Promise<Prepared<'createOvm'>>;
  /**
   * Deploys an OVM and the splits behind its recipients in one transaction (Multicall3),
   * reusing splits that exist (SPLIT_REUSED). Build the input with `rewardsSplit`,
   * `totalSplit` or `solo`. Each send creates a new OVM: after an unknown outcome, look for
   * the earlier `CreateObolValidatorManager` event before retrying.
   *
   * @see spec/operations.md "setup.prepareOvmWithSplits"
   */
  prepareOvmWithSplits: (
    input: OvmWithSplitsInput,
  ) => Promise<Prepared<'ovmWithSplits'>>;
  ovmFromReceipt: (receipt: Parameters<typeof ovmFromReceipt>[0]) => OvmCreated;
  ovmSplitParams: (
    input: Preset<typeof ovmSplitParams>,
  ) => ReturnType<typeof ovmSplitParams>;
  rewardsSplit: (input: Preset<typeof rewardsSplit>) => OvmWithSplitsInput;
  totalSplit: (input: Preset<typeof totalSplit>) => OvmWithSplitsInput;
  solo: (input: Preset<typeof solo>) => OvmWithSplitsInput;
}

export const createSetupModule = (ctx: Context): SetupModule => ({
  prepareCreateOvm: async input => await prepareCreateOvm(ctx, input),
  prepareOvmWithSplits: async input => await prepareOvmWithSplits(ctx, input),
  ovmFromReceipt: receipt => ovmFromReceipt(receipt, { chainId: ctx.chain.id }),
  ovmSplitParams: input => ovmSplitParams({ ...input, chainId: ctx.chain.id }),
  rewardsSplit: input => rewardsSplit({ ...input, chainId: ctx.chain.id }),
  totalSplit: input => totalSplit({ ...input, chainId: ctx.chain.id }),
  solo: input => solo({ ...input, chainId: ctx.chain.id }),
});

/** Builds the context a module is bound to, without the other modules. */
export { createObolContext, type ObolClientConfig } from '../clientContext.js';
