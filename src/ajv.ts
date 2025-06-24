import addFormats from 'ajv-formats';
import addKeywords from 'ajv-keywords';
import { parseUnits } from 'ethers';
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type RewardsSplitPayload,
  type TotalSplitPayload,
} from './types';
import Ajv from 'ajv';
import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
} from './constants';

export const VALID_DEPOSIT_AMOUNTS = [
  parseUnits('1', 'gwei').toString(),
  parseUnits('32', 'gwei').toString(),
  parseUnits('8', 'gwei').toString(),
  parseUnits('256', 'gwei').toString(),
];

export const VALID_NON_COMPOUNDING_AMOUNTS = [
  parseUnits('1', 'gwei').toString(),
  parseUnits('32', 'gwei').toString(),
];

const calculateTotalPercentage = (
  recipients: Array<{ percentAllocation: number }>,
): number => {
  return recipients.reduce((acc, curr) => acc + curr.percentAllocation, 0);
};

const validateTotalPercentage = (totalPercentage: number): boolean => {
  return totalPercentage === 100;
};

const validateTotalPercentageWithRAF = (
  totalPercentage: number,
  rafPercentage: number,
): boolean => {
  return totalPercentage + rafPercentage === 100;
};

const validateRewardsSplitRecipients = (
  _: boolean,
  data: RewardsSplitPayload,
): boolean => {
  const obolRAFSplit =
    data?.ObolRAFSplit ?? DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.splitRecipients);
  return validateTotalPercentageWithRAF(splitPercentage, obolRAFSplit);
};

const validateTotalSplitRecipients = (
  _: boolean,
  data: TotalSplitPayload,
): boolean => {
  const obolRAFSplit =
    data.ObolRAFSplit ?? DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.splitRecipients);
  return validateTotalPercentageWithRAF(splitPercentage, obolRAFSplit);
};

const validateUniqueAddresses = (
  _: boolean,
  operators: Array<{ address: string }>,
): boolean => {
  if (!operators) {
    return false;
  }

  if (operators.length < 4) {
    return false;
  }

  if (operators.every(op => op.address === '')) {
    return true;
  }

  if (operators.some(op => op.address.length !== 42)) {
    return false;
  }

  const addresses = operators.map(op => op.address);
  const uniqueAddresses = new Set(addresses);
  const isUnique = uniqueAddresses.size === addresses.length;
  return isUnique;
};

const validateOVMRewardsSplitRecipients = (
  _: boolean,
  data: OVMRewardsSplitPayload,
): boolean => {
  const obolRAFSplit = DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT;
  const splitPercentage = calculateTotalPercentage(data.rewardSplitRecipients);
  return validateTotalPercentageWithRAF(splitPercentage, obolRAFSplit);
};

const validateOVMTotalSplitRecipients = (
  _: boolean,
  data: OVMTotalSplitPayload,
): boolean => {
  const splitPercentage = calculateTotalPercentage(
    data.principalSplitRecipients,
  );
  return validateTotalPercentage(splitPercentage);
};

const ajv = new Ajv({
  allErrors: true,
  useDefaults: true,
  strict: false,
  $data: true,
});
addFormats(ajv);
addKeywords(ajv, ['patternRequired']);

ajv.addKeyword({
  keyword: 'validateRewardsSplitRecipients',
  validate: validateRewardsSplitRecipients,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateTotalSplitRecipients',
  validate: validateTotalSplitRecipients,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateUniqueAddresses',
  validate: validateUniqueAddresses,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateOVMRewardsSplitRecipients',
  validate: validateOVMRewardsSplitRecipients,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateOVMTotalSplitRecipients',
  validate: validateOVMTotalSplitRecipients,
  schemaType: 'boolean',
});

export function validatePayload<T>(data: unknown, schema: object): T {
  const validate = ajv.compile<T>(schema);
  const valid = validate(data);
  if (!valid) {
    const errors = validate.errors
      ?.map(e => `${e.instancePath} ${e.message}`)
      .join(', ');
    throw new Error(`Validation failed: ${errors}`);
  }
  return data;
}
