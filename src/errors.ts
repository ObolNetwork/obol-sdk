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
