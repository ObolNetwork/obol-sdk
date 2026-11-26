// The Obol API request headers: Content-Type only with a body (a GET stays a
// simple CORS request in browsers), and a User-Agent naming the SDK in Node only.
import { ObolApi, requestHeaders, SDK_VERSION } from '../../src/api.js';

describe('Obol API request headers', () => {
  it('sends Content-Type only with a body', () => {
    expect(requestHeaders(false, {}, false)).toEqual({});
    expect(requestHeaders(true, {}, false)).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('names the SDK in Node and never in a browser', () => {
    expect(requestHeaders(false, {}, true)).toEqual({
      'User-Agent': `obol-sdk/${SDK_VERSION}`,
    });
    expect(requestHeaders(true, {}, false)).not.toHaveProperty('User-Agent');
  });

  it("keeps the caller's headers last", () => {
    expect(
      requestHeaders(
        true,
        { Authorization: 'Bearer 0x01', 'User-Agent': 'x' },
        true,
      ),
    ).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'x',
      Authorization: 'Bearer 0x01',
    });
  });

  it('sends them on the wire (a GET from Node: User-Agent, no Content-Type)', async () => {
    const seen: Array<Record<string, string>> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      const api = new ObolApi({
        baseUrl: 'https://api.obol.tech',
        timeoutMs: 0,
      });
      await api.request('/v1/_health');
      await api.request('/v1/lock', { method: 'POST', body: { a: 1 } });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]).toEqual({ 'User-Agent': `obol-sdk/${SDK_VERSION}` });
    expect(seen[1]).toMatchObject({ 'Content-Type': 'application/json' });
  });
});
