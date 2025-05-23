import { type JSONSchemaType } from 'ajv';

const VALID_DEPOSIT_AMOUNTS = {
  COMPOUNDING: ['1000000000', '32000000000', '8000000000', '256000000000'],
  NON_COMPOUNDING: ['1000000000', '32000000000']
};

export const validateDepositAmounts: JSONSchemaType<any> = {
  type: 'array',
  items: {
    type: 'string',
    pattern: '^[0-9]+$'
  },
  validate: function(data: any, parent: any) {
    if (!data || data.length === 0) return true;

    const isCompounding = parent?.compounding ?? true;
    const validAmounts = isCompounding ? VALID_DEPOSIT_AMOUNTS.COMPOUNDING : VALID_DEPOSIT_AMOUNTS.NON_COMPOUNDING;

    return data.every((amount: string) => validAmounts.includes(amount));
  }
};
