// ObolApi.request: what it returns and throws for each outcome of the HTTP
// call (a body, an empty body, a body that is not JSON, a failed status, a
// network failure, a timeout, the caller's abort).
import { ObolApi, type ApiRequest } from '../../src/api.js';
import { ObolApiError } from '../../src/errors.js';

type FetchArgs = Parameters<typeof fetch>;

const withFetch = async <R>(
  fake: (...args: FetchArgs) => Promise<Response>,
  run: (api: (timeoutMs?: number) => ObolApi) => Promise<R>,
): Promise<R> => {
  const original = globalThis.fetch;
  globalThis.fetch = fake as typeof fetch;
  try {
    return await run(
      (timeoutMs = 0) =>
        new ObolApi({ baseUrl: 'https://api.obol.tech', timeoutMs }),
    );
  } finally {
    globalThis.fetch = original;
  }
};

const thrownBy = async (promise: Promise<unknown>): Promise<unknown> =>
  await promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error,
  );

const causeOf = (error: unknown): unknown =>
  (error as { cause?: unknown }).cause;

/** A fetch that never answers and rejects with the signal's reason on abort. */
const hangingFetch = async (...[, init]: FetchArgs): Promise<Response> =>
  await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal;
    const fail = (): void => {
      reject(signal.reason ?? new Error('aborted'));
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail);
  });

const request = async (
  response: () => Response,
  endpoint = '/v1/lock',
  options?: ApiRequest,
): Promise<unknown> =>
  await withFetch(
    async () => response(),
    async api => await api().request(endpoint, options),
  );

describe('ObolApi.request', () => {
  it('returns the parsed JSON body of a successful response', async () => {
    expect(
      await request(() => new Response('{"a":[1,"b"]}', { status: 200 })),
    ).toEqual({ a: [1, 'b'] });
  });

  it('returns undefined for a successful response without a body', async () => {
    expect(
      await request(() => new Response(null, { status: 204 })),
    ).toBeUndefined();
    expect(
      await request(() => new Response('', { status: 200 })),
    ).toBeUndefined();
  });

  it('sends the method, the JSON body and its Content-Type', async () => {
    const seen: FetchArgs[] = [];
    await withFetch(
      async (...args) => {
        seen.push(args);
        return new Response('{}', { status: 201 });
      },
      async api =>
        await api().request('/v1/definition', {
          method: 'POST',
          body: { name: 'x' },
          headers: { Authorization: 'Bearer 0xabc' },
        }),
    );
    expect(seen).toHaveLength(1);
    const [url, init] = seen[0];
    expect(url).toBe('https://api.obol.tech/v1/definition');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"x"}');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer 0xabc',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no body and no Content-Type on a GET', async () => {
    const seen: FetchArgs[] = [];
    await withFetch(
      async (...args) => {
        seen.push(args);
        return new Response('{}', { status: 200 });
      },
      async api => await api().request('/v1/lock'),
    );
    const init = seen[0][1];
    expect(init?.method).toBe('GET');
    expect(init).not.toHaveProperty('body');
    expect(init?.headers).not.toHaveProperty('Content-Type');
  });

  it('throws API_ERROR for a successful response that is not JSON', async () => {
    const error = (await thrownBy(
      request(() => new Response('<html>ok</html>', { status: 200 })),
    )) as ObolApiError;
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_ERROR');
    expect(error.message).toBe(
      'Obol API returned a body that is not JSON (GET /v1/lock)',
    );
    expect(error.details).toEqual({ endpoint: '/v1/lock', status: 200 });
    expect(error.status).toBe(200);
    expect(error.endpoint).toBe('/v1/lock');
    expect(error.method).toBe('GET');
    expect(error.body).toBe('<html>ok</html>');
  });

  it('keeps the text of a failed response that is not JSON', async () => {
    const error = (await thrownBy(
      request(() => new Response('Bad Gateway', { status: 502 })),
    )) as ObolApiError;
    expect(error.code).toBe('API_ERROR');
    expect(error.status).toBe(502);
    expect(error.message).toBe(
      'Obol API GET /v1/lock failed with 502: Bad Gateway',
    );
    expect(error.details).toEqual({ endpoint: '/v1/lock', status: 502 });
    expect(error.method).toBe('GET');
    expect(error.body).toBe('Bad Gateway');
    expect(error.requestId).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it('joins a list of messages, and leaves the detail out without one', async () => {
    const listed = (await thrownBy(
      request(
        () =>
          new Response('{"message":["a is required","b is required"]}', {
            status: 400,
          }),
        '/v1/definition',
        { method: 'POST', body: {} },
      ),
    )) as ObolApiError;
    expect(listed.message).toBe(
      'Obol API POST /v1/definition failed with 400: a is required; b is required',
    );
    const bare = (await thrownBy(
      request(() => new Response('', { status: 503 })),
    )) as ObolApiError;
    expect(bare.message).toBe('Obol API GET /v1/lock failed with 503');
    expect(bare.details).toMatchObject({ status: 503 });
    expect(bare.body).toBeUndefined();
  });

  it('wraps a network failure in API_ERROR with status 0', async () => {
    const cause = new TypeError('fetch failed');
    const error = (await thrownBy(
      withFetch(
        async () => {
          throw cause;
        },
        async api => await api().request('/v1/lock'),
      ),
    )) as ObolApiError;
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_ERROR');
    expect(error.message).toBe('Obol API GET /v1/lock failed: fetch failed');
    expect(error.details).toEqual({ endpoint: '/v1/lock', status: 0 });
    expect(error.method).toBe('GET');
    expect(error.body).toBeUndefined();
    expect(causeOf(error)).toBe(cause);
  });

  it('throws API_TIMEOUT when the API does not answer within timeoutMs', async () => {
    const error = (await thrownBy(
      withFetch(
        hangingFetch,
        async api =>
          await api(20).request('/v1/definition', {
            method: 'POST',
            body: {},
          }),
      ),
    )) as ObolApiError;
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_TIMEOUT');
    expect(error.message).toBe(
      'Obol API POST /v1/definition did not answer within 20 ms',
    );
    expect(error.details).toEqual({ endpoint: '/v1/definition', status: 0 });
    expect(error.method).toBe('POST');
    expect(error.hint).toBe(
      'A write may still have been processed; read the resource before retrying',
    );
    expect(causeOf(error)).toBeDefined();
  });

  it('a timeout that fires while the body is read is still API_TIMEOUT', async () => {
    const slowBody = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => {
        await new Promise(resolve => setTimeout(resolve, 60));
        return 'not json';
      },
    } as unknown as Response;
    const error = (await thrownBy(
      withFetch(
        async () => slowBody,
        async api => await api(10).request('/v1/lock'),
      ),
    )) as ObolApiError;
    expect(error.code).toBe('API_TIMEOUT');
    expect(causeOf(error)).toBeInstanceOf(ObolApiError);
  });

  it("rethrows the caller's abort as it is", async () => {
    const reason = new Error('the caller gave up');
    const before = new AbortController();
    before.abort(reason);
    expect(
      await thrownBy(
        withFetch(
          hangingFetch,
          async api =>
            await api().request('/v1/lock', { signal: before.signal }),
        ),
      ),
    ).toBe(reason);

    const during = new AbortController();
    const pending = thrownBy(
      withFetch(
        hangingFetch,
        async api => await api().request('/v1/lock', { signal: during.signal }),
      ),
    );
    during.abort(reason);
    expect(await pending).toBe(reason);
  });

  it('an API error wins over a caller abort that came after the answer', async () => {
    const controller = new AbortController();
    const error = (await thrownBy(
      withFetch(
        async () => {
          controller.abort(new Error('late'));
          return new Response('{"message":"gone"}', { status: 404 });
        },
        async api =>
          await api().request('/v1/lock', { signal: controller.signal }),
      ),
    )) as ObolApiError;
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_NOT_FOUND');
  });

  it("stops listening to the caller's signal once the request settles", async () => {
    const controller = new AbortController();
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const { signal } = controller;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, listener: any) => {
      added.push(listener);
      add(type, listener);
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((type: string, listener: any) => {
      removed.push(listener);
      remove(type, listener);
    }) as typeof signal.removeEventListener;
    await withFetch(
      async () => new Response('{}', { status: 200 }),
      async api => await api().request('/v1/lock', { signal }),
    );
    expect(added).toHaveLength(1);
    expect(removed).toEqual(added);
  });
});
