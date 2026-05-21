import { type SafeRpcUrl, type ClusterLock } from './types.js';
import { isValidClusterLock } from './verification/common.js';
import { validateClusterLockInWorker } from './verification/parallelPool.js';

/**
 * Verifies the cryptographic validity of a cluster lock.
 *
 * Checks all operator signatures, config hashes, and definition hashes within
 * the lock. Supports both EOA and Safe Wallet signatures.
 *
 * This is a standalone utility – it does **not** require a `Client` instance.
 *
 * **Charon:** this covers cryptographic and structural checks in this SDK only.
 * Charon adds further runtime/protocol rules. `true` here does not guarantee
 * Charon will accept the lock; use Charon or its supported tooling as the
 * final gate before operating a cluster.
 *
 * @param lock - The cluster lock object (e.g. from {@link Client.getClusterLock}).
 * @param safeRpcUrl - Optional RPC URL for Safe Wallet signature verification.
 *   If omitted, falls back to the `RPC_MAINNET` / `RPC_HOODI` / etc. env vars.
 * @returns `true` if the lock is cryptographically valid; `false` if invalid
 *   (e.g. missing keys, invalid signatures, hash mismatches).
 * @throws {@link ClusterLockValidationTimeoutError} when validation exceeds a
 *   worker deadline (whole-lock or per-chunk BLS workers on large clusters).
 *   HTTP APIs should map this to **504 Gateway Timeout**, not **400**.
 *
 * @example
 * ```typescript
 * import { validateClusterLock, Client } from "@obolnetwork/obol-sdk";
 *
 * const configHash = "0x..."; // your cluster config hash
 * const client = new Client({ chainId: 560048 });
 * const lock = await client.getClusterLock(configHash);
 * const isValid = await validateClusterLock(lock);
 * ```
 */
export const validateClusterLock = async (
  lock: ClusterLock,
  safeRpcUrl?: SafeRpcUrl,
): Promise<boolean> => {
  const inWorker = await validateClusterLockInWorker(lock, safeRpcUrl);
  if (inWorker !== null) return inWorker;
  return await isValidClusterLock(lock, safeRpcUrl);
};
