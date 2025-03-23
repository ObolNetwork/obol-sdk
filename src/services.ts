import { type SafeRpcUrl, type ClusterLock } from './types.js';
import { isValidClusterLock } from './verification/common.js';

/**
 * Verifies Cluster Lock's validity.
 * @param lock - cluster lock
 * @param safeRpcUrl - optional safeRpcUrl for safe wallet verification
 * @returns {Promise<{ result: boolean }> } boolean result to indicate if lock is valid
 * @throws on missing keys or values.
 *
 * An example of how to use validateClusterLock:
 * [validateClusterLock](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L127)
 */
export const validateClusterLock = async (
  lock: ClusterLock,
  safeRpcUrl?: SafeRpcUrl,
): Promise<boolean> => {
  try {
    const isLockValid = await isValidClusterLock(lock, safeRpcUrl);
    return isLockValid;
  } catch (err: any) {
    throw err;
  }
};
