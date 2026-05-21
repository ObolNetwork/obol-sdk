import { jest, describe, it, expect } from '@jest/globals';
import { ClusterLockValidationTimeoutError } from '../../src/errors.js';

describe('ClusterLockValidationTimeoutError', () => {
  it('carries timeoutMs for gateway mapping (504)', () => {
    const err = new ClusterLockValidationTimeoutError(60_000);
    expect(err.name).toBe('ClusterLockValidationTimeoutError');
    expect(err.timeoutMs).toBe(60_000);
    expect(err.message).toContain('60000');
  });
});

describe('validateClusterLock timeout propagation', () => {
  it('re-throws ClusterLockValidationTimeoutError from the worker path', async () => {
    const timeoutErr = new ClusterLockValidationTimeoutError(120_000);
    await jest.unstable_mockModule(
      '../../src/verification/parallelPool.js',
      () => ({
        validateClusterLockInWorker: jest
          .fn<() => Promise<boolean | null>>()
          .mockRejectedValue(timeoutErr),
        verifySharesBinding: jest.fn(),
        verifyBlsChecksParallel: jest.fn(),
        verifyBatchParallel: jest.fn(),
        verifyAggregateParallel: jest.fn(),
      }),
    );
    const { validateClusterLock } = await import('../../src/services.js');
    await expect(
      validateClusterLock({ distributed_validators: [] } as never),
    ).rejects.toBe(timeoutErr);
  });
});
