import addFormats from 'ajv-formats';
import addKeywords from 'ajv-keywords';
import { parseUnits } from 'ethers';
import {
  type RewardsSplitPayload,
  type SplitRecipient,
  type TotalSplitPayload,
} from './types';
import Ajv from 'ajv';

const VALID_DEPOSIT_AMOUNTS = [
  parseUnits('1', 'gwei').toString(),
  parseUnits('32', 'gwei').toString(),
  parseUnits('8', 'gwei').toString(),
  parseUnits('256', 'gwei').toString(),
]

const validDepositAmounts = (
  _: boolean,
  deposit_amounts: string[],
): boolean => {

  if (deposit_amounts === null) return true;

  return deposit_amounts.every((amount: string) => VALID_DEPOSIT_AMOUNTS.includes(amount));
};

const validateSplitRecipients = (
  _: boolean,
  data: RewardsSplitPayload | TotalSplitPayload,
): boolean => {
  const splitPercentage = data.splitRecipients.reduce(
    (acc: number, curr: SplitRecipient) => acc + curr.percentAllocation,
    0,
  );
  return Math.abs(splitPercentage + (data.ObolRAFSplit ?? 0) + (data.distributorFee ?? 0) - 100) < 0.001;
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

  if (operators.every(op => op.address === "")) {
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

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
addFormats(ajv);
addKeywords(ajv, ['patternRequired']);

ajv.addKeyword({
  keyword: 'validDepositAmounts',
  validate: validDepositAmounts,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateSplitRecipients',
  validate: validateSplitRecipients,
  schemaType: 'boolean',
});

ajv.addKeyword({
  keyword: 'validateUniqueAddresses',
  validate: validateUniqueAddresses,
  schemaType: 'boolean',
});

export function validatePayload<T>(data: unknown, schema: object): T {
  const validate = ajv.compile<T>(schema as any);
  const valid = validate(data);
  if (!valid) {
    const errors = validate.errors
      ?.map((e) => `${e.instancePath} ${e.message}`)
      .join(', ');
    throw new Error(`Validation failed: ${errors}`);
  }
  return data as T;
}
