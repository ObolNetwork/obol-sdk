/**
 * Setup presets: data on top of `prepareOvmWithSplits`. Reward splits carry
 * the Obol RAF share (1%); principal splits do not. Vectors
 * `split_shares.json` (`ovm_split_params`).
 */
import type { Address, Hex } from 'viem';
import { requireContracts } from '../context.js';
import { invalid, sameAddress } from '../schema.js';
import type { SplitParams } from '../types.js';
import {
  RAF_SHARE,
  readIncentive,
  readShares,
  SPLITS_SCALE,
  toSplitParams,
  type ShareRecipient,
} from '../splits/shares.js';
import type { OvmWithSplitsInput, SplitSpec } from './withSplits.js';

/**
 * The exact SplitV2 params the presets create. Reward split: the reward
 * shares must sum to 990000 and the chain's RAF recipient is added with
 * 10000. Principal split (`kind: "total"` only): `principalRecipients`
 * summing to 1_000_000 (no RAF), or, without them, "Split Everything": each
 * reward recipient gets its share plus `floor(10000 / n)`, and `10000 mod n`
 * goes to the first in numeric address order. Recipients are sorted by
 * numeric address. Failures are PAYLOAD_INVALID with an `issue`
 * (`principal_not_allowed` for principal recipients on a rewards split).
 */
export const ovmSplitParams = (input: {
  chainId: number;
  kind: 'rewards' | 'total';
  rewardRecipients: ShareRecipient[];
  principalRecipients?: ShareRecipient[];
  distributionIncentive?: number;
}): { rewardSplit: SplitParams; principalSplit?: SplitParams } => {
  const { rafRecipient } = requireContracts(input.chainId, 'setup presets');
  const incentive = readIncentive(
    input.distributionIncentive ?? 0,
    'distributionIncentive',
  );
  const rewards = readShares(
    input.rewardRecipients,
    'rewardRecipients',
    SPLITS_SCALE - RAF_SHARE,
  );
  const rafIndex = rewards.findIndex(r => sameAddress(r.address, rafRecipient));
  if (rafIndex !== -1) {
    throw invalid(
      `rewardRecipients[${rafIndex}].address`,
      'must not be the RAF recipient, which the preset adds itself',
      'duplicate_address',
    );
  }
  const rewardSplit = toSplitParams(
    [...rewards, { address: rafRecipient, share: BigInt(RAF_SHARE) }],
    incentive,
  );
  if (input.kind === 'rewards') {
    if (input.principalRecipients !== undefined) {
      throw invalid(
        'principalRecipients',
        'is only accepted for a total split',
        'principal_not_allowed',
      );
    }
    return { rewardSplit };
  }
  if (input.principalRecipients !== undefined) {
    const principals = readShares(
      input.principalRecipients,
      'principalRecipients',
      SPLITS_SCALE,
    );
    return {
      rewardSplit,
      principalSplit: toSplitParams(principals, incentive),
    };
  }
  // Split Everything: spread the RAF share over the reward recipients.
  const sorted = toSplitParams(rewards, incentive);
  const count = BigInt(sorted.recipients.length);
  const each = BigInt(RAF_SHARE) / count;
  const remainder = BigInt(RAF_SHARE) % count;
  return {
    rewardSplit,
    principalSplit: toSplitParams(
      sorted.recipients.map((address, i) => ({
        address,
        share: sorted.allocations[i] + each + (i === 0 ? remainder : 0n),
      })),
      incentive,
    ),
  };
};

/** Options every preset takes besides its recipients. */
export interface PresetOptions {
  chainId: number;
  /** The OVM owner. */
  owner: Address;
  /** wei; default 16 ETH. */
  principalThreshold?: bigint;
  /** ppm, for every split the preset creates; default 0. */
  distributionIncentive?: number;
  /** Owner of the splits; default the zero address (immutable). */
  splitOwner?: Address;
  salt?: Hex;
}

const toSpec = (params: SplitParams, options: PresetOptions): SplitSpec => ({
  recipients: params.recipients.map((address, i) => ({
    address,
    share: params.allocations[i],
  })),
  distributionIncentive: params.distributionIncentive,
  ...(options.splitOwner !== undefined ? { owner: options.splitOwner } : {}),
  ...(options.salt !== undefined ? { salt: options.salt } : {}),
});

const base = (
  options: PresetOptions,
): Pick<OvmWithSplitsInput, 'owner' | 'principalThreshold'> => ({
  owner: options.owner,
  ...(options.principalThreshold !== undefined
    ? { principalThreshold: options.principalThreshold }
    : {}),
});

/**
 * Rewards to a split (`recipients`, summing to 990000, plus the RAF 10000);
 * principal to `principalRecipient`. Returns the `prepareOvmWithSplits` input.
 */
export const rewardsSplit = (
  input: PresetOptions & {
    recipients: ShareRecipient[];
    principalRecipient: Address;
  },
): OvmWithSplitsInput => {
  const { rewardSplit } = ovmSplitParams({
    chainId: input.chainId,
    kind: 'rewards',
    rewardRecipients: input.recipients,
    ...(input.distributionIncentive !== undefined
      ? { distributionIncentive: input.distributionIncentive }
      : {}),
  });
  return {
    ...base(input),
    reward: { split: toSpec(rewardSplit, input) },
    principal: { address: input.principalRecipient },
  };
};

/**
 * Rewards to a split (`recipients` plus the RAF), principal to a second split:
 * `principalRecipients` (sum 1_000_000, no RAF) or Split Everything. Returns
 * the `prepareOvmWithSplits` input.
 */
export const totalSplit = (
  input: PresetOptions & {
    recipients: ShareRecipient[];
    principalRecipients?: ShareRecipient[];
  },
): OvmWithSplitsInput => {
  const { rewardSplit, principalSplit } = ovmSplitParams({
    chainId: input.chainId,
    kind: 'total',
    rewardRecipients: input.recipients,
    ...(input.principalRecipients !== undefined
      ? { principalRecipients: input.principalRecipients }
      : {}),
    ...(input.distributionIncentive !== undefined
      ? { distributionIncentive: input.distributionIncentive }
      : {}),
  });
  return {
    ...base(input),
    reward: { split: toSpec(rewardSplit, input) },
    principal: { split: toSpec(principalSplit as SplitParams, input) },
  };
};

/**
 * One operator: rewards to a split of `recipient` (990000) and the RAF
 * (10000); principal straight to `recipient`. Returns the
 * `prepareOvmWithSplits` input.
 *
 * A Lido CSM preset is not offered yet: its per-chain addresses and roles
 * are pending confirmation with the Lido integration.
 */
export const solo = (
  input: PresetOptions & { recipient: Address },
): OvmWithSplitsInput =>
  rewardsSplit({
    ...input,
    recipients: [{ address: input.recipient, share: SPLITS_SCALE - RAF_SHARE }],
    principalRecipient: input.recipient,
  });
