// cluster.watch polling, the cases around a failed request: the lock phase's
// errors and backoff, an abort that arrives while a request is failing, a
// sleep that rejects, and a consumer that stops early.
import type { Hex } from 'viem';
import {
  createClusterModule,
  type ClusterEvent,
} from '../../src/cluster/index.js';
import type { ApiErrorCode } from '../../src/codes.js';
import { ObolApiError } from '../../src/errors.js';
import { clusterLockV1X10 } from '../fixtures.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));
const lock = copy(clusterLockV1X10);
const definition = lock.cluster_definition;
const configHash = definition.config_hash as Hex;
const DEF = `/v1/definition/${configHash}`;
const LOCK = `/v1/lock/configHash/${configHash}`;

const apiError = (
  code: ApiErrorCode,
  status: number,
  endpoint: string,
): ObolApiError =>
  new ObolApiError(code, code, { status, endpoint, method: 'GET' });

const failing =
  (code: ApiErrorCode, status: number, endpoint: string) => () => {
    throw apiError(code, status, endpoint);
  };

/** Answers each route from a queue; the last answer repeats. */
const sequence = (
  answers: Record<string, Array<() => unknown>>,
): ReturnType<typeof fakeApi> => {
  const api = fakeApi({});
  const queues = Object.fromEntries(
    Object.entries(answers).map(([k, v]) => [k, [...v]]),
  );
  (api as any).request = async (endpoint: string) => {
    api.calls.push({ method: 'GET', endpoint });
    const queue = queues[endpoint];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return (next as () => unknown)();
  };
  return api;
};

const run = async (
  api: ReturnType<typeof fakeApi>,
  controller = new AbortController(),
  sleep: (ms: number) => Promise<void> = async () => {},
): Promise<{ events: ClusterEvent[]; waits: number[]; error: any }> => {
  const waits: number[] = [];
  const events: ClusterEvent[] = [];
  let error: any;
  try {
    for await (const event of createClusterModule(
      fakeChain().context(api),
    ).watch(configHash, {
      signal: controller.signal,
      sleep: async ms => {
        waits.push(ms);
        await sleep(ms);
      },
    })) {
      events.push(event);
    }
  } catch (e) {
    error = e;
  }
  return { events, waits, error };
};

describe('cluster.watch polling', () => {
  it('throws a lock error that is not a 404 at once, after definition_ready', async () => {
    const thrown = apiError('API_VALIDATION', 400, LOCK);
    const api = sequence({
      [DEF]: [() => definition],
      [LOCK]: [
        () => {
          throw thrown;
        },
      ],
    });
    const { events, waits, error } = await run(api);
    expect(error).toBe(thrown);
    expect(events.map(e => e.type)).toEqual([
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'definition_ready',
    ]);
    expect(waits).toEqual([12_000]);
    expect(api.calls.map(c => c.endpoint)).toEqual([DEF, LOCK]);
  });

  it('backs off on a transient lock error, keeps polling on a 404, then publishes', async () => {
    const api = sequence({
      [DEF]: [() => definition],
      [LOCK]: [
        failing('API_ERROR', 503, LOCK),
        failing('API_RATE_LIMIT', 429, LOCK),
        failing('API_NOT_FOUND', 404, LOCK),
        failing('API_TIMEOUT', 0, LOCK),
        () => lock,
      ],
    });
    const { events, waits, error } = await run(api);
    expect(error).toBeUndefined();
    expect(events[events.length - 1]).toEqual({
      type: 'lock_published',
      lockHash: lock.lock_hash,
    });
    // The 404 is a success for the backoff: the wait returns to intervalMs.
    expect(waits).toEqual([12_000, 24_000, 48_000, 12_000, 24_000]);
    // The definition is not read again once it is ready.
    expect(api.calls.map(c => c.endpoint)).toEqual([
      DEF,
      LOCK,
      LOCK,
      LOCK,
      LOCK,
      LOCK,
    ]);
  });

  it('throws the fifth transient lock failure in a row', async () => {
    const api = sequence({
      [DEF]: [() => definition],
      [LOCK]: [failing('API_ERROR', 500, LOCK)],
    });
    const { error, waits } = await run(api);
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_ERROR');
    expect(waits).toEqual([12_000, 24_000, 48_000, 60_000, 60_000]);
  });

  it('ends without an error when aborted while a request fails', async () => {
    for (const code of ['API_VALIDATION', 'API_ERROR'] as const) {
      const controller = new AbortController();
      const api = sequence({
        [DEF]: [
          () => {
            controller.abort();
            throw apiError(code, code === 'API_ERROR' ? 503 : 400, DEF);
          },
        ],
      });
      const { events, waits, error } = await run(api, controller);
      expect(error).toBeUndefined();
      expect(events).toEqual([]);
      expect(waits).toEqual([]);
    }
  });

  it('ends without an error when aborted during a successful poll', async () => {
    const controller = new AbortController();
    const api = sequence({
      [DEF]: [
        () => {
          controller.abort();
          return definition;
        },
      ],
    });
    const { events, waits, error } = await run(api, controller);
    expect(error).toBeUndefined();
    expect(events.map(e => e.type)).toEqual([
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'definition_ready',
    ]);
    expect(waits).toEqual([]);
    expect(api.calls).toHaveLength(1);
  });

  it('ends without an error when the sleep rejects', async () => {
    const api = sequence({
      [DEF]: [() => definition],
      [LOCK]: [() => lock],
    });
    const { events, waits, error } = await run(
      api,
      new AbortController(),
      async () => {
        throw new Error('the timer was torn down');
      },
    );
    expect(error).toBeUndefined();
    expect(events.map(e => e.type)).toEqual([
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'definition_ready',
    ]);
    expect(waits).toEqual([12_000]);
    expect(api.calls.map(c => c.endpoint)).toEqual([DEF]);
  });

  it('makes no further request once the consumer stops', async () => {
    const api = sequence({ [DEF]: [() => definition], [LOCK]: [() => lock] });
    const waits: number[] = [];
    const seen: ClusterEvent[] = [];
    for await (const event of createClusterModule(
      fakeChain().context(api),
    ).watch(configHash, {
      signal: new AbortController().signal,
      sleep: async ms => {
        waits.push(ms);
      },
    })) {
      seen.push(event);
      if (event.type === 'definition_ready') break;
    }
    expect(seen).toHaveLength(5);
    expect(waits).toEqual([]);
    expect(api.calls.map(c => c.endpoint)).toEqual([DEF]);
  });

  it('ends after lock_published without sleeping again', async () => {
    const api = sequence({ [DEF]: [() => definition], [LOCK]: [() => lock] });
    const iterator = createClusterModule(fakeChain().context(api))
      .watch(configHash, {
        signal: new AbortController().signal,
        sleep: async () => {},
      })
      [Symbol.asyncIterator]();
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await iterator.next());
    expect(results.map(r => r.done)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(results[5].value).toEqual({
      type: 'lock_published',
      lockHash: lock.lock_hash,
    });
    expect(results[6].value).toBeUndefined();
    expect(api.calls.map(c => c.endpoint)).toEqual([DEF, LOCK]);
  });
});
