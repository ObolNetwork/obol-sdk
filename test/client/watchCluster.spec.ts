// @ts-nocheck
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Client } from '../../src/index.js';
import { ClusterProgressTimeoutError } from '../../src/errors.js';
import {
  definitionProgress,
  isTransientError,
  watchClusterProgress,
} from '../../src/clusterStatus.js';
import { clusterLockSoloV1X10, clusterLockV1X10 } from '../fixtures.js';

const signedDefinition = clusterLockV1X10.cluster_definition;
const configHash = signedDefinition.config_hash;
const lock = clusterLockV1X10;

/** The group definition with only the first `signed` operators signed. */
const definitionWithSigned = (signed: number) => ({
  ...signedDefinition,
  definition_hash: signed === 4 ? signedDefinition.definition_hash : undefined,
  operators: signedDefinition.operators.map((operator, i) =>
    i < signed
      ? operator
      : {
          address: operator.address,
          enr: '',
          enr_signature: '',
          config_signature: '',
        },
  ),
});

const soloDefinition = clusterLockSoloV1X10.cluster_definition;

const charonDefinition = {
  ...signedDefinition,
  creator: { address: '', config_signature: '' },
  definition_hash: undefined,
  operators: signedDefinition.operators.map(operator => ({
    address: '',
    enr: operator.enr,
    enr_signature: '',
    config_signature: '',
  })),
};

const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = status => {
  const body = { statusCode: status, message: `HTTP ${status}` };
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};
const notFound = () => fail(404);

/**
 * Mocks fetch with a sequence of responses per endpoint; the last entry
 * repeats once a sequence is exhausted.
 */
const mockApi = ({ definition = [], lock: lockResponses = [notFound()] }) => {
  const calls = { definition: 0, lock: 0 };
  global.fetch = jest.fn(async (url: string) => {
    const key = url.includes('/lock/configHash/') ? 'lock' : 'definition';
    const sequence = key === 'lock' ? lockResponses : definition;
    const response = sequence[Math.min(calls[key], sequence.length - 1)];
    calls[key]++;
    if (response instanceof Error) throw response;
    return response;
  });
  return calls;
};

/** Sleep stub that records delays and resolves immediately. */
const recordingSleep = () => {
  const delays: number[] = [];
  const sleep = jest.fn(async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason;
    delays.push(ms);
  });
  return { delays, sleep };
};

const collect = async generator => {
  const states = [];
  for await (const state of generator) states.push(state);
  return states;
};

const summarize = states =>
  states.map(s =>
    s.step === 'awaiting_signatures'
      ? `${s.step}:${s.signed}/${s.total}`
      : s.step,
  );

describe('definitionProgress', () => {
  it('counts signed operators and lists pending addresses', () => {
    const progress = definitionProgress(definitionWithSigned(2));
    expect(progress).toMatchObject({
      step: 'awaiting_signatures',
      signed: 2,
      total: 4,
      pending: [
        signedDefinition.operators[2].address,
        signedDefinition.operators[3].address,
      ],
    });
  });

  it('is ready once every operator has signed', () => {
    expect(definitionProgress(signedDefinition).step).toBe('definition_ready');
    const noHash = { ...signedDefinition, definition_hash: undefined };
    expect(definitionProgress(noHash).step).toBe('definition_ready');
  });

  it('treats solo and Charon definitions as ready', () => {
    expect(definitionProgress(soloDefinition).step).toBe('definition_ready');
    expect(definitionProgress(charonDefinition).step).toBe('definition_ready');
  });

  it('is ready when definition_hash is set', () => {
    const def = { ...definitionWithSigned(1), definition_hash: '0xabc' };
    expect(definitionProgress(def).step).toBe('definition_ready');
  });
});

describe('isTransientError', () => {
  it('retries network errors, 408, 429 and 5xx', () => {
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientError({ statusCode: 503 })).toBe(true);
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 408 })).toBe(true);
  });

  it('does not retry other 4xx', () => {
    expect(isTransientError({ statusCode: 404 })).toBe(false);
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ statusCode: 403 })).toBe(false);
  });
});

describe('Client.watchCluster', () => {
  const client = new Client({
    baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech',
    chainId: 560048,
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Runs the watcher to completion, advancing fake timers as it sleeps. */
  const run = async (options = {}) => {
    const done = collect(client.watchCluster(configHash, options));
    let settled = false;
    void done.finally(() => (settled = true)).catch(() => {});
    while (!settled) await jest.advanceTimersByTimeAsync(1000);
    return await done;
  };

  it('yields 2/4 -> 3/4 -> ready -> lock without duplicates', async () => {
    mockApi({
      definition: [
        ok(definitionWithSigned(2)),
        ok(definitionWithSigned(2)),
        ok(definitionWithSigned(3)),
        ok(definitionWithSigned(3)),
        ok(signedDefinition),
      ],
      lock: [notFound(), notFound(), ok(lock)],
    });

    const states = await run();

    expect(summarize(states)).toEqual([
      'awaiting_signatures:2/4',
      'awaiting_signatures:3/4',
      'definition_ready',
      'lock_published',
    ]);
    expect(states[3]).toMatchObject({ lockHash: lock.lock_hash, lock });
    expect(states[2].definition).toEqual(signedDefinition);
  });

  it('stops polling the definition once it is ready', async () => {
    const calls = mockApi({
      definition: [ok(signedDefinition)],
      lock: [notFound(), notFound(), ok(lock)],
    });
    await run();
    expect(calls).toEqual({ definition: 1, lock: 3 });
  });

  it('starts solo and Charon definitions at definition_ready', async () => {
    for (const definition of [soloDefinition, charonDefinition]) {
      mockApi({ definition: [ok(definition)], lock: [notFound(), ok(lock)] });
      expect(summarize(await run())).toEqual([
        'definition_ready',
        'lock_published',
      ]);
    }
  });

  it('retries a transient 503 and network errors', async () => {
    mockApi({
      definition: [
        fail(503),
        new TypeError('fetch failed'),
        ok(definitionWithSigned(3)),
        fail(429),
        ok(signedDefinition),
      ],
      lock: [fail(502), ok(lock)],
    });
    expect(summarize(await run())).toEqual([
      'awaiting_signatures:3/4',
      'definition_ready',
      'lock_published',
    ]);
  });

  it('throws on 404 for the definition', async () => {
    mockApi({ definition: [notFound()] });
    await expect(
      collect(client.watchCluster(configHash)),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws on other 4xx', async () => {
    mockApi({ definition: [ok(signedDefinition)], lock: [fail(400)] });
    await expect(
      collect(client.watchCluster(configHash)),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects malformed config hashes', () => {
    expect(() => client.watchCluster('../lock/abc')).toThrow('configHash');
  });

  it('aborts promptly during sleep', async () => {
    mockApi({ definition: [ok(definitionWithSigned(2))] });
    const controller = new AbortController();
    const iterator = client.watchCluster(configHash, {
      signal: controller.signal,
      intervalMs: 60_000,
    });
    const first = await iterator.next();
    expect(first.value.step).toBe('awaiting_signatures');

    const next = iterator.next();
    await jest.advanceTimersByTimeAsync(10);
    controller.abort(new Error('stop'));
    await expect(next).rejects.toThrow('stop');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('throws immediately when the signal is already aborted', async () => {
    mockApi({ definition: [ok(signedDefinition)] });
    const controller = new AbortController();
    controller.abort(new Error('already'));
    await expect(
      collect(client.watchCluster(configHash, { signal: controller.signal })),
    ).rejects.toThrow('already');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('watchClusterProgress backoff', () => {
  it('grows by 1.5x up to maxIntervalMs and resets on change', async () => {
    const definitions = [
      ...Array(6).fill(definitionWithSigned(2)),
      definitionWithSigned(3),
      definitionWithSigned(3),
      signedDefinition,
    ];
    let i = 0;
    const { delays, sleep } = recordingSleep();
    const states = await collect(
      watchClusterProgress(
        {
          getDefinition: async () =>
            definitions[Math.min(i++, definitions.length - 1)],
          getLock: async () => lock,
          sleep,
        },
        { intervalMs: 1000, maxIntervalMs: 4000 },
      ),
    );

    expect(summarize(states)).toEqual([
      'awaiting_signatures:2/4',
      'awaiting_signatures:3/4',
      'definition_ready',
      'lock_published',
    ]);
    // 2/4 x6 (change, then 5 unchanged), 3/4 (change), 3/4 (unchanged)
    expect(delays).toEqual([1000, 1500, 2250, 3375, 4000, 4000, 1000, 1500]);
  });

  it('backs off on transient errors', async () => {
    const { delays, sleep } = recordingSleep();
    const responses = [
      () => {
        throw { statusCode: 503 };
      },
      () => {
        throw { statusCode: 503 };
      },
      () => signedDefinition,
    ];
    let i = 0;
    await collect(
      watchClusterProgress(
        {
          getDefinition: async () => responses[i++](),
          getLock: async () => lock,
          sleep,
        },
        { intervalMs: 2000 },
      ),
    );
    expect(delays).toEqual([3000, 4500]);
  });

  it('uses 2s/30s defaults', async () => {
    const { delays, sleep } = recordingSleep();
    let n = 0;
    await collect(
      watchClusterProgress({
        getDefinition: async () => signedDefinition,
        getLock: async () => (++n > 10 ? lock : null),
        sleep,
      }),
    );
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBe(3000);
    expect(Math.max(...delays)).toBe(30000);
  });

  it('rejects invalid intervals', async () => {
    const source = {
      getDefinition: async () => signedDefinition,
      getLock: async () => lock,
    };
    await expect(
      collect(watchClusterProgress(source, { intervalMs: 0 })),
    ).rejects.toThrow('intervalMs');
    await expect(
      collect(watchClusterProgress(source, { maxIntervalMs: -1 })),
    ).rejects.toThrow('maxIntervalMs');
  });
});

describe('Client.waitFor', () => {
  const client = new Client({
    baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech',
    chainId: 560048,
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with lock_published and reports progress', async () => {
    mockApi({
      definition: [ok(definitionWithSigned(3)), ok(signedDefinition)],
      lock: [notFound(), ok(lock)],
    });
    const onProgress = jest.fn();
    const promise = client.waitFor(configHash, 'lock_published', {
      onProgress,
    });
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result).toMatchObject({
      step: 'lock_published',
      lockHash: lock.lock_hash,
    });
    expect(summarize(onProgress.mock.calls.map(([s]) => s))).toEqual([
      'awaiting_signatures:3/4',
      'definition_ready',
      'lock_published',
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves at definition_ready without fetching the lock', async () => {
    mockApi({
      definition: [ok(definitionWithSigned(3)), ok(signedDefinition)],
      lock: [ok(lock)],
    });
    const promise = client.waitFor(configHash, 'definition_ready');
    await jest.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.step).toBe('definition_ready');
    expect(result.definition).toEqual(signedDefinition);
    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls.some(url => url.includes('/lock/'))).toBe(false);
  });

  it('rejects with ClusterProgressTimeoutError on timeout', async () => {
    mockApi({ definition: [ok(definitionWithSigned(2))] });
    const promise = client.waitFor(configHash, 'lock_published', {
      timeoutMs: 10_000,
    });
    const assertion = expect(promise).rejects.toThrow(
      ClusterProgressTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;
    await expect(promise).rejects.toThrow(
      "Cluster did not reach 'lock_published' within 10000 ms",
    );
    await expect(promise).rejects.toMatchObject({
      code: 'CLUSTER_PROGRESS_TIMEOUT',
      target: 'lock_published',
      timeoutMs: 10_000,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the abort reason when the caller aborts', async () => {
    mockApi({ definition: [ok(definitionWithSigned(2))] });
    const controller = new AbortController();
    const promise = client.waitFor(configHash, 'lock_published', {
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    const assertion = expect(promise).rejects.toThrow('user cancelled');
    await jest.advanceTimersByTimeAsync(3_000);
    controller.abort(new Error('user cancelled'));
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates fatal errors', async () => {
    mockApi({ definition: [notFound()] });
    await expect(
      client.waitFor(configHash, 'lock_published'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects unknown targets', async () => {
    await expect(
      client.waitFor(configHash, 'awaiting_signatures'),
    ).rejects.toThrow('Unknown target step');
  });
});
