import { ZeroAddress } from 'ethers';
import {
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT,
  PRINCIPAL_THRESHOLD,
} from './constants.js';
import { VALID_DEPOSIT_AMOUNTS, VALID_NON_COMPOUNDING_AMOUNTS } from './ajv.js';

export const ADDRESS_PATTERN = '^0x[a-fA-F0-9]{40}$';
const ZERO_ADDRESS_PATTERN = '^0x0{40}$';

const addressSchema = {
  type: 'string',
  pattern: ADDRESS_PATTERN,
};

const nonZeroAddressSchema = {
  ...addressSchema,
  not: { pattern: ZERO_ADDRESS_PATTERN },
};

// Split recipient share, in percent. Must be positive and at most 100.
const percentAllocationSchema = {
  type: 'number',
  exclusiveMinimum: 0,
  maximum: 100,
};

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
          // Empty for solo clusters, where every operator address is ''.
          address: {
            type: 'string',
            pattern: '^(0x[a-fA-F0-9]{40})?$',
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
          fee_recipient_address: nonZeroAddressSchema,
          withdrawal_address: nonZeroAddressSchema,
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
  // The validated payload is spread into the signed cluster config, so only
  // known fields are accepted.
  additionalProperties: false,
};

export const totalSplitterPayloadSchema = {
  type: 'object',
  properties: {
    splitRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          account: addressSchema,
          percentAllocation: percentAllocationSchema,
        },
        required: ['account', 'percentAllocation'],
      },
      uniqueRecipientAddresses: 'account',
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
      pattern: ADDRESS_PATTERN,
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
      pattern: ADDRESS_PATTERN,
      default: ZeroAddress,
    },
    etherAmount: { type: 'number' },
    principalRecipient: {
      type: 'string',
      pattern: ADDRESS_PATTERN,
    },
  },
  validateRewardsSplitRecipients: true,
  required: ['splitRecipients', 'principalRecipient', 'etherAmount'],
};

export const ovmBaseSplitPayload = {
  rewardSplitRecipients: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        address: addressSchema,
        percentAllocation: percentAllocationSchema,
      },
      required: ['address', 'percentAllocation'],
    },
    uniqueRecipientAddresses: 'address',
  },
  OVMOwnerAddress: {
    type: 'string',
    pattern: ADDRESS_PATTERN,
  },
  splitOwnerAddress: {
    type: 'string',
    pattern: ADDRESS_PATTERN,
    default: ZeroAddress,
  },
  principalThreshold: {
    type: 'number',
    minimum: 16,
    default: PRINCIPAL_THRESHOLD,
  },
  distributorFeePercent: {
    type: 'number',
    minimum: 0,
    maximum: 10,
    default: 0,
  },
};

export const ovmRewardsSplitPayloadSchema = {
  type: 'object',
  properties: {
    ...ovmBaseSplitPayload,
    principalRecipient: {
      type: 'string',
      pattern: ADDRESS_PATTERN,
    },
  },
  validateOVMRewardsSplitRecipients: true,
  required: ['rewardSplitRecipients', 'OVMOwnerAddress', 'principalRecipient'],
};

export const ovmTotalSplitPayloadSchema = {
  type: 'object',
  properties: {
    ...ovmBaseSplitPayload,
    principalSplitRecipients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          address: addressSchema,
          percentAllocation: percentAllocationSchema,
        },
        required: ['address', 'percentAllocation'],
      },
      uniqueRecipientAddresses: 'address',
    },
  },
  validateOVMRewardsSplitRecipients: true,
  validateOVMTotalSplitRecipients: true,
  required: [
    'rewardSplitRecipients',
    'principalSplitRecipients',
    'OVMOwnerAddress',
  ],
};

export const ovmRequestWithdrawalPayloadSchema = {
  type: 'object',
  properties: {
    withdrawalFees: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
    ovmAddress: {
      type: 'string',
      pattern: ADDRESS_PATTERN,
    },
    excessFeeRecipient: nonZeroAddressSchema,
    pubKeys: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        pattern: '^0x[a-fA-F0-9]{96}$', // 48 bytes = 96 hex chars + 0x prefix
      },
    },
    amounts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        pattern: '^[0-9]+$',
      },
    },
  },
  validateOVMRequestWithdrawalPayload: true,
  required: ['ovmAddress', 'pubKeys', 'amounts'],
};

export const eoaWithdrawalPayloadSchema = {
  type: 'object',
  properties: {
    pubkey: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{96}$', // 48 bytes = 96 hex chars + 0x prefix
    },
    allocation: {
      type: 'number',
      minimum: 0,
    },
    requiredFee: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
  },
  required: ['pubkey', 'allocation'],
};

export const ovmDepositPayloadSchema = {
  type: 'object',
  properties: {
    ovmAddress: {
      type: 'string',
      pattern: ADDRESS_PATTERN,
    },
    deposits: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          pubkey: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{96}$',
          },
          withdrawal_credentials: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{64}$',
            description: '32 bytes withdrawal credentials',
          },
          signature: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{192}$',
            description: '96 bytes signature (190 hex chars + 0x prefix)',
          },
          deposit_data_root: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{64}$', // 32 bytes = 64 hex chars + 0x prefix
          },
          amount: {
            type: 'string',
            pattern: '^[0-9]+$',
          },
        },
        required: [
          'pubkey',
          'withdrawal_credentials',
          'signature',
          'deposit_data_root',
          'amount',
        ],
      },
    },
    skipSignatureVerification: {
      type: 'boolean',
    },
    beaconUrl: {
      type: 'string',
      minLength: 1,
    },
  },
  required: ['ovmAddress', 'deposits'],
};

export const eoaDepositPayloadSchema = {
  type: 'object',
  properties: {
    deposits: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          pubkey: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{96}$',
          },
          withdrawal_credentials: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{64}$',
            description: '32 bytes withdrawal credentials',
          },
          signature: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{192}$',
            description: '96 bytes signature (190 hex chars + 0x prefix)',
          },
          deposit_data_root: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{64}$', // 32 bytes = 64 hex chars + 0x prefix
          },
          amount: {
            type: 'string',
            pattern: '^[0-9]+$',
          },
        },
        required: [
          'pubkey',
          'withdrawal_credentials',
          'signature',
          'deposit_data_root',
          'amount',
        ],
      },
    },
    expectedWithdrawalAddress: {
      type: 'string',
      pattern: '^0x[a-fA-F0-9]{40}$',
    },
    skipSignatureVerification: {
      type: 'boolean',
    },
    beaconUrl: {
      type: 'string',
      minLength: 1,
    },
  },
  required: ['deposits'],
};
