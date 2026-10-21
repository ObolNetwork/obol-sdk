/**
 * Integer split shares (parts per million, the 0xSplits PERCENTAGE_SCALE) and
 * SplitV2 parameter helpers. Pure; vectors `split_shares.json`.
 */
import { Type, type Static } from '@sinclair/typebox';
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { checksum, invalid, isAddressInput, T } from '../schema.js';
import type { SplitParams } from '../types.js';

/** 100% in SplitV2 allocations: 1% is 10000. */
export const SPLITS_SCALE = 1_000_000n;
/** The Obol RAF share added to every reward split the presets build (1%). */
export const RAF_SHARE = 10_000n;
/** SplitV2 stores the distribution incentive as a uint16 (at most 6.5535%). */
export const MAX_DISTRIBUTION_INCENTIVE = 65_535;

const PERCENT = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

/** Orders addresses by numeric value (the lowercase hex), as splits are created. */
export const compareAddresses = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * A percentage as integer ppm, without float arithmetic: `"33.3333"` and
 * `33.3333` give `333333`. Checks: at most three integer digits and four
 * decimals (no sign, exponent or spaces), result in [1, 1_000_000]; else
 * PAYLOAD_INVALID.
 */
export const percent = (p: string | number): bigint => {
  const text =
    typeof p === 'number' && Number.isFinite(p)
      ? String(p)
      : typeof p === 'string'
        ? p
        : '';
  const match = PERCENT.exec(text);
  const shares =
    match === null
      ? 0n
      : BigInt(match[1]) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
  if (shares < 1n || shares > SPLITS_SCALE) {
    throw invalid(
      'percent',
      `must be a percentage in (0, 100] with at most 4 decimals, got ${String(p)}`,
    );
  }
  return shares;
};

/**
 * The shortest decimal percentage for `ppm` with at most 4 decimals:
 * `333333` → `"33.3333"`, `10000` → `"1"`. Checks: an integer in
 * [0, 1_000_000], else PAYLOAD_INVALID.
 */
export const formatPercent = (ppm: number | bigint): string => {
  const value =
    typeof ppm === 'bigint'
      ? ppm
      : Number.isSafeInteger(ppm)
        ? BigInt(ppm)
        : -1n;
  if (value < 0n || value > SPLITS_SCALE) {
    throw invalid('ppm', 'must be an integer in [0, 1000000]');
  }
  const whole = (value / 10_000n).toString();
  const decimals = (value % 10_000n)
    .toString()
    .padStart(4, '0')
    .replace(/0+$/, '');
  return decimals === '' ? whole : `${whole}.${decimals}`;
};

export interface ShareRecipient {
  address: string;
  /** ppm; a safe integer number or a bigint. */
  share: number | bigint;
}

const toShare = (value: unknown): bigint | null =>
  typeof value === 'bigint'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? BigInt(value)
      : null;

/**
 * Checks recipients and shares (shared by `splitParams` and the presets):
 * non-empty, valid unique addresses, positive integer shares summing to
 * `expectedTotal`. Issues: `empty_recipients`, `invalid_address`,
 * `duplicate_address`, `share_not_positive_integer`, `sum_mismatch`.
 */
export const readShares = (
  recipients: unknown,
  path: string,
  expectedTotal: bigint,
): Array<{ address: Address; share: bigint }> => {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw invalid(path, 'must be a non-empty array', 'empty_recipients');
  }
  const seen = new Set<string>();
  let total = 0n;
  const result = recipients.map((recipient: unknown, i: number) => {
    const { address, share } = (recipient ?? {}) as Partial<ShareRecipient>;
    if (typeof address !== 'string' || !isAddressInput(address)) {
      throw invalid(
        `${path}[${i}].address`,
        'must be a hex address (all-lowercase, all-uppercase or a valid EIP-55 checksum)',
        'invalid_address',
      );
    }
    if (seen.has(address.toLowerCase())) {
      throw invalid(
        `${path}[${i}].address`,
        'must not repeat an address',
        'duplicate_address',
      );
    }
    seen.add(address.toLowerCase());
    const value = toShare(share);
    if (value === null || value < 1n) {
      throw invalid(
        `${path}[${i}].share`,
        'must be a positive integer (1000000 = 100%)',
        'share_not_positive_integer',
      );
    }
    total += value;
    return { address: checksum(address), share: value };
  });
  if (total !== expectedTotal) {
    throw invalid(
      path,
      `shares must sum to exactly ${expectedTotal}, got ${total}`,
      'sum_mismatch',
    );
  }
  return result;
};

/** Checks a distribution incentive: an integer in [0, 65535] ppm. */
export const readIncentive = (value: unknown, path: string): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DISTRIBUTION_INCENTIVE
  ) {
    throw invalid(
      path,
      `must be an integer in [0, ${MAX_DISTRIBUTION_INCENTIVE}] (ppm)`,
    );
  }
  return value;
};

/** Builds SplitParams from checked shares: sorted by numeric address. */
export const toSplitParams = (
  shares: Array<{ address: Address; share: bigint }>,
  distributionIncentive: number,
): SplitParams => {
  const sorted = [...shares].sort((a, b) =>
    compareAddresses(a.address, b.address),
  );
  const allocations = sorted.map(s => s.share);
  return {
    recipients: sorted.map(s => s.address),
    allocations,
    totalAllocation: allocations.reduce((sum, a) => sum + a, 0n),
    distributionIncentive,
  };
};

/**
 * SplitV2 parameters from recipients with ppm shares. Checks: at least one
 * recipient; valid, unique (case-insensitive) addresses; positive integer
 * shares summing to exactly 1_000_000; `distributionIncentive` ≤ 65535.
 * Failures are PAYLOAD_INVALID with an `issue`. Recipients come out sorted by
 * numeric address, checksummed. No RAF share is added.
 */
export const splitParams = (
  recipients: ShareRecipient[],
  distributionIncentive: number = 0,
): SplitParams =>
  toSplitParams(
    readShares(recipients, 'recipients', SPLITS_SCALE),
    readIncentive(distributionIncentive, 'distributionIncentive'),
  );

/** Split params as inputs take them (allocations as bigint or safe integers). */
export const SplitParamsSchema = Type.Object({
  recipients: Type.Array(T.Address, { minItems: 1 }),
  allocations: Type.Array(T.UintLike, { minItems: 1 }),
  totalAllocation: T.UintLike,
  distributionIncentive: Type.Integer({
    minimum: 0,
    maximum: MAX_DISTRIBUTION_INCENTIVE,
  }),
});

/**
 * Checks given split params beyond their schema: allocations match recipients
 * in length and sum to a positive `totalAllocation`. Returns them with
 * checksummed recipients, order kept (the order is part of the split hash).
 */
export const checkSplitParams = (
  params: Static<typeof SplitParamsSchema>,
  path: string,
): SplitParams => {
  if (params.allocations.length !== params.recipients.length) {
    throw invalid(`${path}.allocations`, 'must have one entry per recipient');
  }
  const allocations = params.allocations.map(a => BigInt(a));
  const totalAllocation = BigInt(params.totalAllocation);
  const sum = allocations.reduce((s, a) => s + a, 0n);
  if (sum === 0n || sum !== totalAllocation) {
    throw invalid(
      `${path}.totalAllocation`,
      'must be the (positive) sum of the allocations',
    );
  }
  return {
    recipients: params.recipients.map(checksum),
    allocations,
    totalAllocation,
    distributionIncentive: params.distributionIncentive,
  };
};

/** The SplitV2 `splitHash`: keccak256(abi.encode((address[], uint256[], uint256, uint16))). */
export const hashSplitParams = (params: SplitParams): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'recipients', type: 'address[]' },
            { name: 'allocations', type: 'uint256[]' },
            { name: 'totalAllocation', type: 'uint256' },
            { name: 'distributionIncentive', type: 'uint16' },
          ],
        },
      ],
      [params],
    ),
  );

/**
 * How a split divides `amount` (SplitV2Lib): the distributor reward
 * (`amount × incentive / 1e6`) comes off first, then each recipient gets
 * `floor(rest × allocation / totalAllocation)`. Vectors `split_distribution`.
 */
export const splitAmounts = (
  params: SplitParams,
  amount: bigint,
): { amounts: bigint[]; distributorReward: bigint } => {
  const distributorReward =
    (amount * BigInt(params.distributionIncentive)) / SPLITS_SCALE;
  const rest = amount - distributorReward;
  return {
    amounts: params.allocations.map(a => (rest * a) / params.totalAllocation),
    distributorReward,
  };
};
