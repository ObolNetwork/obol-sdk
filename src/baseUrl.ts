import { DEFAULT_BASE_URL } from './constants.js';
import { InvalidBaseUrlError } from './errors.js';

/**
 * Official Obol API hosts. {@link Client} only sends requests (and EIP-712
 * Bearer signatures) to these origins unless {@link allowUnsafeBaseUrl} is set.
 */
export const ALLOWED_OBOL_API_BASE_URLS = [
  DEFAULT_BASE_URL,
  'https://obol-api-dev.gcp.obol.tech',
  'https://obol-api-nonprod-dev.dev.obol.tech',
] as const;

export type AllowedObolApiBaseUrl =
  (typeof ALLOWED_OBOL_API_BASE_URLS)[number];

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
    return trimmed.replace(/\/+$/, '');
  }

  throw new InvalidBaseUrlError(
    `baseUrl must be an official Obol API host (${ALLOWED_OBOL_API_BASE_URLS.join(', ')}). ` +
      `Received: ${origin}. ` +
      'Pass allowUnsafeBaseUrl: true only for local tests — never with production signers.',
  );
}
