// Obol API error responses: the X-Request-Id and a 429's Retry-After are kept
// on the ObolApiError, and a 451 (sanctioned address) gets its own hint.
import { ObolApi, retryAfterSeconds } from '../../src/api.js';
import { ObolApiError, isObolError } from '../../src/errors.js';

const respondWith = async (response: Response): Promise<ObolApiError> => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  try {
    await new ObolApi({
      baseUrl: 'https://api.obol.tech',
      timeoutMs: 0,
    }).request('/v1/lock');
  } catch (error) {
    return error as ObolApiError;
  } finally {
    globalThis.fetch = original;
  }
  throw new Error('expected the request to fail');
};

describe('Obol API errors', () => {
  it('keeps the request id in the error, its details and its message', async () => {
    const error = await respondWith(
      new Response('{"statusCode":404,"message":"Data is not found"}', {
        status: 404,
        headers: { 'X-Request-Id': '8d2f1c3b4a5e6f70-AMS' },
      }),
    );
    expect(isObolError(error, 'API_NOT_FOUND')).toBe(true);
    expect(error.requestId).toBe('8d2f1c3b4a5e6f70-AMS');
    expect(error.details).toMatchObject({
      status: 404,
      requestId: '8d2f1c3b4a5e6f70-AMS',
    });
    expect(error.message).toBe(
      'Obol API GET /v1/lock failed with 404: Data is not found (request 8d2f1c3b4a5e6f70-AMS)',
    );
  });

  it('leaves the request id out when the header is absent', async () => {
    const error = await respondWith(
      new Response('{"statusCode":500,"message":"Internal server error"}', {
        status: 500,
      }),
    );
    expect(error.requestId).toBeUndefined();
    expect(error.details).not.toHaveProperty('requestId');
    expect(error.message).toBe(
      'Obol API GET /v1/lock failed with 500: Internal server error',
    );
  });

  it("reads a 429's Retry-After", async () => {
    const error = await respondWith(
      new Response('{"statusCode":429,"message":"Too Many Requests"}', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    );
    expect(isObolError(error, 'API_RATE_LIMIT')).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.details).toMatchObject({ retryAfterSeconds: 30 });
  });

  it('hints that a 451 is a sanctioned address, not a retry', async () => {
    const error = await respondWith(
      new Response(
        '{"statusCode":451,"message":"Unavailable For Legal Reasons"}',
        {
          status: 451,
        },
      ),
    );
    expect(error.code).toBe('API_ERROR');
    expect(error.hint).toMatch(/sanctions list/);
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(retryAfterSeconds('120', now)).toBe(120);
    expect(retryAfterSeconds('Tue, 27 Oct 2026 12:00:45 GMT', now)).toBe(45);
    expect(retryAfterSeconds('Tue, 27 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(retryAfterSeconds(null, now)).toBeUndefined();
    expect(retryAfterSeconds('soon', now)).toBeUndefined();
  });
});
