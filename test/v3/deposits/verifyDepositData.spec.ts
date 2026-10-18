import { parseEther } from 'viem';
import { verifyDepositData } from '../../../src/v3/deposits/verifyDepositData.js';
import type { ObolError } from '../../../src/v3/errors.js';
import {
  hoodiCompoundingDepositPayload,
  mainnetDepositPayload,
} from '../../fixtures.js';

const rejection = async (promise: Promise<unknown>): Promise<ObolError> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as ObolError,
  );

const toDeposit = (d: any) => ({
  pubkey: d.pubkey,
  withdrawalCredentials: d.withdrawal_credentials,
  signature: d.signature,
  depositDataRoot: d.deposit_data_root,
  amount: BigInt(d.amount),
});

const mainnet = toDeposit(mainnetDepositPayload.deposit);
const hoodi = toDeposit(hoodiCompoundingDepositPayload.deposit);

describe('deposits.verifyDepositData', () => {
  it('accepts valid deposits (kind defaults to deposit)', async () => {
    await expect(
      verifyDepositData([mainnet], {
        chainId: 1,
        expectedWithdrawalAddress: mainnetDepositPayload.withdrawalAddress,
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyDepositData([hoodi], { chainId: 560048 }),
    ).resolves.toBeUndefined();
  });

  it('accepts an empty list', async () => {
    await expect(
      verifyDepositData([], { chainId: 999 }),
    ).resolves.toBeUndefined();
  });

  it('runs the per-deposit checks before the chain check', async () => {
    const error = await rejection(
      verifyDepositData([{ ...mainnet, amount: parseEther('0.5') }], {
        chainId: 999,
      }),
    );
    expect(error.code).toBe('DEPOSIT_INVALID');
    expect(error.details).toEqual({ index: 0, issue: 'amount_below_minimum' });
  });

  it('reports the first failing deposit', async () => {
    const error = await rejection(
      verifyDepositData(
        [
          mainnet,
          { ...mainnet, withdrawalCredentials: `0x03${'00'.repeat(31)}` },
        ],
        { chainId: 1 },
      ),
    );
    expect(error.details).toEqual({
      index: 1,
      issue: 'credentials_prefix_unknown',
    });
  });

  it.each<[string, unknown, unknown]>([
    ['a short pubkey', [{ ...mainnet, pubkey: '0x1234' }], { chainId: 1 }],
    ['a negative amount', [{ ...mainnet, amount: -1n }], { chainId: 1 }],
    ['a number amount', [{ ...mainnet, amount: 32 }], { chainId: 1 }],
    ['an unknown kind', [mainnet], { chainId: 1, kind: 'other' }],
    [
      'a bad address checksum',
      [mainnet],
      {
        chainId: 1,
        expectedWithdrawalAddress: '0x86b8145C98e5BD25BA722645b15eD65f024a87EC',
      },
    ],
  ])('rejects %s (PAYLOAD_INVALID)', async (_name, deposits, options) => {
    expect(
      (await rejection(verifyDepositData(deposits as any, options as any)))
        .code,
    ).toBe('PAYLOAD_INVALID');
  });
});
