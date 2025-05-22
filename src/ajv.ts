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
  _: any,
  data: any,
): boolean => {
  const deposits = Array.isArray(data?.deposit_amounts) ? data.deposit_amounts : [];

  if (deposits.length === 0) return true;

  const isCompounding = data?.compounding ?? true;
  console.log(isCompounding, "isCompounding")
  const validAmounts = VALID_DEPOSIT_AMOUNTS

  return deposits.every((amount: string) => validAmounts.includes(amount));
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
  data: { operators: Array<{ address: string }> },
): boolean => {
  if (!data?.operators?.length) return true;
  
  // Get all non-empty addresses
  const validAddresses = data.operators
    .map(op => op.address)
    .filter(addr => addr.length === 42);
    
  // If no valid addresses, validation passes
  if (validAddresses.length === 0) return true;
    
  // Check if all valid addresses are unique
  const uniqueAddresses = new Set(validAddresses);
  return uniqueAddresses.size === validAddresses.length;
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
