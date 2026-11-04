// A batch BLS check that ran and failed although each signature verifies on
// its own can only be a BLS fault: verifyDepositPayloads fails closed (as 3.x
// does). Separate file: unstable_mockModule mocks persist within a file.
import { jest } from '@jest/globals';
import { hoodiCompoundingDepositPayload } from '../fixtures';

const hoodi = hoodiCompoundingDepositPayload;

describe('verifyDepositPayloads when the batch check returns false', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('fails closed even if each signature verifies alone (a BLS fault)', async () => {
    const actual = await import('../../src/verification/parallelPool');
    await jest.unstable_mockModule(
      '../../src/verification/parallelPool.js',
      () => ({
        ...actual,
        verifyBlsChecksParallel: jest.fn(async () => false),
      }),
    );
    await import('../../src/index');
    const { verifyDepositPayloads } =
      await import('../../src/verification/depositPayload');
    await expect(
      verifyDepositPayloads([hoodi.deposit], {
        chainId: hoodi.chainId,
        expectedWithdrawalAddress: hoodi.withdrawalAddress,
      }),
    ).rejects.toThrow('invalid deposit signature for chain 560048');
  });
});
