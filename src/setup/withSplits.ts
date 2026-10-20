/** setup.prepareOvmWithSplits: splits (if new) plus the OVM in one transaction. */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { multicall3Abi } from '../abi.js';
import { finding, prepared } from '../chainUtils.js';
import { requireContracts, type Context } from '../context.js';
import {
  checksum,
  decode,
  invalid,
  sameAddress,
  T,
  ZERO_ADDRESS,
} from '../schema.js';
import type { Finding, Prepared, SplitParams } from '../types.js';
import {
  EXPECTED_CODE_HASHES,
  headBlock,
  requireExpectedCode,
} from '../splits/chain.js';
import {
  DEFAULT_SPLIT_SALT,
  encodeCreateSplit,
  predictSplit,
  refuseSplitForwarders,
} from '../splits/create.js';
import { splitParams, type ShareRecipient } from '../splits/shares.js';
import {
  checkOvmInput,
  encodeCreateOvm,
  recipientCodeFindings,
  refuseOvmForwarders,
} from './ovm.js';

const SplitSpecSchema = Type.Object({
  recipients: Type.Unknown(),
  distributionIncentive: Type.Optional(Type.Unknown()),
  owner: Type.Optional(T.Address),
  salt: Type.Optional(T.Hash32),
});

const Recipient = Type.Object({
  split: Type.Optional(SplitSpecSchema),
  address: Type.Optional(T.Address),
});

const OvmWithSplitsInputSchema = Type.Object({
  owner: T.Address,
  principalThreshold: Type.Optional(T.Wei),
  reward: Recipient,
  principal: Recipient,
});

export interface SplitSpec {
  recipients: ShareRecipient[];
  /** ppm, default 0. */
  distributionIncentive?: number;
  /** The split's owner; default the zero address (immutable). */
  owner?: Address;
  salt?: Hex;
}

/** A recipient of the OVM: a split to create (or reuse), or any address. */
export type OvmRecipientInput = { split: SplitSpec } | { address: Address };

export interface OvmWithSplitsInput {
  owner: Address;
  /** wei; default 16 ETH. */
  principalThreshold?: bigint;
  reward: OvmRecipientInput;
  principal: OvmRecipientInput;
}

export interface OvmWithSplitsPreview {
  rewardRecipient: { address: Address; created: boolean };
  principalRecipient: { address: Address; created: boolean };
}

interface Side {
  address: Address;
  /** Set when the split does not exist yet. */
  create?: { params: SplitParams; owner: Address; salt: Hex };
  split: boolean;
}

/**
 * Builds the OVM and any new splits for its recipients. Checks, in order:
 * each side is either `split` or `address` (PAYLOAD_INVALID); each split
 * passes `splitParams` and `predictSplit` gives its address and whether it
 * exists; the `prepareCreateOvm` checks with those addresses; the OVM factory,
 * and when a split is created the PullSplit factory and Multicall3, have the
 * expected code (CONTRACT_NOT_AVAILABLE). Existing splits are reused
 * (SPLIT_REUSED finding); a given address without code gets
 * RECIPIENT_NOT_CONTRACT. With splits to create, the request is one Multicall3
 * `aggregate3` of the creates and `createObolValidatorManager`; otherwise the
 * direct factory call. Each send creates a new OVM: after an unknown outcome,
 * look for the earlier `CreateObolValidatorManager` event before retrying.
 */
export const prepareOvmWithSplits = async (
  ctx: Context,
  input: OvmWithSplitsInput,
): Promise<Prepared<OvmWithSplitsPreview>> => {
  const d = decode(OvmWithSplitsInputSchema, input);
  const contracts = requireContracts(
    ctx.chain.id,
    'setup.prepareOvmWithSplits',
  );
  const params = {
    reward: undefined as SplitParams | undefined,
    principal: undefined as SplitParams | undefined,
  };
  for (const key of ['reward', 'principal'] as const) {
    const side = d[key];
    if ((side.split === undefined) === (side.address === undefined)) {
      throw invalid(key, 'must have exactly one of split, address');
    }
    if (side.split !== undefined) {
      params[key] = splitParams(
        side.split.recipients as ShareRecipient[],
        (side.split.distributionIncentive ?? 0) as number,
      );
    }
  }

  const blockNumber = await headBlock(ctx);
  const resolve = async (key: 'reward' | 'principal'): Promise<Side> => {
    const side = d[key];
    const p = params[key];
    if (side.split === undefined || p === undefined) {
      return { address: checksum(side.address as string), split: false };
    }
    const owner =
      side.split.owner !== undefined
        ? checksum(side.split.owner)
        : ZERO_ADDRESS;
    const salt = (side.split.salt as Hex | undefined) ?? DEFAULT_SPLIT_SALT;
    refuseSplitForwarders(ctx.chain.id, p, owner);
    const { address, exists } = await predictSplit(
      ctx,
      { params: p, owner, salt },
      blockNumber,
    );
    return {
      address,
      split: true,
      ...(exists ? {} : { create: { params: p, owner, salt } }),
    };
  };
  const reward = await resolve('reward');
  const principal = await resolve('principal');
  // The same split on both sides is created (or reused) once.
  const sameSplit =
    reward.split &&
    principal.split &&
    sameAddress(reward.address, principal.address);
  if (sameSplit) delete principal.create;

  const ovmInput = checkOvmInput({
    owner: d.owner as Address,
    principalRecipient: principal.address,
    rewardRecipient: reward.address,
    ...(d.principalThreshold !== undefined
      ? { principalThreshold: d.principalThreshold }
      : {}),
  });
  refuseOvmForwarders(ctx.chain.id, ovmInput);
  await requireExpectedCode(
    ctx,
    contracts.ovmFactory.address,
    EXPECTED_CODE_HASHES.ovmFactory[ctx.chain.id],
    'OVM factory',
    blockNumber,
  );
  const creates = [reward, principal].flatMap(side =>
    side.create !== undefined ? [side.create] : [],
  );
  if (creates.length > 0) {
    await requireExpectedCode(
      ctx,
      contracts.pullSplitFactory,
      EXPECTED_CODE_HASHES.pullSplitFactory,
      'PullSplit factory',
      blockNumber,
    );
    await requireExpectedCode(
      ctx,
      contracts.multicall3,
      EXPECTED_CODE_HASHES.multicall3,
      'Multicall3',
      blockNumber,
    );
  }

  const checks: Finding[] = [];
  for (const side of sameSplit ? [reward] : [reward, principal]) {
    if (side.split && side.create === undefined) {
      checks.push(
        finding(
          'SPLIT_REUSED',
          'info',
          `The split ${side.address} already exists and is reused`,
          {
            details: { address: side.address },
          },
        ),
      );
    }
  }
  checks.push(
    ...(await recipientCodeFindings(
      ctx,
      [reward, principal].filter(s => !s.split).map(s => s.address),
      blockNumber,
    )),
  );

  const preview: OvmWithSplitsPreview = {
    rewardRecipient: {
      address: reward.address,
      created: reward.create !== undefined,
    },
    principalRecipient: {
      address: principal.address,
      created: (sameSplit ? reward : principal).create !== undefined,
    },
  };
  const createOvm = encodeCreateOvm(ovmInput);
  if (creates.length === 0) {
    return prepared(ctx, {
      to: contracts.ovmFactory.address,
      data: createOvm,
      checks,
      preview,
      blockNumber,
    });
  }
  const calls = [
    ...creates.map(c => ({
      target: contracts.pullSplitFactory,
      allowFailure: false,
      callData: encodeCreateSplit(c.params, c.owner, c.salt),
    })),
    {
      target: contracts.ovmFactory.address,
      allowFailure: false,
      callData: createOvm,
    },
  ];
  return prepared(ctx, {
    to: contracts.multicall3,
    data: encodeFunctionData({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls],
    }),
    checks,
    preview,
    blockNumber,
  });
};
