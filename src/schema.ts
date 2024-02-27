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
}

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
            minLength: 42,
            maxLength: 42,
          },
          withdrawal_address: {
            type: 'string',
            minLength: 42,
            maxLength: 42,
          },
        },
        required: ['fee_recipient_address', 'withdrawal_address'],
      },
    },
  },
  required: ['name', 'operators', 'validators'],
}
