// src/resources/base.ts
import {
  DEFAULT_BASE_URL,
  DEFAULT_CHAIN_ID,
  SDK_VERSION,
} from './constants.js';
import { InvalidBaseUrlError } from './errors.js';
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

export interface BaseConfig {
  baseUrl?: string;
  chainId?: FORK_MAPPING;
}

export abstract class Base {
  baseUrl: string;
  chainId: number;
  fork_version: string;

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    chainId = DEFAULT_CHAIN_ID,
  }: BaseConfig) {
    this.baseUrl = assertAllowedBaseUrl(baseUrl);
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
