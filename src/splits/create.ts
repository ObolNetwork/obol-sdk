/** splits.predictSplit and splits.prepareCreateSplit. */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { pullSplitFactoryAbi } from '../abi.js';
import {
  chainReadFailed,
  latestBlockNumber,
  prepared,
  refusePublicForwarders,
} from '../chainUtils.js';
import { requireContracts, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, T, ZERO_ADDRESS } from '../schema.js';
import type { Prepared, SplitParams, SplitParamsInput } from '../types.js';
import { EXPECTED_CODE_HASHES, requireExpectedCode } from './chain.js';
import {
  checkSplitParams,
  splitParams,
  SplitParamsSchema,
  type ShareRecipient,
} from './shares.js';

/** The salt the SDK creates splits with unless one is given. */
export const DEFAULT_SPLIT_SALT: Hex =
  '0x2fa740d39f3b04b2c7ef4e9f9e1a6e38f4c72c1a91d8595d5d31a3adf17c6b12';

export const PredictSplitInputSchema = Type.Object(
  {
    params: SplitParamsSchema,
    owner: T.Address,
    salt: Type.Optional(T.Hash32),
  },
  { additionalProperties: false },
);

export interface PredictSplitInput {
  params: SplitParamsInput;
  /** The zero address creates an immutable split. */
  owner: string;
  /** 32-byte hex; default DEFAULT_SPLIT_SALT. */
  salt?: string;
}

/** What `prepareCreateSplit` creates: the predicted address and the params. */
export interface CreateSplitPreview {
  address: Address;
  params: SplitParams;
}

/**
 * The deterministic address of a PullSplit and whether it exists, from the
 * factory's `isDeployed(params, owner, salt)`. Checks: params well-formed
 * (lengths, positive sum); the chain has the splits contracts. A failed call
 * is CHAIN_READ_FAILED, never "does not exist".
 */
export const predictSplit = async (
  ctx: Context,
  input: PredictSplitInput,
  blockNumber?: bigint,
): Promise<{ address: Address; exists: boolean }> => {
  const decoded = decode(PredictSplitInputSchema, input);
  const params = checkSplitParams(decoded.params, 'params');
  const { pullSplitFactory } = requireContracts(
    ctx.chain.id,
    'splits.predictSplit',
  );
  try {
    const [address, exists] = await ctx.publicClient.readContract({
      address: pullSplitFactory,
      abi: pullSplitFactoryAbi,
      functionName: 'isDeployed',
      args: [
        params,
        checksum(decoded.owner),
        (decoded.salt as Hex | undefined) ?? DEFAULT_SPLIT_SALT,
      ],
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
    return { address: checksum(address), exists };
  } catch (cause) {
    throw chainReadFailed('the predicted split address', cause);
  }
};

export const CreateSplitInputSchema = Type.Object(
  {
    // Checked by splitParams, which reports issue slugs (empty_recipients,
    // invalid_address, duplicate_address, share_not_positive_integer,
    // sum_mismatch).
    recipients: Type.Unknown({
      description:
        'array of { address, share }: shares in ppm (bigint or safe integer), summing to 1000000',
    }),
    distributionIncentive: Type.Optional(
      Type.Unknown({ description: 'ppm, integer in [0, 65535]' }),
    ),
    owner: Type.Optional(T.Address),
    salt: Type.Optional(T.Hash32),
  },
  { additionalProperties: false },
);

export interface CreateSplitInput {
  recipients: ShareRecipient[];
  /** ppm, default 0. */
  distributionIncentive?: number;
  /** Default the zero address (immutable split). */
  owner?: string;
  /** 32-byte hex; default DEFAULT_SPLIT_SALT. */
  salt?: string;
}

/** Split owner and recipients must not be public forwarders. */
export const refuseSplitForwarders = (
  chainId: number,
  params: SplitParams,
  owner: Address,
): void => {
  refusePublicForwarders(chainId, [
    { path: 'owner', address: owner, kind: 'owner' as const },
    ...params.recipients.map((address, i) => ({
      path: `recipients[${i}]`,
      address,
      kind: 'recipient' as const,
    })),
  ]);
};

/**
 * Builds `createSplitDeterministic(params, owner, 0x0, salt)` on the PullSplit
 * factory. Checks: `splitParams` (shares sum to 1_000_000, no RAF added); the
 * factory has the expected code (CONTRACT_NOT_AVAILABLE); the split does not
 * exist yet (SPLIT_ALREADY_EXISTS, with its `address`).
 */
export const prepareCreateSplit = async (
  ctx: Context,
  input: CreateSplitInput,
): Promise<Prepared<'createSplit'>> => {
  const decoded = decode(CreateSplitInputSchema, input);
  const params = splitParams(
    decoded.recipients as ShareRecipient[],
    (decoded.distributionIncentive ?? 0) as number,
  );
  const owner =
    decoded.owner !== undefined ? checksum(decoded.owner) : ZERO_ADDRESS;
  const salt = (decoded.salt as Hex | undefined) ?? DEFAULT_SPLIT_SALT;
  refuseSplitForwarders(ctx.chain.id, params, owner);
  const { pullSplitFactory } = requireContracts(
    ctx.chain.id,
    'splits.prepareCreateSplit',
  );
  const blockNumber = await latestBlockNumber(ctx.publicClient);
  await requireExpectedCode(
    ctx,
    pullSplitFactory,
    EXPECTED_CODE_HASHES.pullSplitFactory,
    'PullSplit factory',
    blockNumber,
  );
  const { address, exists } = await predictSplit(
    ctx,
    { params, owner, salt },
    blockNumber,
  );
  if (exists) throw splitAlreadyExists(address);
  return prepared(ctx, 'createSplit', {
    to: pullSplitFactory,
    data: encodeCreateSplit(params, owner, salt),
    preview: { address, params },
    blockNumber,
  });
};

export const splitAlreadyExists = (address: Address): ObolError =>
  new ObolError('SPLIT_ALREADY_EXISTS', `The split ${address} already exists`, {
    hint: 'Use the existing split; there is nothing to send',
    details: { address },
  });

/** Encodes `createSplitDeterministic` (used by setup's batched creation). */
export const encodeCreateSplit = (
  params: SplitParams,
  owner: Address,
  salt: Hex,
): Hex =>
  encodeFunctionData({
    abi: pullSplitFactoryAbi,
    functionName: 'createSplitDeterministic',
    args: [params, owner, ZERO_ADDRESS, salt],
  });
