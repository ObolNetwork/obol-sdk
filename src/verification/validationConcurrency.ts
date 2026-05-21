import { ClusterLockValidationBusyError } from '../errors.js';

/**
 * Max in-flight `validateClusterLock` calls per process.
 * `0` = unlimited (e.g. tests: `OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS=0`).
 * Default `2` — tune via env for host CPU (obol-api should set in `.env`).
 */
export function getMaxConcurrentLockValidations(): number {
  const raw = process.env.OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS;
  if (raw === '0') return 0;
  if (raw !== undefined && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 2;
}

let activeValidations = 0;

/**
 * Limits parallel lock validation CPU/worker usage process-wide.
 * Rejects immediately when at capacity (no queue — avoids memory growth under flood).
 */
export async function withLockValidationConcurrency<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const max = getMaxConcurrentLockValidations();
  if (max === 0) return await fn();

  if (activeValidations >= max) {
    throw new ClusterLockValidationBusyError(max);
  }

  activeValidations++;
  try {
    return await fn();
  } finally {
    activeValidations--;
  }
}

/** @internal Test helper */
export function resetLockValidationConcurrencyForTests(): void {
  activeValidations = 0;
}
