// A worker timeout is not a verdict: verifyLock throws LOCK_VERIFICATION_TIMEOUT.
import { jest } from '@jest/globals';
import { ClusterLockValidationTimeoutError } from '../../../src/errors.js';

await jest.unstable_mockModule(
  '../../../src/verification/parallelPool.js',
  () => ({
    __esModule: true,
    verifySharesBinding: async () => {
      throw new ClusterLockValidationTimeoutError(180_000);
    },
    verifyBlsChecksParallel: async () => true,
    verifyAggregateParallel: async () => true,
  }),
);

const { verifyLock } = await import('../../../src/v3/cluster/verifyLock.js');
const { clusterLockV1X10 } = await import('../../fixtures.js');

describe('cluster.verifyLock worker timeout', () => {
  it('throws LOCK_VERIFICATION_TIMEOUT with timeoutMs', async () => {
    await expect(
      verifyLock(JSON.parse(JSON.stringify(clusterLockV1X10))),
    ).rejects.toMatchObject({
      code: 'LOCK_VERIFICATION_TIMEOUT',
      details: { timeoutMs: 180_000 },
    });
  });
});
