/**
 * v3 errors: one class for every local check and a subclass for Obol API
 * responses. Callers switch on `code`; the codes and their extra fields are
 * listed in spec/errors.md.
 */

export interface Issue {
  path: string;
  message: string;
  issue?: string;
}

export class ObolError extends Error {
  readonly code: string;
  readonly hint?: string;
  /** Extra fields named per code in spec/errors.md (index, issue, address, ...). */
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      hint?: string;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    this.name = 'ObolError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details ?? {};
  }
}

export class ObolApiError extends ObolError {
  readonly status: number;
  readonly endpoint: string;
  readonly method: string;
  readonly body: unknown;

  constructor(
    code: string,
    message: string,
    http: { status: number; endpoint: string; method: string; body?: unknown },
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(code, message, {
      ...options,
      details: { status: http.status, endpoint: http.endpoint },
    });
    this.name = 'ObolApiError';
    this.status = http.status;
    this.endpoint = http.endpoint;
    this.method = http.method;
    this.body = http.body;
  }
}

export const isObolError = (
  error: unknown,
  code?: string,
): error is ObolError =>
  error instanceof ObolError && (code === undefined || error.code === code);

export const payloadInvalid = (issues: Issue[], hint?: string): ObolError =>
  new ObolError(
    'PAYLOAD_INVALID',
    `Invalid input: ${issues
      .map(i => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join('; ')}`,
    { hint, details: { issues } },
  );
