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

const validDepositAmounts = (data: boolean, deposits: string[]): boolean => {
  let sum = 0;
  // from ether togwei is same as from gwei to wei
  const maxDeposit = Number(parseUnits('32', 'gwei'));
  const minDeposit = Number(parseUnits('1', 'gwei'));

  for (const element of deposits) {
    const amountInGWei = Number(element);

    if (
      !Number.isInteger(amountInGWei) ||
      amountInGWei > maxDeposit ||
      amountInGWei < minDeposit
    ) {
      return false;
    }
    sum += amountInGWei;
  }
  if (sum / minDeposit !== 32) {
    return false;
  } else {
    return true;
  }
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
