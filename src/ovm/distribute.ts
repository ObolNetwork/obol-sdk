/** ovm.prepareDistribute / ovm.previewDistribute (spec/operations.md). */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address } from 'viem';
import { ovmAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import { prepared } from '../chainUtils.js';
import type { Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, T } from '../schema.js';
import type { Finding, Prepared, PreviewResult } from '../types.js';
import { provenanceFindings, readOvmCore } from './read.js';
import { ovmRouting } from './routing.js';

export const PrepareDistributeInputSchema = Type.Object(
  {
    ovm: T.Address,
    mode: Type.Optional(
      Type.Union([Type.Literal('push'), Type.Literal('pull')]),
    ),
  },
  { additionalProperties: false },
);
export interface PrepareDistributeInput {
  ovm: string;
  /** `push` (default): distributeFunds(); `pull`: distributeFundsPull(). */
  mode?: 'push' | 'pull';
}

export interface DistributePreview {
  mode: 'push' | 'pull';
  distributable: bigint;
  principalPayout: bigint;
  rewardPayout: bigint;
  principalRecipient: Address;
  rewardRecipient: Address;
}

const build = async (
  ctx: Context,
  input: PrepareDistributeInput,
  operation: string,
): Promise<Prepared<'distribute'>> => {
  const args = decode(PrepareDistributeInputSchema, input);
  requireContracts(ctx.chain.id, operation);
  const ovm = checksum(args.ovm);
  const mode = args.mode ?? 'push';
  const checks: Finding[] = await provenanceFindings(ctx, ovm);
  const core = await readOvmCore(ctx, ovm, { what: operation });
  return prepared(ctx, 'distribute', {
    to: ovm,
    data: encodeFunctionData({
      abi: ovmAbi,
      functionName: mode === 'push' ? 'distributeFunds' : 'distributeFundsPull',
    }),
    checks,
    preview: {
      mode,
      ...ovmRouting(core),
      principalRecipient: core.principalRecipient,
      rewardRecipient: core.rewardRecipient,
    },
    blockNumber: core.blockNumber,
  });
};

/**
 * ovm.prepareDistribute (`chain`): `distributeFunds()` (push) or
 * `distributeFundsPull()` (pull); anyone may call. Checks provenance
 * (OVM_NOT_OBOL, or a PROVENANCE_UNKNOWN warning), reads the state on chain
 * (OVM_READ_FAILED) and throws NOTHING_TO_DISTRIBUTE when nothing is
 * distributable. The preview is the routing of distribution.json `routing`.
 */
export const prepareDistribute = async (
  ctx: Context,
  input: PrepareDistributeInput,
): Promise<Prepared<'distribute'>> => {
  const result = await build(ctx, input, 'ovm.prepareDistribute');
  if (result.preview.distributable === 0n) {
    throw new ObolError(
      'NOTHING_TO_DISTRIBUTE',
      `${result.request.to} has nothing to distribute`,
      { hint: 'Prepare again later' },
    );
  }
  return result;
};

/**
 * ovm.previewDistribute (`chain`): the same reads and checks as
 * `prepareDistribute`, returning the preview (zeros instead of
 * NOTHING_TO_DISTRIBUTE), for a page that shows the figures with the button
 * disabled. Same shape as every `preview*`: `{ preview, checks, blockNumber }`.
 */
export const previewDistribute = async (
  ctx: Context,
  input: PrepareDistributeInput,
): Promise<PreviewResult<DistributePreview>> => {
  const result = await build(ctx, input, 'ovm.previewDistribute');
  return {
    preview: result.preview,
    checks: result.checks,
    blockNumber: result.blockNumber as bigint,
  };
};
