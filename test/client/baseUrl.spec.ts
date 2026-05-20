import { describe, expect, it } from '@jest/globals';
import { Client } from '../../src/index.js';
import { ALLOWED_OBOL_API_BASE_URLS } from '../../src/base.js';
import { InvalidBaseUrlError } from '../../src/errors.js';

describe('baseUrl validation', () => {
  it('accepts production and staging Obol API hosts', () => {
    for (const baseUrl of ALLOWED_OBOL_API_BASE_URLS) {
      const client = new Client({ baseUrl, chainId: 560048 });
      expect(client.baseUrl).toBe(new URL(baseUrl).origin);
    }
  });

  it('strips trailing slash on allowed hosts', () => {
    const client = new Client({
      baseUrl: 'https://api.obol.tech/',
      chainId: 560048,
    });
    expect(client.baseUrl).toBe('https://api.obol.tech');
  });

  it('rejects unknown API hosts by default', () => {
    expect(
      () =>
        new Client({
          baseUrl: 'https://evil.example',
          chainId: 560048,
        }),
    ).toThrow(InvalidBaseUrlError);
  });

  it('allows custom hosts when allowUnsafeBaseUrl is true', () => {
    const client = new Client({
      baseUrl: 'http://localhost:9999',
      chainId: 560048,
      allowUnsafeBaseUrl: true,
    });
    expect(client.baseUrl).toBe('http://localhost:9999');
  });

  it('strips trailing slashes on unsafe custom hosts', () => {
    const client = new Client({
      baseUrl: 'http://localhost:9999///',
      chainId: 560048,
      allowUnsafeBaseUrl: true,
    });
    expect(client.baseUrl).toBe('http://localhost:9999');
  });
});
