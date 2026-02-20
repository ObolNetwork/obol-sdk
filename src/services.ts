import { type SafeRpcUrl, type ClusterLock } from './types.js';
import { isValidClusterLock } from './verification/common.js';

/**
 * Verifies the cryptographic validity of a cluster lock.
 *
 * Checks all operator signatures, config hashes, and definition hashes within
 * the lock. Supports both EOA and Safe Wallet signatures.
 *
 * This is a standalone utility – it does **not** require a `Client` instance.
 *
 * @param lock - The cluster lock object (e.g. from {@link Client.getClusterLock}).
 * @param safeRpcUrl - Optional RPC URL for Safe Wallet signature verification.
 *   If omitted, falls back to the `RPC_MAINNET` / `RPC_HOLESKY` / etc. env vars.
 * @returns `true` if the lock is cryptographically valid.
 * @throws {Error} On missing keys, invalid signatures, or hash mismatches.
 *
 * @example
 * ```typescript
 * import { validateClusterLock, Client } from "@obolnetwork/obol-sdk";
 *
 * const client = new Client({ chainId: 17000 });
 * const lock = await client.getClusterLock(configHash);
 * const isValid = await validateClusterLock(lock);
 * ```
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
