import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
} from './constants';

export const operatorPayloadSchema = {
  type: 'object',
  properties: {
    version: {
      type: 'string',
    },
    enr: {
      type: 'string',
    },
  },
  required: ['version', 'enr'],
};

export const definitionSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
    },
    operators: {
      type: 'array',
      minItems: 4,
      uniqueItems: true,
      items: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            minLength: 42,
            maxLength: 42,
          },
        },
        required: ['address'],
      },
    },
    validators: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          fee_recipient_address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
          withdrawal_address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
        },
        required: ['fee_recipient_address', 'withdrawal_address'],
      },
    },
    deposit_amounts: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[0-9]+$',
      },
      validDepositAmounts: true,
    },
  },
  required: ['name', 'operators', 'validators'],
};

export const totalSplitterPayloadSchema = {
  type: 'object',
  properties: {
    splitRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          account: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
          percentAllocation: {
            type: 'number',
          },
        },
        required: ['account', 'percentAllocation'],
      },
    },
    ObolRAFSplit: {
      type: 'number',
      minimum: DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
    },
    distributorFee: {
      type: 'number',
      maximum: 10,
      multipleOf: 0.01,
    },
    controllerAddress: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
    validateSplitRecipients: true,
  },
  required: ['splitRecipients'],
};

export const rewardsSplitterPayloadSchema = {
  ...totalSplitterPayloadSchema,
  properties: {
    ...totalSplitterPayloadSchema.properties,
    ObolRAFSplit: {
      type: 'number',
      minimum: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    },
    etherAmount: {
      type: 'number',
    },
    principalRecipient: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
  },
  required: ['splitRecipients', 'principalRecipient', 'etherAmount'],
};
