import { verifyDepositPayloads } from '../../src/verification/depositPayload';
import {
  TEST_ADDRESSES,
  hoodiCompoundingDepositPayload,
  mainnetDepositPayload,
} from '../fixtures';

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
});
