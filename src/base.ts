// src/resources/base.ts
import {
  DEFAULT_BASE_URL,
  DEFAULT_CHAIN_ID,
  SDK_VERSION,
  SUPPORTED_CHAIN_IDS,
} from './constants.js';
import {
  createObolApiError,
  InvalidBaseUrlError,
  RequestTimeoutError,
  UnsupportedChainError,
} from './errors.js';
import { FORK_MAPPING } from './types.js';

/** Official Obol API base URLs (no path suffix — `/v1` is added per request). */
export const ALLOWED_OBOL_API_BASE_URLS = [
  DEFAULT_BASE_URL,
  'https://obol-api-nonprod-dev.dev.obol.tech',
  'https://obol-api-nonprod-qa.dev.obol.tech',
] as const;

export type AllowedObolApiBaseUrl = (typeof ALLOWED_OBOL_API_BASE_URLS)[number];

const ALLOWED_BASE_URLS = new Set<string>(ALLOWED_OBOL_API_BASE_URLS);

function assertAllowedBaseUrl(baseUrl: string): string {
  let candidate = baseUrl.trim();
  while (candidate.endsWith('/')) {
    candidate = candidate.slice(0, -1);
  }
  if (!ALLOWED_BASE_URLS.has(candidate)) {
    throw new InvalidBaseUrlError(
      `baseUrl must be one of: ${ALLOWED_OBOL_API_BASE_URLS.join(', ')}`,
    );
  }
  return candidate;
}

/** Default Obol API request timeout in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function assertSupportedChainId(chainId: number): number {
  const id = Number(chainId);
  if (!SUPPORTED_CHAIN_IDS.includes(id)) {
    throw new UnsupportedChainError(
      chainId,
      'Obol SDK Client',
      'Supported chain IDs: 1 (Mainnet), 560048 (Hoodi)',
    );
  }
  return id;
}

export interface BaseConfig {
  baseUrl?: string;
  chainId?: FORK_MAPPING;
  /**
   * Obol API request timeout in milliseconds. Defaults to
   * {@link DEFAULT_REQUEST_TIMEOUT_MS}; `0` disables the timeout.
   * A timed-out request throws a {@link RequestTimeoutError}.
   */
  timeoutMs?: number;
}

export abstract class Base {
  baseUrl: string;
  chainId: number;
  fork_version: string;
  timeoutMs: number;

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    chainId = DEFAULT_CHAIN_ID,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: BaseConfig) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('timeoutMs must be a non-negative finite number');
    }
    this.baseUrl = assertAllowedBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs;
    this.chainId = assertSupportedChainId(chainId);
    this.fork_version = FORK_MAPPING[this.chainId];
  }

  /**
   * Sends a request to the Obol API and parses the JSON response.
   *
   * @throws {ObolApiError} (or a status-specific subclass) on a non-2xx response.
   * @throws {RequestTimeoutError} If no response arrives within `timeoutMs`.
   */
  protected async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options?.method ?? 'GET';

    const controller = new AbortController();
    const callerSignal = options?.signal;
    const onCallerAbort = (): void => {
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) {
      onCallerAbort();
    } else {
      callerSignal?.addEventListener('abort', onCallerAbort);
    }
    let timedOut = false;
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.timeoutMs)
        : undefined;

    const config = {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Obol-SDK/${SDK_VERSION}`,
        ...options?.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      if (response.ok) {
        return await response.json();
      }
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Non-JSON body (e.g. a gateway error page); keep the raw text.
      }
      throw createObolApiError({
        status: response.status,
        endpoint,
        method,
        body,
      });
    } catch (e: any) {
      if (timedOut) {
        throw new RequestTimeoutError(endpoint, method, this.timeoutMs);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
