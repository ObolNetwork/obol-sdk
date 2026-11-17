import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type RewardsSplitPayload,
  type TotalSplitPayload,
  type OVMRequestWithdrawalPayload,
} from './types.js';
import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
} from './constants.js';

// Custom JSON-schema keywords used in src/schema.ts. They are compiled into
// src/generated/validators.ts by scripts/generate-validators.mjs, which
// calls these functions by name through `import * as customKeywords`, so
// every function a keyword uses must be exported from this module under the
// keyword's name.

// Split contracts take allocations as integers where 100% = 1e6 (four
// decimals of a percent); formatSplitRecipients scales by the same factor.
const PERCENT_SCALE = 1e4;
const TOTAL_SCALED_PERCENT = 100 * PERCENT_SCALE;

const toScaledPercent = (percent: number): number =>
  Math.round(percent * PERCENT_SCALE);

/**
 * Sums the recipients' allocations as scaled integers, so the comparison
 * against 100% is exact. Returns NaN if any allocation is not a number or
 * rounds to zero at contract precision.
 */
const calculateTotalPercentage = (
  recipients: Array<{ percentAllocation: number }> | undefined,
): number => {
  if (!Array.isArray(recipients)) {
    return NaN;
  }
  return recipients.reduce((acc, curr) => {
    const percent = curr?.percentAllocation;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      return NaN;
    }
    const scaled = toScaledPercent(percent);
    return scaled < 1 ? NaN : acc + scaled;
  }, 0);
};

const validateTotalPercentageWithRAF = (
  totalPercentage: number,
  rafPercentage: number,
): boolean => {
  return (
    totalPercentage + toScaledPercent(rafPercentage) === TOTAL_SCALED_PERCENT
  );
};

export const uniqueRecipientAddresses = (
  key: string,
  recipients: Array<Record<string, unknown>>,
): boolean => {
  if (!Array.isArray(recipients)) {
    return true;
  }
  const addresses = recipients.map(recipient =>
    String(recipient?.[key]).toLowerCase(),
  );
  return new Set(addresses).size === addresses.length;
};

export const validateRewardsSplitRecipients = (
  _: boolean,
  data: RewardsSplitPayload,
): boolean => {
  const obolRAFSplit =
    data?.ObolRAFSplit ?? DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.splitRecipients);
  return validateTotalPercentageWithRAF(splitPercentage, obolRAFSplit);
};

export const validateTotalSplitRecipients = (
  _: boolean,
  data: TotalSplitPayload,
): boolean => {
  const obolRAFSplit =
    data.ObolRAFSplit ?? DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.splitRecipients);
  return validateTotalPercentageWithRAF(splitPercentage, obolRAFSplit);
};

export const validateUniqueAddresses = (
  _: boolean,
  operators: Array<{ address: string }>,
): boolean => {
  if (!operators) {
    return false;
  }

  if (operators.length < 4) {
    return false;
  }

  if (operators.every(op => op?.address === '')) {
    return true;
  }

  if (
    operators.some(
      op =>
        typeof op?.address !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(op.address),
    )
  ) {
    return false;
  }

  const addresses = operators.map(op => op.address.toLowerCase());
  const uniqueAddresses = new Set(addresses);
  const isUnique = uniqueAddresses.size === addresses.length;
  return isUnique;
};

/**
 * SplitV2 (used with the OVM) takes the sum of the allocations as its total,
 * so shares that do not add up to exactly 100% at contract precision are
 * still split proportionally. Allow up to one unit (1e-4 %) of rounding per
 * recipient, e.g. three shares of 33.3333...% after spreading 1% over them.
 */
const isTotalWithinRoundingOfFull = (
  totalPercentage: number,
  recipientCount: number,
): boolean =>
  Math.abs(totalPercentage - TOTAL_SCALED_PERCENT) <= recipientCount;

export const validateOVMRewardsSplitRecipients = (
  _: boolean,
  data: OVMRewardsSplitPayload,
): boolean => {
  const obolRAFSplit = DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.rewardSplitRecipients);
  return isTotalWithinRoundingOfFull(
    splitPercentage + toScaledPercent(obolRAFSplit),
    (data.rewardSplitRecipients?.length ?? 0) + 1,
  );
};

export const validateOVMTotalSplitRecipients = (
  _: boolean,
  data: OVMTotalSplitPayload,
): boolean => {
  const splitPercentage = calculateTotalPercentage(
    data.principalSplitRecipients,
  );
  return isTotalWithinRoundingOfFull(
    splitPercentage,
    data.principalSplitRecipients?.length ?? 0,
  );
};

export const validateOVMRequestWithdrawalPayload = (
  _: boolean,
  data: OVMRequestWithdrawalPayload,
): boolean => {
  if (!data.pubKeys || !data.amounts) {
    return false;
  }

  if (data.pubKeys.length !== data.amounts.length) {
    return false;
  }

  // // Validate that all amounts are at least 1,000,000 gwei
  // const minAmount = BigInt(1000000);
  // for (const amountStr of data.amounts) {
  //   const minAmount = BigInt(1000000);
  //   const amount = BigInt(amountStr);
  //   if (amount < minAmount) {
  //     return false;
  //   }
  // }

  return true;
};

export interface CustomKeyword {
  keyword: string;
  schemaType: 'boolean' | 'string';
  error?: { message: string };
}

/** Keyword definitions; `validate` is the export of the same name. */
export const CUSTOM_KEYWORDS: CustomKeyword[] = [
  { keyword: 'validateRewardsSplitRecipients', schemaType: 'boolean' },
  { keyword: 'validateTotalSplitRecipients', schemaType: 'boolean' },
  { keyword: 'validateUniqueAddresses', schemaType: 'boolean' },
  {
    keyword: 'uniqueRecipientAddresses',
    schemaType: 'string',
    error: { message: 'must not contain duplicate recipient addresses' },
  },
  { keyword: 'validateOVMRewardsSplitRecipients', schemaType: 'boolean' },
  { keyword: 'validateOVMTotalSplitRecipients', schemaType: 'boolean' },
  { keyword: 'validateOVMRequestWithdrawalPayload', schemaType: 'boolean' },
];
