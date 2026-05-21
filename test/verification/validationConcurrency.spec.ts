import { describe, it, expect, afterEach } from '@jest/globals';
import { ClusterLockValidationBusyError } from '../../src/errors.js';
import {
  getMaxConcurrentLockValidations,
  withLockValidationConcurrency,
} from '../../src/verification/validationConcurrency.js';

describe('validationConcurrency', () => {
  const prevEnv = process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS;

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS;
    } else {
      process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS = prevEnv;
    }
  });

  it('defaults to 2 concurrent validations', () => {
    delete process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS;
    expect(getMaxConcurrentLockValidations()).toBe(2);
  });

  it('treats env 0 as unlimited', () => {
    process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS = '0';
    expect(getMaxConcurrentLockValidations()).toBe(0);
  });

  it('rejects when at capacity', async () => {
    process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS = '1';

    let releaseFirst!: () => void;
    let entered!: () => void;
    const slotHeld = new Promise<void>(resolve => {
      entered = resolve;
    });

    const first = withLockValidationConcurrency(async () => {
      entered();
      await new Promise<void>(resolve => {
        releaseFirst = resolve;
      });
      return 'a';
    });

    try {
      await slotHeld;

      await expect(
        withLockValidationConcurrency(async () => 'b'),
      ).rejects.toBeInstanceOf(ClusterLockValidationBusyError);
    } finally {
      releaseFirst?.();
      await first;
    }
  });
});
