/**
 * Obol API transport. Maps HTTP failures to the API_* codes of spec/errors.md;
 * a 2xx body is returned as is and checked by the caller.
 */
import type { ApiErrorCode } from './codes.js';
import { ObolApiError } from './errors.js';

export interface ApiConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const CODE_FOR_STATUS: Record<number, ApiErrorCode> = {
  400: 'API_VALIDATION',
  401: 'API_UNAUTHORIZED',
  403: 'API_UNAUTHORIZED',
  404: 'API_NOT_FOUND',
  409: 'API_CONFLICT',
  422: 'API_VALIDATION',
  429: 'API_RATE_LIMIT',
};

const HINT_FOR_CODE: Record<string, string> = {
  API_UNAUTHORIZED:
    'Check the wallet, the chain, and that the terms were accepted (terms.accept)',
  API_NOT_FOUND: 'Check the hash or address and the chain',
  API_CONFLICT: 'The resource exists; read it instead',
  API_RATE_LIMIT: 'Back off and retry',
};

/** Set by the build (tsup `define`) from package.json; `dev` from source. */
declare const __OBOL_SDK_VERSION__: string | undefined;
export const SDK_VERSION =
  typeof __OBOL_SDK_VERSION__ === 'string' ? __OBOL_SDK_VERSION__ : 'dev';

/**
 * Request headers. `Content-Type` only with a body: on a GET it would make a
 * browser's cross-origin request non-simple, costing a CORS preflight. A
 * `User-Agent` naming the SDK only in Node: browsers set their own, and
 * some refuse a script's.
 */
export const requestHeaders = (
  hasBody: boolean,
  extra: Record<string, string> = {},
  isNode: boolean = typeof (
    globalThis as { process?: { versions?: { node?: unknown } } }
  ).process?.versions?.node === 'string',
): Record<string, string> => ({
  ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  ...(isNode ? { 'User-Agent': `obol-sdk/${SDK_VERSION}` } : {}),
  ...extra,
});

const apiMessage = (body: unknown): string | undefined => {
  if (typeof body === 'string' && body.length > 0) return body.slice(0, 300);
  if (body !== null && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return undefined;
};

export class ObolApi {
  constructor(readonly config: ApiConfig) {}

  async request<R = unknown>(
    endpoint: string,
    options: ApiRequest = {},
  ): Promise<R> {
    const method = options.method ?? 'GET';
    const controller = new AbortController();
    const caller = options.signal;
    const onAbort = (): void => {
      controller.abort(caller?.reason);
    };
    if (caller?.aborted === true) onAbort();
    else caller?.addEventListener('abort', onAbort);
    let timedOut = false;
    const timer =
      this.config.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.config.timeoutMs)
        : undefined;
    const http = { endpoint, method };
    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        signal: controller.signal,
        headers: requestHeaders(options.body !== undefined, options.headers),
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        if (response.ok) {
          throw new ObolApiError(
            'API_ERROR',
            `Obol API returned a body that is not JSON (${method} ${endpoint})`,
            { ...http, status: response.status, body: text },
          );
        }
      }
      if (response.ok) return body as R;
      const code = CODE_FOR_STATUS[response.status] ?? 'API_ERROR';
      const detail = apiMessage(body);
      throw new ObolApiError(
        code,
        `Obol API ${method} ${endpoint} failed with ${response.status}${
          detail !== undefined ? `: ${detail}` : ''
        }`,
        { ...http, status: response.status, body },
        { hint: HINT_FOR_CODE[code] },
      );
    } catch (error) {
      if (timedOut) {
        throw new ObolApiError(
          'API_TIMEOUT',
          `Obol API ${method} ${endpoint} did not answer within ${this.config.timeoutMs} ms`,
          { ...http, status: 0 },
          {
            hint: 'A write may still have been processed; read the resource before retrying',
            cause: error,
          },
        );
      }
      if (error instanceof ObolApiError) throw error;
      if (caller?.aborted === true) throw error;
      throw new ObolApiError(
        'API_ERROR',
        `Obol API ${method} ${endpoint} failed: ${(error as Error).message}`,
        { ...http, status: 0 },
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onAbort);
    }
  }
}
