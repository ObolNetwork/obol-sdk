import { type PreflightIssue } from './types.js';

/** Fields of an {@link ObolApiError} that body fields are not copied over. */
const RESERVED_ERROR_FIELDS = new Set([
  'name',
  'message',
  'stack',
  'cause',
  'status',
  'endpoint',
  'method',
  'body',
  'hint',
]);

/** Options for constructing an {@link ObolApiError}. */
export interface ObolApiErrorInit {
  /** HTTP status code of the response. */
  status: number;
  /** Request path relative to the base URL (e.g. `/v1/definition`). */
  endpoint: string;
  /** HTTP method of the request. Defaults to `GET`. */
  method?: string;
  /** Parsed JSON error body, or the raw text when the body is not JSON. */
  body?: unknown;
  /** Short, actionable suggestion for the caller. */
  hint?: string;
}

/**
 * Thrown when the Obol API responds with a non-2xx status.
 *
 * Fields of the API's JSON error body (e.g. `message`, `statusCode`, `error`)
 * are copied onto the instance, so code that read them from the raw body
 * thrown by earlier SDK versions keeps working. The full body is kept in
 * {@link ObolApiError.body}.
 *
 * Use {@link createObolApiError} to get the subclass matching a status:
 * {@link ValidationError} (400/422), {@link UnauthorizedError} (401/403),
 * {@link NotFoundError} (404), {@link ConflictError} (409) and
 * {@link RateLimitError} (429).
 */
export class ObolApiError extends Error {
  name = 'ObolApiError';
  /** HTTP status code of the response. */
  status: number;
  /** Request path relative to the base URL. */
  endpoint: string;
  /** HTTP method of the request. */
  method: string;
  /** Parsed JSON error body, or the raw text when the body is not JSON. */
  body: unknown;
  /** Short, actionable suggestion for the caller. */
  hint?: string;
  /** Status code reported in the error body (Obol API errors include it). */
  statusCode?: number;
  /** Additional fields copied from the error body. */
  [key: string]: unknown;

  constructor(init: ObolApiErrorInit) {
    super(messageFromBody(init.body, init.status));
    Object.setPrototypeOf(this, new.target.prototype);
    this.status = init.status;
    this.endpoint = init.endpoint;
    this.method = (init.method ?? 'GET').toUpperCase();
    this.body = init.body;
    if (init.hint !== undefined) {
      this.hint = init.hint;
    }
    if (isRecord(init.body)) {
      for (const key of Object.keys(init.body)) {
        if (!RESERVED_ERROR_FIELDS.has(key)) {
          this[key] = init.body[key];
        }
      }
    }
  }
}

/** Thrown when the Obol API responds with 400 or 422 (invalid request). */
export class ValidationError extends ObolApiError {
  name = 'ValidationError';

  constructor(init: ObolApiErrorInit) {
    super({
      hint: 'The request was rejected as invalid; check the payload against the API error message before retrying.',
      ...init,
    });
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/** Thrown when the Obol API responds with 401 or 403. */
export class UnauthorizedError extends ObolApiError {
  name = 'UnauthorizedError';

  constructor(init: ObolApiErrorInit) {
    super({
      hint: 'The signature or address was not accepted; check the signer, chainId and that the latest terms and conditions are accepted.',
      ...init,
    });
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/** Thrown when the Obol API responds with 404. */
export class NotFoundError extends ObolApiError {
  name = 'NotFoundError';

  constructor(init: ObolApiErrorInit) {
    super({
      hint: 'The resource does not exist (yet); check the hash and chainId, or retry later if it is still being created.',
      ...init,
    });
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/** Thrown when the Obol API responds with 429. */
export class RateLimitError extends ObolApiError {
  name = 'RateLimitError';

  constructor(init: ObolApiErrorInit) {
    super({
      hint: 'Too many requests; wait before retrying.',
      ...init,
    });
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

const DEFAULT_CONFLICT_MESSAGE = 'This Cluster has been already posted.';

/**
 * Thrown when attempting to create a resource that already exists
 * (e.g. posting a duplicate cluster definition, or accepting already-accepted terms).
 *
 * Extends {@link ObolApiError} with status 409. The message is the one returned
 * by the API (e.g. `Duplicate entry`, `ENR already exists in this cluster`).
 */
export class ConflictError extends ObolApiError {
  name = 'ConflictError';

  /**
   * @param init - Response details. Optional for backwards compatibility;
   *   when omitted the error has status 409 and a generic message.
   */
  constructor(init?: Partial<ObolApiErrorInit>) {
    super({
      endpoint: '',
      hint: 'The resource already exists; read its current state instead of creating it again.',
      ...init,
      status: init?.status ?? 409,
      body: init?.body ?? {
        message: DEFAULT_CONFLICT_MESSAGE,
        statusCode: 409,
      },
    });
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Thrown when an Obol API request does not complete within the client's
 * `timeoutMs` (see {@link BaseConfig}). The request may still have been
 * processed by the API, so check the resource state before retrying a write.
 */
export class RequestTimeoutError extends Error {
  name = 'RequestTimeoutError';
  /** Short, actionable suggestion for the caller. */
  hint =
    'The request timed out; the API may still have processed it, so read the resource state before retrying a write.';

  constructor(
    public readonly endpoint: string,
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(`${method} ${endpoint} timed out after ${timeoutMs} ms`);
    Object.setPrototypeOf(this, RequestTimeoutError.prototype);
  }
}

/**
 * Builds the {@link ObolApiError} subclass that matches an HTTP status.
 *
 * @param init - Response details.
 * @returns A typed error; a plain {@link ObolApiError} for other statuses.
 */
export function createObolApiError(init: ObolApiErrorInit): ObolApiError {
  switch (init.status) {
    case 400:
    case 422:
      return new ValidationError(init);
    case 401:
    case 403:
      return new UnauthorizedError(init);
    case 404:
      return new NotFoundError(init);
    case 409:
      return new ConflictError(init);
    case 429:
      return new RateLimitError(init);
    default:
      return new ObolApiError(init);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFromBody(body: unknown, status: number): string {
  const message = isRecord(body) ? body.message : undefined;
  if (typeof message === 'string' && message !== '') {
    return message;
  }
  // Validation errors can carry a list of messages.
  if (Array.isArray(message) && message.length > 0) {
    return message.map(String).join('; ');
  }
  return `Obol API request failed with status ${status}`;
}

/**
 * Thrown when a method that requires an ethers `Signer` is called on a
 * client that was constructed without one.
 *
 * To fix: pass an ethers `Signer` (e.g. a `Wallet` or `JsonRpcSigner`) as the
 * second argument to `new Client(config, signer)`.
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
 * (e.g. deploying splitters on a chain without factory contracts), or when
 * {@link Client} is constructed with a chain ID outside {@link SUPPORTED_CHAIN_IDS}.
 */
export class UnsupportedChainError extends Error {
  name = 'UnsupportedChainError';

  /**
   * @param chainId - The chain ID that was rejected.
   * @param operation - The operation or component that rejected it.
   * @param detail - Optional extra guidance appended to the message.
   */
  constructor(chainId: number, operation: string, detail?: string) {
    super(
      `${operation} is not supported on chain ${chainId}${detail ? `. ${detail}` : ''}`,
    );
    Object.setPrototypeOf(this, UnsupportedChainError.prototype);
  }
}

/**
 * Base class for errors raised by checks the SDK runs locally (as opposed to
 * {@link ObolApiError}, which wraps an Obol API response).
 *
 * `code` is a stable identifier for the failed check and `hint` a short,
 * actionable suggestion for the caller.
 */
export class ObolSdkError extends Error {
  name = 'ObolSdkError';
  /** Stable identifier of the failed check. */
  readonly code: string;
  /** Short, actionable suggestion for the caller. */
  hint?: string;

  constructor(message: string, code: string, hint?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
    if (hint !== undefined) {
      this.hint = hint;
    }
  }
}

/**
 * Thrown before sending a transaction or signing chain-bound EIP-712 data when
 * the signer's provider is connected to a different chain than the client's
 * `chainId`.
 *
 * To fix: switch the wallet to the client's chain, or construct the client
 * with the chain the wallet is on.
 */
export class ChainMismatchError extends ObolSdkError {
  name = 'ChainMismatchError';

  constructor(
    public readonly expectedChainId: number,
    public readonly actualChainId: number,
    method: string,
  ) {
    super(
      `${method}: signer is connected to chain ${actualChainId} but the client is configured for chain ${expectedChainId}`,
      'CHAIN_MISMATCH',
      "Switch the wallet to the client's chain, or construct the client with the chain the wallet is on.",
    );
    Object.setPrototypeOf(this, ChainMismatchError.prototype);
  }
}

/**
 * Thrown when a cluster definition fetched from the API does not pass local
 * verification (config hash mismatch, wrong network, unsupported version,
 * or a conflicting `version` in the operator payload).
 */
export class DefinitionVerificationError extends ObolSdkError {
  name = 'DefinitionVerificationError';

  constructor(message: string) {
    super(
      message,
      'DEFINITION_VERIFICATION_FAILED',
      'Do not accept this definition; check the config hash and the client chainId.',
    );
    Object.setPrototypeOf(this, DefinitionVerificationError.prototype);
  }
}

/**
 * Thrown by {@link Client.acceptClusterDefinition} when the signer's address
 * is not one of the cluster definition's operators.
 */
export class NotAnOperatorError extends ObolSdkError {
  name = 'NotAnOperatorError';

  constructor(
    public readonly address: string,
    public readonly configHash: string,
  ) {
    super(
      `Address ${address} is not an operator in cluster definition ${configHash}`,
      'NOT_AN_OPERATOR',
      'Use the signer of one of the operator addresses in the definition.',
    );
    Object.setPrototypeOf(this, NotAnOperatorError.prototype);
  }
}

/**
 * Thrown by {@link Incentives.claimIncentives} when a pre-flight check fails.
 * `issues` holds the failed checks (see {@link Incentives.preflightClaim}).
 */
export class IncentivesPreflightError extends ObolSdkError {
  name = 'IncentivesPreflightError';

  constructor(
    message: string,
    public readonly issues: PreflightIssue[],
  ) {
    super(message, 'INCENTIVES_PREFLIGHT_FAILED', issues[0]?.hint);
    Object.setPrototypeOf(this, IncentivesPreflightError.prototype);
  }
}

/**
 * Thrown when a payload fails JSON schema validation before an API call or
 * transaction. The message lists the failing fields; `errors` holds the raw
 * AJV errors.
 */
export class PayloadValidationError extends ObolSdkError {
  name = 'PayloadValidationError';

  constructor(
    message: string,
    public readonly errors: ReadonlyArray<{
      instancePath: string;
      message?: string;
      keyword: string;
      params: Record<string, unknown>;
    }> = [],
  ) {
    super(
      message,
      'PAYLOAD_INVALID',
      'Fix the listed fields of the payload and try again.',
    );
    Object.setPrototypeOf(this, PayloadValidationError.prototype);
  }
}

/**
 * Thrown when an argument (hash, address) is malformed, before it is used in
 * an API path or a contract call.
 */
export class InvalidArgumentError extends ObolSdkError {
  name = 'InvalidArgumentError';

  constructor(
    message: string,
    /** Name of the invalid argument. */
    public readonly argument: string,
  ) {
    super(message, 'INVALID_ARGUMENT', `Check the ${argument} argument.`);
    Object.setPrototypeOf(this, InvalidArgumentError.prototype);
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

/**
 * Thrown by a write method (`splits.deposit`, `splits.requestWithdrawal`,
 * `eoa.deposit`, `eoa.requestWithdrawal`, `incentives.claimIncentives`) when
 * it fails after at least one of its transactions was broadcast.
 *
 * `txHashes` holds the transactions of the call that were mined.
 * `pendingTxHash` is the one that was broadcast but not confirmed (for a
 * contract wallet, the wallet's own transaction hash), and `pendingStatus`
 * says why: `reverted` (mined and reverted, so it moved nothing and a retry is
 * safe) or `unconfirmed` (no receipt was obtained; it may still be mined). The
 * original error is in `cause`.
 *
 * To fix: look these transactions up before retrying, so nothing is sent twice.
 */
export class TransactionSubmissionError extends ObolSdkError {
  name = 'TransactionSubmissionError';
  /** Hashes of the transactions of this call that were mined. */
  readonly txHashes: string[];
  /** Hash of the broadcast transaction that was not confirmed, if any. */
  readonly pendingTxHash?: string;
  /** Why `pendingTxHash` is not confirmed; set with `pendingTxHash`. */
  readonly pendingStatus?: 'reverted' | 'unconfirmed';
  /** The error that stopped the call. */
  readonly cause: unknown;

  constructor(
    message: string,
    {
      txHashes,
      pendingTxHash,
      pendingStatus,
      cause,
    }: {
      txHashes: string[];
      pendingTxHash?: string;
      pendingStatus?: 'reverted' | 'unconfirmed';
      cause: unknown;
    },
  ) {
    super(
      message,
      'TX_FAILED_AFTER_SEND',
      'Look up pendingTxHash and txHashes on a block explorer before retrying, so nothing is sent twice.',
    );
    Object.setPrototypeOf(this, TransactionSubmissionError.prototype);
    this.txHashes = txHashes;
    if (pendingTxHash !== undefined) {
      this.pendingTxHash = pendingTxHash;
      this.pendingStatus = pendingStatus ?? 'unconfirmed';
    }
    this.cause = cause;
  }
}
