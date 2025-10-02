import { validatePayload } from '../../src/ajv.js';
import {
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
  ovmRequestWithdrawalPayloadSchema,
} from '../../src/schema.js';
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
} from '../../src/types.js';
import { TEST_ADDRESSES } from '../fixtures.js';

describe('validatePayload - OVM Schemas', () => {
  describe('ovmRewardsSplitPayloadSchema', () => {
    const validRewardsSplitPayload: OVMRewardsSplitPayload = {
      rewardSplitRecipients: [
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      distributorFeePercent: 0,
    };

    it('should validate a valid rewards split payload', () => {
      const result = validatePayload(
        validRewardsSplitPayload,
        ovmRewardsSplitPayloadSchema,
      );
      expect(result).toEqual(validRewardsSplitPayload);
    });

    it('should validate rewards split payload with default values', () => {
      const payloadWithoutDefaults = {
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
        principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      };

      const result = validatePayload(
        payloadWithoutDefaults,
        ovmRewardsSplitPayloadSchema,
      );
      expect(result).toEqual({
        ...payloadWithoutDefaults,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS, // default value
        principalThreshold: 16, // default value
        distributorFeePercent: 0, // default value
      });
    });

    it('should throw error when rewardSplitRecipients total percentage is not 99%', () => {
      const invalidPayload = {
        ...validRewardsSplitPayload,
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 40 }, // Total: 90%
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMRewardsSplitRecipients" keyword validation',
      );
    });

    it('should throw error when rewardSplitRecipients total percentage exceeds 99%', () => {
      const invalidPayload = {
        ...validRewardsSplitPayload,
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 60 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 50 }, // Total: 110%
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMRewardsSplitRecipients" keyword validation',
      );
    });

    it('should throw error when rewardSplitRecipients is empty', () => {
      const invalidPayload = {
        ...validRewardsSplitPayload,
        rewardSplitRecipients: [],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMRewardsSplitRecipients" keyword validation',
      );
    });

    it('should throw error when rewardSplitRecipients has invalid address format', () => {
      const invalidPayload = {
        ...validRewardsSplitPayload,
        rewardSplitRecipients: [
          { address: 'invalid-address', percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        'Validation failed: /rewardSplitRecipients/0/address must match pattern',
      );
    });

    it('should throw error when OVMOwnerAddress is missing', () => {
      const invalidPayload = {
        rewardSplitRecipients: validRewardsSplitPayload.rewardSplitRecipients,
        principalRecipient: validRewardsSplitPayload.principalRecipient,
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        "Validation failed:  must have required property 'OVMOwnerAddress'",
      );
    });

    it('should throw error when principalRecipient is missing', () => {
      const invalidPayload = {
        rewardSplitRecipients: validRewardsSplitPayload.rewardSplitRecipients,
        OVMOwnerAddress: validRewardsSplitPayload.OVMOwnerAddress,
      };

      expect(() =>
        validatePayload(invalidPayload, ovmRewardsSplitPayloadSchema),
      ).toThrow(
        "Validation failed:  must have required property 'principalRecipient'",
      );
    });
  });

  describe('ovmTotalSplitPayloadSchema', () => {
    const validTotalSplitPayload: OVMTotalSplitPayload = {
      rewardSplitRecipients: [
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
        { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
      ],
      principalSplitRecipients: [
        {
          address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
          percentAllocation: 60,
        },
        {
          address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
          percentAllocation: 40,
        },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      distributorFeePercent: 0,
    };

    it('should validate a valid total split payload', () => {
      const result = validatePayload(
        validTotalSplitPayload,
        ovmTotalSplitPayloadSchema,
      );
      expect(result).toEqual(validTotalSplitPayload);
    });

    it('should validate total split payload with default values', () => {
      const payloadWithoutDefaults = {
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 49 },
        ],
        principalSplitRecipients: [
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 60,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 40,
          },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      };

      const result = validatePayload(
        payloadWithoutDefaults,
        ovmTotalSplitPayloadSchema,
      );
      expect(result).toEqual({
        ...payloadWithoutDefaults,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS, // default value
        principalThreshold: 16, // default value
        distributorFeePercent: 0, // default value
      });
    });

    it('should throw error when rewardSplitRecipients total percentage is not 99%', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 50 },
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 40 }, // Total: 90%
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMRewardsSplitRecipients" keyword validation',
      );
    });

    it('should throw error when principalSplitRecipients total percentage is not 100%', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        principalSplitRecipients: [
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 60,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 30,
          }, // Total: 90%
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMTotalSplitRecipients" keyword validation',
      );
    });

    it('should throw error when principalSplitRecipients total percentage exceeds 100%', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        principalSplitRecipients: [
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 70,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 40,
          }, // Total: 110%
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMTotalSplitRecipients" keyword validation',
      );
    });

    it('should throw error when principalSplitRecipients is empty', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        principalSplitRecipients: [],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        'Validation failed:  must pass "validateOVMTotalSplitRecipients" keyword validation',
      );
    });

    it('should throw error when principalSplitRecipients has invalid address format', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        principalSplitRecipients: [
          { address: 'invalid-address', percentAllocation: 60 },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 40,
          },
        ],
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        'Validation failed: /principalSplitRecipients/0/address must match pattern',
      );
    });

    it('should throw error when OVMOwnerAddress is missing', () => {
      const invalidPayload = {
        rewardSplitRecipients: validTotalSplitPayload.rewardSplitRecipients,
        principalSplitRecipients:
          validTotalSplitPayload.principalSplitRecipients,
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow(
        "Validation failed:  must have required property 'OVMOwnerAddress'",
      );
    });

    it('should throw error when principalThreshold is less than 16', () => {
      const invalidPayload = {
        ...validTotalSplitPayload,
        principalThreshold: 15,
      };

      expect(() =>
        validatePayload(invalidPayload, ovmTotalSplitPayloadSchema),
      ).toThrow('Validation failed: /principalThreshold must be >= 16');
    });

    it('should validate when principalThreshold is exactly 16', () => {
      const validPayload = {
        ...validTotalSplitPayload,
        principalThreshold: 16,
      };

      const result = validatePayload(validPayload, ovmTotalSplitPayloadSchema);
      expect(result).toEqual(validPayload);
    });

    it('should validate when principalThreshold is greater than 16', () => {
      const validPayload = {
        ...validTotalSplitPayload,
        principalThreshold: 20,
      };

      const result = validatePayload(validPayload, ovmTotalSplitPayloadSchema);
      expect(result).toEqual(validPayload);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle decimal percentages correctly for rewards split', () => {
      const payload = {
        rewardSplitRecipients: [
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
            percentAllocation: 49.5,
          },
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_2,
            percentAllocation: 49.5,
          },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
        principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      };

      const result = validatePayload(payload, ovmRewardsSplitPayloadSchema);
      expect(result).toEqual({
        ...payload,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS,
        principalThreshold: 16,
        distributorFeePercent: 0,
      });
    });

    it('should handle decimal percentages correctly for total split', () => {
      const payload = {
        rewardSplitRecipients: [
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
            percentAllocation: 49.5,
          },
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_2,
            percentAllocation: 49.5,
          },
        ],
        principalSplitRecipients: [
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 60.5,
          },
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
            percentAllocation: 39.5,
          },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      };

      const result = validatePayload(payload, ovmTotalSplitPayloadSchema);
      expect(result).toEqual({
        ...payload,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS,
        principalThreshold: 16,
        distributorFeePercent: 0,
      });
    });

    it('should handle single recipient with 99% allocation for rewards split', () => {
      const payload = {
        rewardSplitRecipients: [
          { address: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 99 },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
        principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      };

      const result = validatePayload(payload, ovmRewardsSplitPayloadSchema);
      expect(result).toEqual({
        ...payload,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS,
        principalThreshold: 16,
        distributorFeePercent: 0,
      });
    });

    it('should handle single recipient with 100% allocation for total split', () => {
      const payload = {
        rewardSplitRecipients: [
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
            percentAllocation: 49.5,
          },
          {
            address: TEST_ADDRESSES.REWARD_RECIPIENT_2,
            percentAllocation: 49.5,
          },
        ],
        principalSplitRecipients: [
          {
            address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
            percentAllocation: 100,
          },
        ],
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      };

      const result = validatePayload(payload, ovmTotalSplitPayloadSchema);
      expect(result).toEqual({
        ...payload,
        splitOwnerAddress: TEST_ADDRESSES.ZERO_ADDRESS,
        principalThreshold: 16,
        distributorFeePercent: 0,
      });
    });
  });
});

describe('ovmRequestWithdrawalPayloadSchema', () => {
  const validPayload = {
    ovmAddress: '0x1234567890123456789012345678901234567890',
    pubKeys: [
      '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456',
    ],
    amounts: ['32000000000'],
    withdrawalFees: '1',
  };

  it('should throw error when OVM address is missing', () => {
    const payload = {
      pubKeys: validPayload.pubKeys,
      amounts: validPayload.amounts,
    };
    expect(() =>
      validatePayload(payload, ovmRequestWithdrawalPayloadSchema),
    ).toThrow("Validation failed:  must have required property 'ovmAddress'");
  });

  it('should throw error when OVM address is invalid', () => {
    const payload = {
      ovmAddress: '0x123', // Too short
      pubKeys: validPayload.pubKeys,
      amounts: validPayload.amounts,
    };
    expect(() =>
      validatePayload(payload, ovmRequestWithdrawalPayloadSchema),
    ).toThrow(
      'Validation failed:  must have required property \'withdrawalFees\', /ovmAddress must match pattern "^0x[a-fA-F0-9]{40}$"',
    );
  });

  it('should throw error when number of public keys does not match number of amounts', () => {
    const payload = {
      ovmAddress: validPayload.ovmAddress,
      pubKeys: validPayload.pubKeys,
      amounts: ['32000000000', '16000000000'], // 2 amounts, 1 pubKey
      withdrawalFees: validPayload.withdrawalFees,
    };
    expect(() =>
      validatePayload(payload, ovmRequestWithdrawalPayloadSchema),
    ).toThrow(
      'Validation failed:  must pass "validateOVMRequestWithdrawalPayload" keyword validation',
    );
  });

  it('should throw error when withdrawalFees is missing', () => {
    const payload = {
      ovmAddress: validPayload.ovmAddress,
      pubKeys: validPayload.pubKeys,
      amounts: validPayload.amounts,
    };
    expect(() =>
      validatePayload(payload, ovmRequestWithdrawalPayloadSchema),
    ).toThrow(
      "Validation failed:  must have required property 'withdrawalFees'",
    );
  });

  it('should throw error when withdrawalFees is invalid', () => {
    const payload = {
      ovmAddress: validPayload.ovmAddress,
      pubKeys: validPayload.pubKeys,
      amounts: validPayload.amounts,
      withdrawalFees: 'invalid',
    };
    expect(() =>
      validatePayload(payload, ovmRequestWithdrawalPayloadSchema),
    ).toThrow(
      'Validation failed: /withdrawalFees must match pattern "^[0-9]+$"',
    );
  });
});
