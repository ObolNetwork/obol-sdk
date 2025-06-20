import { ZeroAddress } from 'ethers';
import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
  PRINCIPAL_THRESHOLD,
} from './constants';
import { VALID_DEPOSIT_AMOUNTS, VALID_NON_COMPOUNDING_AMOUNTS } from './ajv';

export const operatorPayloadSchema = {
  type: 'object',
  properties: {
    version: { type: 'string' },
    enr: { type: 'string' },
  },
  required: ['version', 'enr'],
};

export const definitionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    operators: {
      type: 'array',
      minItems: 4,
      items: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
          },
        },
        required: ['address'],
      },
      validateUniqueAddresses: true,
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
      type: ['array', 'null'],
      items: {
        type: 'string',
        pattern: '^[0-9]+$',
      },
      if: {
        $data: '1/compounding',
      },
      then: {
        items: {
          enum: VALID_DEPOSIT_AMOUNTS,
        },
      },
      else: {
        items: {
          enum: VALID_NON_COMPOUNDING_AMOUNTS,
        },
      },
      default: null,
    },
    compounding: {
      type: 'boolean',
      default: false,
    },
    target_gas_limit: {
      type: 'number',
      minimum: 1,
      default: 36000000,
    },
    consensus_protocol: {
      type: 'string',
      enum: ['qbft', ''],
      default: '',
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
          percentAllocation: { type: 'number' },
        },
        required: ['account', 'percentAllocation'],
      },
    },
    ObolRAFSplit: {
      type: 'number',
      minimum: DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
      default: DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
    },
    distributorFee: {
      type: 'number',
      maximum: 10,
      multipleOf: 0.01,
      default: 0,
    },
    controllerAddress: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
      default: ZeroAddress,
    },
  },
  validateTotalSplitRecipients: true,
  required: ['splitRecipients'],
};

export const rewardsSplitterPayloadSchema = {
  type: 'object',
  properties: {
    ...totalSplitterPayloadSchema.properties,
    ObolRAFSplit: {
      type: 'number',
      minimum: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
      default: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    },
    recoveryAddress: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
      default: ZeroAddress,
    },
    etherAmount: { type: 'number' },
    principalRecipient: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
  },
  validateRewardsSplitRecipients: true,
  required: ['splitRecipients', 'principalRecipient', 'etherAmount'],
};

export const ovmBaseSplitPayloadSchema = {
  type: 'object',
  properties: {
    splitRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
          percentAllocation: { type: 'number' },
        },
        required: ['address', 'percentAllocation'],
      },
    },
    ownerAddress: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
    principalThreshold: {
      type: 'number',
      minimum: 0,
      default: PRINCIPAL_THRESHOLD,
    },
    distributorFeePercent: {
      type: 'number',
      minimum: 0,
      maximum: 10,
      default: 0,
    },
  },
  validateRewardsSplitRecipientsvalidateRewardsSplitRecipients: true,
  required: ['splitRecipients', 'ownerAddress'],
};

export const ovmRewardsSplitPayloadSchema = {
  type: 'object',
  properties: {
    ...ovmBaseSplitPayloadSchema.properties,
    principalRecipient: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
  },
  validateRewardsSplitRecipients: true,
  required: ['splitRecipients', 'ownerAddress', 'principalRecipient'],
};

export const ovmTotalSplitPayloadSchema = {
  type: 'object',
  properties: {
    ...ovmBaseSplitPayloadSchema.properties,
    principalRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
          percentAllocation: { type: 'number' },
        },
        required: ['account', 'percentAllocation'],
      },
    },
  },
  validateTotalSplitRecipients: true,
  required: ['splitRecipients', 'principalRecipients', 'ownerAddress'],
};
