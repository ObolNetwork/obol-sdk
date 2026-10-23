import { verifyDepositPayloads } from '../../src/verification/depositPayload';
import { computeDepositMsgRoot } from '../../src/verification/common';
import {
  TEST_ADDRESSES,
  hoodiCompoundingDepositPayload,
  mainnetDepositPayload,
} from '../fixtures';
import {
  offsetDepositPair,
  signatureOutsideSubgroup,
  signedDeposit,
  withSignature,
} from '../blsTestUtils';

const ETH = BigInt('1000000000000000000');

describe('verifyDepositPayloads', () => {
  const mainnet = mainnetDepositPayload;
  const hoodi = hoodiCompoundingDepositPayload;

  it('accepts valid deposits (0x01 mainnet, 0x02 hoodi)', async () => {
    await expect(
      verifyDepositPayloads([mainnet.deposit], { chainId: mainnet.chainId }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositPayloads([hoodi.deposit], {
        chainId: hoodi.chainId,
        expectedWithdrawalAddress: hoodi.withdrawalAddress,
      }),
    ).resolves.toBeUndefined();
  });

  it('matches the expected withdrawal address case-insensitively', async () => {
    await expect(
      verifyDepositPayloads([mainnet.deposit], {
        chainId: mainnet.chainId,
        expectedWithdrawalAddress: mainnet.withdrawalAddress.toUpperCase(),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a deposit_data_root that does not match', async () => {
    const deposit = {
      ...mainnet.deposit,
      deposit_data_root: '0x' + '11'.repeat(32),
    };
    await expect(
      verifyDepositPayloads([deposit], { chainId: mainnet.chainId }),
    ).rejects.toThrow(
      'Invalid deposit at index 0: deposit_data_root does not match',
    );
  });

  it('rejects a signature that is not valid for the chain', async () => {
    // Signed for mainnet, sent on Hoodi.
    await expect(
      verifyDepositPayloads([mainnet.deposit], { chainId: 560048 }),
    ).rejects.toThrow('invalid deposit signature for chain 560048');
  });

  it('reports the index of the invalid signature', async () => {
    // The second deposit is signed for Hoodi.
    await expect(
      verifyDepositPayloads([mainnet.deposit, hoodi.deposit], { chainId: 1 }),
    ).rejects.toThrow('Invalid deposit at index 1: invalid deposit signature');
  });

  it('requires each signature to be valid on its own', async () => {
    // Each signature is invalid; their sum is the sum of two valid ones.
    const [first, second] = offsetDepositPair(mainnet.deposit);
    await expect(
      verifyDepositPayloads([first, second], { chainId: mainnet.chainId }),
    ).rejects.toThrow('Invalid deposit at index 0: invalid deposit signature');
    await expect(
      verifyDepositPayloads([mainnet.deposit, second, first], {
        chainId: mainnet.chainId,
      }),
    ).rejects.toThrow('Invalid deposit at index 1: invalid deposit signature');
  });

  it('rejects a signature outside the prime-order subgroup', async () => {
    const deposit = withSignature(
      mainnet.deposit,
      signatureOutsideSubgroup(mainnet.deposit.signature),
    );
    await expect(
      verifyDepositPayloads([mainnet.deposit, deposit], {
        chainId: mainnet.chainId,
      }),
    ).rejects.toThrow('Invalid deposit at index 1: invalid deposit signature');
  });

  it('rejects a corrupted signature', async () => {
    const deposit = {
      ...mainnet.deposit,
      signature: '0x' + 'ab'.repeat(96),
    };
    // Root no longer matches either, so the root check fires first.
    await expect(
      verifyDepositPayloads([deposit], { chainId: mainnet.chainId }),
    ).rejects.toThrow('Invalid deposit at index 0');
  });

  it("skips only the signature check with kind: 'topUp'", async () => {
    await expect(
      verifyDepositPayloads([mainnet.deposit], {
        chainId: 560048,
        kind: 'topUp',
      }),
    ).resolves.toBeUndefined();

    await expect(
      verifyDepositPayloads(
        [{ ...mainnet.deposit, deposit_data_root: '0x' + '00'.repeat(32) }],
        { chainId: 560048, kind: 'topUp' },
      ),
    ).rejects.toThrow('deposit_data_root does not match');
  });

  it('rejects signature checks on a chain with no known fork version', async () => {
    await expect(
      verifyDepositPayloads([mainnet.deposit], { chainId: 999 }),
    ).rejects.toThrow('Cannot verify deposit signatures on chain 999');
  });

  it.each([
    ['below 1 ETH', (ETH / BigInt(2)).toString(), 'at least 1 ETH'],
    [
      'not a whole number of gwei',
      (ETH * BigInt(32) + BigInt(1)).toString(),
      'whole number of gwei',
    ],
    ['in gwei instead of wei', '32000000000', 'at least 1 ETH'],
    [
      'above 32 ETH for 0x01 credentials',
      (ETH * BigInt(33)).toString(),
      'exceeds 32 ETH',
    ],
  ])('rejects an amount %s', async (_label, amount, message) => {
    await expect(
      verifyDepositPayloads([{ ...mainnet.deposit, amount }], {
        chainId: mainnet.chainId,
      }),
    ).rejects.toThrow(message);
  });

  it('rejects an amount above 2048 ETH for 0x02 credentials', async () => {
    await expect(
      verifyDepositPayloads(
        [{ ...hoodi.deposit, amount: (ETH * BigInt(2049)).toString() }],
        { chainId: hoodi.chainId },
      ),
    ).rejects.toThrow('exceeds 2048 ETH');
  });

  it('allows up to 2048 ETH for 0x02 credentials before the root check', async () => {
    // Amount is within range, so the failure is the root (signed for 32 ETH).
    await expect(
      verifyDepositPayloads(
        [{ ...hoodi.deposit, amount: (ETH * BigInt(2048)).toString() }],
        { chainId: hoodi.chainId },
      ),
    ).rejects.toThrow('deposit_data_root does not match');
  });

  it('rejects withdrawal credentials for another address', async () => {
    await expect(
      verifyDepositPayloads([mainnet.deposit], {
        chainId: mainnet.chainId,
        expectedWithdrawalAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
      }),
    ).rejects.toThrow(
      `withdrawal credentials do not point at ${TEST_ADDRESSES.REWARD_RECIPIENT_1}`,
    );
  });

  it('rejects BLS (0x00) credentials when a withdrawal address is expected', async () => {
    const deposit = {
      ...mainnet.deposit,
      withdrawal_credentials:
        '0x00' + mainnet.deposit.withdrawal_credentials.slice(4),
    };
    await expect(
      verifyDepositPayloads([deposit], {
        chainId: mainnet.chainId,
        expectedWithdrawalAddress: mainnet.withdrawalAddress,
      }),
    ).rejects.toThrow('withdrawal credentials do not point at');
  });

  it('rejects unknown or malformed withdrawal credentials', async () => {
    await expect(
      verifyDepositPayloads(
        [
          {
            ...mainnet.deposit,
            withdrawal_credentials:
              '0x03' + mainnet.deposit.withdrawal_credentials.slice(4),
          },
        ],
        { chainId: mainnet.chainId },
      ),
    ).rejects.toThrow('unsupported withdrawal credentials prefix 0x03');

    await expect(
      verifyDepositPayloads(
        [
          {
            ...mainnet.deposit,
            withdrawal_credentials:
              '0x01ff' + mainnet.deposit.withdrawal_credentials.slice(6),
          },
        ],
        { chainId: mainnet.chainId },
      ),
    ).rejects.toThrow('malformed execution withdrawal credentials');
  });

  describe('field lengths', () => {
    // A raw 20-byte address, as `charon deposit sign` emits it.
    const address = '00' + mainnet.withdrawalAddress.toLowerCase().slice(4);

    it('accepts the deposit when the credentials are 32 bytes', async () => {
      // Same root and signature as the 20-byte form below: SSZ zero-pads it.
      await expect(
        verifyDepositPayloads(
          [signedDeposit(1, '0x' + address + '00'.repeat(12))],
          {
            chainId: 1,
          },
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects 20-byte credentials starting 0x00 with a valid root and signature', async () => {
      await expect(
        verifyDepositPayloads([signedDeposit(1, '0x' + address)], {
          chainId: 1,
        }),
      ).rejects.toThrow(
        'Invalid deposit at index 0: withdrawal_credentials must be 32 bytes',
      );
    });

    it('rejects 20-byte credentials for a top-up', async () => {
      await expect(
        verifyDepositPayloads([signedDeposit(1, '0x' + address)], {
          chainId: 1,
          kind: 'topUp',
        }),
      ).rejects.toThrow('withdrawal_credentials must be 32 bytes');
    });

    it.each([
      ['20 bytes starting 0x12', '0x12' + 'ab'.repeat(19)],
      ['31 bytes', mainnet.deposit.withdrawal_credentials.slice(0, 2 + 31 * 2)],
      ['33 bytes', mainnet.deposit.withdrawal_credentials + '00'],
      ['no 0x prefix', mainnet.deposit.withdrawal_credentials.slice(2)],
      ['non-hex characters', '0x01' + '0'.repeat(22) + 'zz'.repeat(20)],
    ])('rejects withdrawal credentials of %s', async (_label, credentials) => {
      await expect(
        verifyDepositPayloads(
          [{ ...mainnet.deposit, withdrawal_credentials: credentials }],
          { chainId: mainnet.chainId },
        ),
      ).rejects.toThrow(
        'Invalid deposit at index 0: withdrawal_credentials must be 32 bytes',
      );
    });

    it.each([
      ['pubkey', 47, 'pubkey must be 48 bytes'],
      ['signature', 95, 'signature must be 96 bytes'],
      ['deposit_data_root', 31, 'deposit_data_root must be 32 bytes'],
    ] as const)('rejects a short %s', async (field, bytes, message) => {
      const deposit = {
        ...mainnet.deposit,
        [field]: mainnet.deposit[field].slice(0, 2 + bytes * 2),
      };
      await expect(
        verifyDepositPayloads([deposit], { chainId: mainnet.chainId }),
      ).rejects.toThrow(`Invalid deposit at index 0: ${message}`);
    });

    it('still accepts valid 0x01 and 0x02 credentials in any hex case', async () => {
      await expect(
        verifyDepositPayloads(
          [
            {
              ...mainnet.deposit,
              withdrawal_credentials: mainnet.deposit.withdrawal_credentials
                .toUpperCase()
                .replace('0X', '0x'),
            },
          ],
          { chainId: mainnet.chainId },
        ),
      ).resolves.toBeUndefined();
      await expect(
        verifyDepositPayloads([hoodi.deposit], {
          chainId: hoodi.chainId,
          expectedWithdrawalAddress: hoodi.withdrawalAddress,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('computeDepositMsgRoot', () => {
  const { pubkey, withdrawal_credentials: credentials } =
    mainnetDepositPayload.deposit;

  it.each([
    ['20-byte withdrawal credentials', pubkey, credentials.slice(0, 42)],
    ['33-byte withdrawal credentials', pubkey, credentials + '00'],
    ['a 47-byte pubkey', pubkey.slice(0, 96), credentials],
  ])('rejects %s', (_label, key, creds) => {
    expect(() =>
      computeDepositMsgRoot({
        pubkey: key,
        withdrawal_credentials: creds,
        amount: '32000000000',
      }),
    ).toThrow('must be 48 bytes');
  });
});
