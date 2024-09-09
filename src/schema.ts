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
            pattern: "^0x[a-fA-F0-9]{40}$"
          },
          withdrawal_address: {
            type: 'string',
            pattern: "^0x[a-fA-F0-9]{40}$"
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

export const rewardsSplitterPayloadSchema = {
  type: 'object',
  properties: {
    splitRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          account: {
            type: 'string',
            pattern: "^0x[a-fA-F0-9]{40}$"
          },
          percentAllocation: {
            type: 'number',
          },
        },
        required: ['account', 'percentAllocation'],
      },
    },
    principalRecipient: {
      type: 'string',
      minLength: 42,
      maxLength: 42,
    },
    validatorsSize: {
      type: 'number',
    },
    ObolRAFSplit: {
      type: 'number',
      minimum: 1
    },
    distributorFee: {
      type: "number",
      maximum: 10,
      multipleOf: 0.01
    },
    controllerAddress: {
      type: 'string',
      pattern: "^0x[a-fA-F0-9]{40}$"
    },
    validateSplitRecipients: true,

  },
  required: ['splitRecipients', 'principalRecipient', 'validatorsSize'], 
}