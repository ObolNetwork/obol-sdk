// spec/vectors/deposit_checks.json through deposits.verifyDepositData.
import { readFileSync } from 'node:fs';
import { ObolError } from '../../src/errors.js';
import { verifyDepositData } from '../../src/deposits/verifyDepositData.js';

const suite = JSON.parse(
  readFileSync('spec/vectors/deposit_checks.json', 'utf8'),
);

const toDeposit = (d: any) => ({
  pubkey: d.pubkey,
  withdrawalCredentials: d.withdrawal_credentials,
  signature: d.signature,
  depositDataRoot: d.deposit_data_root,
  amount: BigInt(d.amount),
});

describe('vectors deposit_checks', () => {
  it('has 30 cases', () => {
    expect(suite.cases).toHaveLength(30);
  });

  it.each<[string, any]>(suite.cases.map((c: any) => [c.name, c]))(
    '%s',
    async (_name, c) => {
      const run = async () =>
        await verifyDepositData(c.input.deposits.map(toDeposit), {
          chainId: c.input.chainId,
          kind: c.input.kind,
          ...(c.input.expectedWithdrawalAddress !== null &&
          c.input.expectedWithdrawalAddress !== undefined
            ? { expectedWithdrawalAddress: c.input.expectedWithdrawalAddress }
            : {}),
        });
      if (c.accepted) {
        await expect(run()).resolves.toBeUndefined();
        return;
      }
      const error = await run().then(
        () => {
          throw new Error('expected a rejection');
        },
        (e: unknown) => e as ObolError,
      );
      expect(error).toBeInstanceOf(ObolError);
      expect(error.code).toBe(c.reason);
      if (c.issue !== null) expect(error.details.issue).toBe(c.issue);
      if (c.index !== null) expect(error.details.index).toBe(c.index);
    },
  );
});
