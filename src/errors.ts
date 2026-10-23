/**
 * v3 errors: one class for every local check and a subclass for Obol API
 * responses. Callers switch on `code`; the codes and their extra fields are
 * listed in spec/errors.md and typed in `ObolErrorDetails`.
 */
import type {
  ApiErrorCode,
  Issue,
  ObolErrorCode,
  ObolErrorDetails,
} from './codes.js';

export type { Issue };

type DetailsArg<C extends ObolErrorCode> =
  Record<string, never> extends ObolErrorDetails[C]
    ? { details?: ObolErrorDetails[C] }
    : { details: ObolErrorDetails[C] };

export type ObolErrorOptions<C extends ObolErrorCode> = {
  hint?: string;
  cause?: unknown;
} & DetailsArg<C>;

/**
 * The details of an error of code `C`: the typed fields of that code. While
 * the code is not known each field reads as `unknown`; narrow with
 * `isObolError(e, code)`.
 */
export type DetailsOf<C extends ObolErrorCode> = ObolErrorDetails[C] &
  Record<string, unknown>;

export class ObolError<C extends ObolErrorCode = ObolErrorCode> extends Error {
  readonly code: C;
  readonly hint?: string;
  /** Extra fields named per code in spec/errors.md (`ObolErrorDetails[code]`). */
  readonly details: DetailsOf<C>;

  constructor(
    code: C,
    message: string,
    ...[options]: Record<string, never> extends ObolErrorDetails[C]
      ? [options?: ObolErrorOptions<C>]
      : [options: ObolErrorOptions<C>]
  ) {
    super(message);
    const opts = (options ?? {}) as {
      hint?: string;
      cause?: unknown;
      details?: ObolErrorDetails[C];
    };
    if (opts.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: opts.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    this.name = 'ObolError';
    this.code = code;
    this.hint = opts.hint;
    this.details = (opts.details ?? {}) as DetailsOf<C>;
  }
}

export class ObolApiError<
  C extends ApiErrorCode = ApiErrorCode,
> extends ObolError<C> {
  readonly status: number;
  readonly endpoint: string;
  readonly method: string;
  readonly body: unknown;

  constructor(
    code: C,
    message: string,
    http: { status: number; endpoint: string; method: string; body?: unknown },
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(code, message, {
      ...options,
      details: { status: http.status, endpoint: http.endpoint },
    } as unknown as ObolErrorOptions<C>);
    this.name = 'ObolApiError';
    this.status = http.status;
    this.endpoint = http.endpoint;
    this.method = http.method;
    this.body = http.body;
  }
}

/**
 * Whether `error` is an ObolError (with `code`, of that code). With a code,
 * `details` narrows to that code's fields:
 *
 *   if (isObolError(e, 'TX_UNCONFIRMED')) watch(e.details.hash)
 */
export function isObolError<C extends ObolErrorCode>(
  error: unknown,
  code: C,
): error is ObolError<C>;
export function isObolError(error: unknown): error is ObolError;
export function isObolError(error: unknown, code?: ObolErrorCode): boolean {
  return (
    error instanceof ObolError && (code === undefined || error.code === code)
  );
}

export const payloadInvalid = (issues: Issue[], hint?: string): ObolError =>
  new ObolError(
    'PAYLOAD_INVALID',
    `Invalid input: ${issues
      .map(i => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join('; ')}`,
    { hint, details: { issues } },
  );
