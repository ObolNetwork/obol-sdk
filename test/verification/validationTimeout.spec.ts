import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { ClusterLockValidationTimeoutError } from '../../src/errors.js';
import { validateClusterLock } from '../../src/services.js';
import * as parallelPool from '../../src/verification/parallelPool.js';

describe('ClusterLockValidationTimeoutError', () => {
  it('carries timeoutMs for gateway mapping (504)', () => {
    const err = new ClusterLockValidationTimeoutError(60_000);
    expect(err.name).toBe('ClusterLockValidationTimeoutError');
    expect(err.timeoutMs).toBe(60_000);
    expect(err.message).toContain('60000');
  });
});

describe('validateClusterLock timeout propagation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-throws ClusterLockValidationTimeoutError from the worker path', async () => {
    const timeoutErr = new ClusterLockValidationTimeoutError(120_000);
    jest
      .spyOn(parallelPool, 'validateClusterLockInWorker')
      .mockRejectedValue(timeoutErr);

    await expect(
      validateClusterLock({ distributed_validators: [] } as never),
    ).rejects.toBe(timeoutErr);
  });
});
