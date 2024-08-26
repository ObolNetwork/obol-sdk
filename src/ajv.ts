import Ajv, { type ErrorObject } from 'ajv';
import { parseUnits } from 'ethers';
import { type SplitRecipient } from './types';

function validDepositAmounts(data: boolean, deposits: string[]): boolean {
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
}

function validateSplitRecipients(_: boolean, data: SplitRecipient[]) {
  const totalPercentage = data.reduce(
    (acc: number, curr: SplitRecipient) => acc + curr.percentAllocation,
    0,
  );
  return totalPercentage === 99;
}

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
