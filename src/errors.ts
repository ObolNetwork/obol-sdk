/**
 * Thrown when attempting to create a resource that already exists
 * (e.g. posting a duplicate cluster definition, or accepting already-accepted terms).
 */
export class ConflictError extends Error {
  name = 'ConflictError';

  constructor() {
    super('This Cluster has been already posted.');
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Thrown when a method that requires an ethers `Signer` is called on a
 * client that was constructed without one.
 *
 * To fix: pass a `Wallet` or `JsonRpcSigner` as the second argument to
 * `new Client(config, signer)`.
 */
export class SignerRequiredError extends Error {
  name = 'SignerRequiredError';

  constructor(method: string) {
    super(`Signer is required in ${method}`);
    Object.setPrototypeOf(this, SignerRequiredError.prototype);
  }
}

/**
 * Thrown when an operation is attempted on a chain ID that does not support it
 * (e.g. deploying splitters on a chain without factory contracts).
 */
export class UnsupportedChainError extends Error {
  name = 'UnsupportedChainError';

  constructor(chainId: number, operation: string) {
    super(`${operation} is not supported on chain ${chainId}`);
    Object.setPrototypeOf(this, UnsupportedChainError.prototype);
  }
}

/**
 * Thrown when {@link Client} is constructed with a baseUrl that is not an
 * allowed Obol API base URL (see {@link ALLOWED_OBOL_API_BASE_URLS}).
 */
export class InvalidBaseUrlError extends Error {
  name = 'InvalidBaseUrlError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InvalidBaseUrlError.prototype);
  }
}

/**
 * Thrown when lock validation exceeds a worker time limit (large clusters).
 * HTTP gateways should respond with **504**; distinct from crypto failure
 * (`validateClusterLock` returning **false** → **400**).
 */
export class ClusterLockValidationTimeoutError extends Error {
  name = 'ClusterLockValidationTimeoutError';

  /**
   * @param timeoutMs - Worker deadline that was exceeded (`VALIDATION_WORKER_TIMEOUT_MS`
   *   for the whole-lock worker, `WORKER_TIMEOUT_MS` for per-chunk BLS workers).
   */
  constructor(public readonly timeoutMs: number) {
    super(
      `Cluster lock validation exceeded worker time limit (${timeoutMs} ms). Retry later; this does not imply invalid lock data.`,
    );
    Object.setPrototypeOf(this, ClusterLockValidationTimeoutError.prototype);
  }
}

/**
 * Thrown when too many `validateClusterLock` calls are already in flight.
 * HTTP gateways should respond with **503**; clients should retry with backoff.
 */
export class ClusterLockValidationBusyError extends Error {
  name = 'ClusterLockValidationBusyError';

  constructor(public readonly maxConcurrent: number) {
    super(
      `Too many cluster lock validations in progress (limit: ${maxConcurrent}). Retry later.`,
    );
    Object.setPrototypeOf(this, ClusterLockValidationBusyError.prototype);
  }
}
