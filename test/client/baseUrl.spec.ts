import { describe, expect, it } from '@jest/globals';
import { Client } from '../../src/index.js';
import { ALLOWED_OBOL_API_BASE_URLS } from '../../src/base.js';
import { InvalidBaseUrlError } from '../../src/errors.js';

describe('baseUrl validation', () => {
  it('accepts allowed Obol API base URLs', () => {
    for (const baseUrl of ALLOWED_OBOL_API_BASE_URLS) {
      const client = new Client({ baseUrl, chainId: 560048 });
      expect(client.baseUrl).toBe(baseUrl);
    }
  });

  it('accepts a trailing slash on allowed base URLs', () => {
    const client = new Client({
      baseUrl: 'https://api.obol.tech/',
      chainId: 560048,
    });
    expect(client.baseUrl).toBe('https://api.obol.tech');
  });

  it('rejects unknown base URLs', () => {
    expect(
      () =>
        new Client({
          baseUrl: 'https://evil.example',
          chainId: 560048,
        }),
    ).toThrow(InvalidBaseUrlError);
  });
});
