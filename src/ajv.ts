import Ajv, { type ErrorObject } from 'ajv';
import { parseUnits } from 'ethers';
import {
  type RewardsSplitPayload,
  type SplitRecipient,
  type TotalSplitPayload,
} from './types';
import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
} from './constants';

const VALID_DEPOSIT_AMOUNTS = {
  COMPOUNDING: [
    Number(parseUnits('1', 'gwei')).toString(),
    Number(parseUnits('32', 'gwei')).toString(),
    Number(parseUnits('8', 'gwei')).toString(),
    Number(parseUnits('256', 'gwei')).toString()
  ],
  NON_COMPOUNDING: [
    Number(parseUnits('1', 'gwei')).toString(),
    Number(parseUnits('32', 'gwei')).toString()
  ]
};

const validDepositAmounts = (data: boolean, deposits: string[], parent: any): boolean => {
  // If deposits is null or empty, it's valid
  if (!deposits || deposits.length === 0) return true;

  const isCompounding = parent?.compounding ?? true;
  const validAmounts = isCompounding ? VALID_DEPOSIT_AMOUNTS.COMPOUNDING : VALID_DEPOSIT_AMOUNTS.NON_COMPOUNDING;

  // Check if all amounts are in the valid list
  return deposits.every((amount) => validAmounts.includes(amount));
};

const validateSplitRecipients = (
  _: boolean,
  data: RewardsSplitPayload | TotalSplitPayload,
): boolean => {
  const splitPercentage = data.splitRecipients.reduce(
    (acc: number, curr: SplitRecipient) => acc + curr.percentAllocation,
    0,
  );
  const ObolRAFSplitParam = data.ObolRAFSplit
    ? data.ObolRAFSplit
    : 'principalRecipient' in data
      ? DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT
      : DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT;
  return splitPercentage + ObolRAFSplitParam === 100;
};

export function validatePayload(
  data: any,
  schema: any,
): ErrorObject[] | undefined | null | boolean {
  const ajv = new Ajv();
  ajv.addKeyword({
    keyword: 'validDepositAmounts',
    validate: validDepositAmounts,
    errors: true,
  });

  ajv.addKeyword({
    keyword: 'validateSplitRecipients',
    validate: validateSplitRecipients,
    errors: true,
  });
  const validate = ajv.compile(schema);
  const isValid = validate(data);
  if (!isValid) {
    throw new Error(
      `Schema compilation errors', ${validate.errors?.[0].message}`,
    );
  }
  return isValid;
}
