// src/resources/base.ts
import {
  DEFAULT_BASE_URL,
  DEFAULT_CHAIN_ID,
  SDK_VERSION,
} from './constants.js';
import { InvalidBaseUrlError } from './errors.js';
import { FORK_MAPPING } from './types.js';

/**
 * Official Obol API hosts. {@link Client} only sends requests (and EIP-712
 * Bearer signatures) to these origins unless {@link allowUnsafeBaseUrl} is set.
 */
export const ALLOWED_OBOL_API_BASE_URLS = [
  DEFAULT_BASE_URL,
  'https://obol-api-nonprod-dev.dev.obol.tech',
  'https://obol-api-nonprod-qa.dev.obol.tech',
] as const;

export type AllowedObolApiBaseUrl = (typeof ALLOWED_OBOL_API_BASE_URLS)[number];

const ALLOWED_ORIGINS = new Set<string>(
  ALLOWED_OBOL_API_BASE_URLS.map(url => new URL(url).origin),
);

export type ValidateBaseUrlOptions = {
  /**
   * Skip the Obol API host allowlist. For local tests and mocks only — never
   * use in production with a real signer.
   */
  allowUnsafeBaseUrl?: boolean;
};

/** Strip trailing slashes in O(n) time (no regex — avoids ReDoS on long inputs). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '/') {
    end--;
  }
  return value.slice(0, end);
}

/**
 * Normalizes and validates the Obol API base URL used by {@link Base.request}.
 */
export function validateAndNormalizeBaseUrl(
  baseUrl: string,
  options?: ValidateBaseUrlOptions,
): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new InvalidBaseUrlError('baseUrl must not be empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidBaseUrlError(`Invalid baseUrl: ${baseUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new InvalidBaseUrlError(
      `baseUrl must use http or https (received ${parsed.protocol})`,
    );
  }

  const origin = parsed.origin;

  if (ALLOWED_ORIGINS.has(origin)) {
    return origin;
  }

  if (options?.allowUnsafeBaseUrl) {
    return stripTrailingSlashes(trimmed);
  }

  throw new InvalidBaseUrlError(
    `baseUrl must be an official Obol API host (${ALLOWED_OBOL_API_BASE_URLS.join(', ')}). ` +
      `Received: ${origin}. ` +
      'Pass allowUnsafeBaseUrl: true only for local tests — never with production signers.',
  );
}

export interface BaseConfig {
  baseUrl?: string;
  chainId?: FORK_MAPPING;
  /**
   * Skip the Obol API host allowlist. For local tests and mocks only — never
   * use in production with a real signer.
   */
  allowUnsafeBaseUrl?: boolean;
}

export abstract class Base {
  baseUrl: string;
  chainId: number;
  fork_version: string;

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    chainId = DEFAULT_CHAIN_ID,
    allowUnsafeBaseUrl = false,
  }: BaseConfig) {
    this.baseUrl = validateAndNormalizeBaseUrl(baseUrl, { allowUnsafeBaseUrl });
    this.chainId = chainId;
    this.fork_version = FORK_MAPPING[this.chainId];
  }

  protected async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      ...options,
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
      } else {
        const errorResponse = await response.json();
        throw errorResponse;
      }
    } catch (e: any) {
      throw e;
    }
  }
}
