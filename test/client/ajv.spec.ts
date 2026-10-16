import { validatePayload } from '../../src/ajv.js';
import {
  definitionSchema,
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
  ovmRequestWithdrawalPayloadSchema,
  rewardsSplitterPayloadSchema,
  totalSplitterPayloadSchema,
} from '../../src/schema.js';
import {
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
} from '../../src/types.js';
import { TEST_ADDRESSES, clusterConfigV1X10 } from '../fixtures.js';

/**
 * Launchpad's "split everything" principal shares (confirm-configuration.tsx):
 * each reward share plus 1% / n, the 1% RAF of the reward split spread over
 * the n recipients.
 */
const launchpadPrincipalShares = (n: number): number[] => {
  const base = Math.floor(9900 / n) / 100;
  const shares = Array.from({ length: n }, () => base);
  shares[0] = Number((99 - base * (n - 1)).toFixed(2));
  return shares.map(share => share + 1 / n);
};

const recipientAddress = (i: number): string =>
  `0x${(i + 1).toString(16).padStart(40, 'a')}`;

describe('split percentage rounding (OVM / SplitV2)', () => {
  it.each([3, 6, 7, 9])(
    "accepts Launchpad's split-everything shares for %i recipients",
    n => {
      const principal = launchpadPrincipalShares(n);
      const rewards = principal.map(share => share - 1 / n);
      const payload = {
        rewardSplitRecipients: rewards.map((percentAllocation, i) => ({
          address: recipientAddress(i),
          percentAllocation,
        })),
        principalSplitRecipients: principal.map((percentAllocation, i) => ({
          address: recipientAddress(i),
          percentAllocation,
        })),
        OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
        splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
        distributorFeePercent: 0,
      };
      expect(() =>
        validatePayload(payload, ovmTotalSplitPayloadSchema),
      ).not.toThrow();
    },
  );

  it('still rejects totals off by more than one unit per recipient', () => {
    const payload = {
      rewardSplitRecipients: [
        { address: recipientAddress(0), percentAllocation: 99 },
      ],
      principalSplitRecipients: [
        { address: recipientAddress(0), percentAllocation: 50 },
        { address: recipientAddress(1), percentAllocation: 49.9997 },
      ],
      OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
      splitOwnerAddress: TEST_ADDRESSES.SPLIT_OWNER,
      distributorFeePercent: 0,
    };
    expect(() => validatePayload(payload, ovmTotalSplitPayloadSchema)).toThrow(
      'validateOVMTotalSplitRecipients',
    );
    // Two units off with two recipients is within rounding.
    payload.principalSplitRecipients[1].percentAllocation = 49.9998;
    expect(() =>
      validatePayload(payload, ovmTotalSplitPayloadSchema),
    ).not.toThrow();
  });

  it('keeps V1 SplitMain totals exact', () => {
    const shares = launchpadPrincipalShares(3).map(s => s - 1 / 3);
    const splitRecipients = shares.map((percentAllocation, i) => ({
      account: recipientAddress(i),
      percentAllocation: percentAllocation + 0.0001,
    }));
    expect(() =>
      validatePayload({ splitRecipients }, totalSplitterPayloadSchema),
    ).toThrow('Validation failed');
  });
});

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

    it('accepts distributor fees up to the SplitV2 maximum of 6.5535%', () => {
      for (const fee of [0, 2.5, 6.5535]) {
        expect(() =>
          validatePayload(
            { ...validRewardsSplitPayload, distributorFeePercent: fee },
            ovmRewardsSplitPayloadSchema,
          ),
        ).not.toThrow();
      }
      for (const fee of [6.5536, 10, -1]) {
        expect(() =>
          validatePayload(
            { ...validRewardsSplitPayload, distributorFeePercent: fee },
            ovmRewardsSplitPayloadSchema,
          ),
        ).toThrow('Validation failed');
      }
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

  it('accepts an excessFeeRecipient and rejects the zero address', () => {
    expect(() =>
      validatePayload(
        {
          ...validPayload,
          excessFeeRecipient: TEST_ADDRESSES.REWARD_RECIPIENT_1,
        },
        ovmRequestWithdrawalPayloadSchema,
      ),
    ).not.toThrow();
    expect(() =>
      validatePayload(
        { ...validPayload, excessFeeRecipient: '0x' + '0'.repeat(40) },
        ovmRequestWithdrawalPayloadSchema,
      ),
    ).toThrow('Validation failed');
  });

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
      'Validation failed: /ovmAddress must match pattern "^0x[a-fA-F0-9]{40}$"',
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

  it('should accept a payload without withdrawalFees (read from chain)', () => {
    const payload = {
      ovmAddress: validPayload.ovmAddress,
      pubKeys: validPayload.pubKeys,
      amounts: validPayload.amounts,
    };
    expect(validatePayload(payload, ovmRequestWithdrawalPayloadSchema)).toEqual(
      payload,
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

describe('validatePayload - split recipient hardening', () => {
  const totalSplit = (splitRecipients: unknown[]): unknown => ({
    splitRecipients,
  });

  it('accepts allocations whose float sum is not exactly 100', () => {
    // 33.3 * 3 + 0.1 (RAF) is 99.99999999999999 in floating point.
    const payload = totalSplit([
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 33.3 },
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 33.3 },
      {
        account: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
        percentAllocation: 33.3,
      },
    ]);
    expect(() =>
      validatePayload(payload, totalSplitterPayloadSchema),
    ).not.toThrow();
  });

  it('rejects allocations that do not sum to 100 at contract precision', () => {
    // Each rounds to 333333 at 1e4 scale, so the total is 999999 + 1000.
    const payload = totalSplit([
      {
        account: TEST_ADDRESSES.REWARD_RECIPIENT_1,
        percentAllocation: 33.33334,
      },
      {
        account: TEST_ADDRESSES.REWARD_RECIPIENT_2,
        percentAllocation: 33.28333,
      },
      {
        account: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1,
        percentAllocation: 33.28333,
      },
    ]);
    expect(() => validatePayload(payload, totalSplitterPayloadSchema)).toThrow(
      'must pass "validateTotalSplitRecipients" keyword validation',
    );
  });

  it('rejects negative allocations', () => {
    const payload = {
      splitRecipients: [
        { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 120 },
        { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: -21 },
      ],
      principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
      etherAmount: 32,
    };
    expect(() =>
      validatePayload(payload, rewardsSplitterPayloadSchema),
    ).toThrow('/splitRecipients/1/percentAllocation must be > 0');
    expect(() =>
      validatePayload(payload, rewardsSplitterPayloadSchema),
    ).toThrow('/splitRecipients/0/percentAllocation must be <= 100');
  });

  it('rejects zero allocations', () => {
    const payload = totalSplit([
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 99.9 },
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_2, percentAllocation: 0 },
    ]);
    expect(() => validatePayload(payload, totalSplitterPayloadSchema)).toThrow(
      '/splitRecipients/1/percentAllocation must be > 0',
    );
  });

  it('rejects allocations that round to zero at contract precision', () => {
    const payload = totalSplit([
      { account: TEST_ADDRESSES.REWARD_RECIPIENT_1, percentAllocation: 99.9 },
      {
        account: TEST_ADDRESSES.REWARD_RECIPIENT_2,
        percentAllocation: 0.00001,
      },
    ]);
    expect(() => validatePayload(payload, totalSplitterPayloadSchema)).toThrow(
      'must pass "validateTotalSplitRecipients" keyword validation',
    );
  });

  it('rejects duplicate V1 recipients regardless of case', () => {
    const address = clusterConfigV1X10.operators[2].address;
    const payload = totalSplit([
      { account: address, percentAllocation: 50 },
      { account: address.toLowerCase(), percentAllocation: 49.9 },
    ]);
    expect(() => validatePayload(payload, totalSplitterPayloadSchema)).toThrow(
      '/splitRecipients must not contain duplicate recipient addresses',
    );
  });

  it('rejects duplicate OVM reward and principal recipients', () => {
    const address = clusterConfigV1X10.operators[2].address;
    const duplicated = [
      { address, percentAllocation: 50 },
      {
        address: address.toUpperCase().replace('0X', '0x'),
        percentAllocation: 49,
      },
    ];
    expect(() =>
      validatePayload(
        {
          rewardSplitRecipients: duplicated,
          OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
          principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
        },
        ovmRewardsSplitPayloadSchema,
      ),
    ).toThrow(
      '/rewardSplitRecipients must not contain duplicate recipient addresses',
    );
    expect(() =>
      validatePayload(
        {
          rewardSplitRecipients: [
            {
              address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
              percentAllocation: 99,
            },
          ],
          principalSplitRecipients: [
            { address, percentAllocation: 50 },
            { address: address.toLowerCase(), percentAllocation: 50 },
          ],
          OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
        },
        ovmTotalSplitPayloadSchema,
      ),
    ).toThrow(
      '/principalSplitRecipients must not contain duplicate recipient addresses',
    );
  });

  it('rejects out-of-range OVM allocations', () => {
    expect(() =>
      validatePayload(
        {
          rewardSplitRecipients: [
            {
              address: TEST_ADDRESSES.REWARD_RECIPIENT_1,
              percentAllocation: 109,
            },
            {
              address: TEST_ADDRESSES.REWARD_RECIPIENT_2,
              percentAllocation: -10,
            },
          ],
          OVMOwnerAddress: TEST_ADDRESSES.OVM_OWNER,
          principalRecipient: TEST_ADDRESSES.PRINCIPAL_RECIPIENT,
        },
        ovmRewardsSplitPayloadSchema,
      ),
    ).toThrow('/rewardSplitRecipients/1/percentAllocation must be > 0');
  });
});

describe('validatePayload - definitionSchema hardening', () => {
  const validDefinition = (): any => structuredClone(clusterConfigV1X10);

  it('accepts a valid definition and a solo definition', () => {
    expect(() =>
      validatePayload(validDefinition(), definitionSchema),
    ).not.toThrow();
    expect(() =>
      validatePayload(
        {
          ...validDefinition(),
          operators: [
            { address: '' },
            { address: '' },
            { address: '' },
            { address: '' },
          ],
        },
        definitionSchema,
      ),
    ).not.toThrow();
  });

  it('rejects operator addresses that differ only by case', () => {
    const payload = validDefinition();
    payload.operators[3].address = payload.operators[2].address.toLowerCase();
    expect(() => validatePayload(payload, definitionSchema)).toThrow(
      'must pass "validateUniqueAddresses" keyword validation',
    );
  });

  it('rejects malformed operator addresses', () => {
    const payload = validDefinition();
    payload.operators[0].address = `0x${'z'.repeat(40)}`;
    expect(() => validatePayload(payload, definitionSchema)).toThrow(
      '/operators/0/address must match pattern',
    );
  });

  it('rejects a mix of empty and set operator addresses', () => {
    const payload = validDefinition();
    payload.operators[0].address = '';
    expect(() => validatePayload(payload, definitionSchema)).toThrow(
      'must pass "validateUniqueAddresses" keyword validation',
    );
  });

  it('rejects zero withdrawal and fee recipient addresses', () => {
    const withdrawal = validDefinition();
    withdrawal.validators[0].withdrawal_address = TEST_ADDRESSES.ZERO_ADDRESS;
    expect(() => validatePayload(withdrawal, definitionSchema)).toThrow(
      '/validators/0/withdrawal_address must NOT be valid',
    );

    const feeRecipient = validDefinition();
    feeRecipient.validators[0].fee_recipient_address =
      TEST_ADDRESSES.ZERO_ADDRESS;
    expect(() => validatePayload(feeRecipient, definitionSchema)).toThrow(
      '/validators/0/fee_recipient_address must NOT be valid',
    );
  });

  it('rejects unknown top-level fields', () => {
    expect(() =>
      validatePayload(
        {
          ...validDefinition(),
          creator: { address: TEST_ADDRESSES.OVM_OWNER },
        },
        definitionSchema,
      ),
    ).toThrow('must NOT have additional properties');
  });
});
