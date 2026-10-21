import { readFileSync } from 'node:fs';
import { percent } from '../../src/splits/shares.js';
import { ovmSplitParams } from '../../src/setup/presets.js';
import { caught, norm } from '../splits/helpers.js';

const suite = JSON.parse(
  readFileSync('spec/vectors/split_shares.json', 'utf8'),
);

describe('vectors: split_shares', () => {
  describe('percent', () => {
    it.each<[string, any]>(suite.percent.map((c: any) => [c.name, c]))(
      '%s',
      async (_n, c) => {
        if (c.accepted) {
          expect(percent(c.input.percent)).toBe(BigInt(c.shares));
        } else {
          expect((await caught(() => percent(c.input.percent))).code).toBe(
            c.reason,
          );
        }
      },
    );
  });

  describe('ovm_split_params', () => {
    it.each<[string, any]>(suite.ovm_split_params.map((c: any) => [c.name, c]))(
      '%s',
      async (_n, c) => {
        const run = () =>
          ovmSplitParams({
            chainId: c.input.chainId,
            kind: c.input.kind,
            rewardRecipients: c.input.rewardRecipients,
            ...(c.input.principalRecipients !== undefined
              ? { principalRecipients: c.input.principalRecipients }
              : {}),
            distributionIncentive: c.input.distributionIncentive,
          });
        if (!c.accepted) {
          const error = await caught(run);
          expect(error.code).toBe(c.reason);
          expect(
            (error.details.issues as Array<{ issue?: string }>)[0].issue,
          ).toBe(c.issue);
          return;
        }
        const result = run();
        // The whole result is compared, not a subset.
        expect(norm({ principalSplit: null, ...result })).toEqual(
          norm({
            rewardSplit: c.rewardSplit,
            principalSplit: c.principalSplit,
          }),
        );
        // Outputs are checksummed exactly as the vector.
        expect(result.rewardSplit.recipients).toEqual(c.rewardSplit.recipients);
      },
    );
  });
});
