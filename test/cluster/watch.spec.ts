import type { Hex } from 'viem';
import {
  createClusterModule,
  type ClusterEvent,
} from '../../src/cluster/index.js';
import type { ApiErrorCode } from '../../src/codes.js';
import { ObolApiError, type ObolError } from '../../src/errors.js';
import { clusterLockSoloV1X10, clusterLockV1X10 } from '../fixtures.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));
const lock = copy(clusterLockV1X10);
const definition = lock.cluster_definition;
const configHash = definition.config_hash as Hex;
const DEF = `/v1/definition/${configHash}`;
const LOCK = `/v1/lock/configHash/${configHash}`;

const apiError = (code: ApiErrorCode, status: number, endpoint: string) =>
  new ObolApiError(code, code, { status, endpoint, method: 'GET' });

/** The definition with only the first `n` operators signed. */
const signedBy = (n: number): any => {
  const d = copy(definition);
  d.operators.forEach((o: any, i: number) => {
    if (i >= n) {
      o.config_signature = '';
      o.enr_signature = '';
    }
  });
  return d;
};

/** Answers each route from a queue; the last answer repeats. */
const sequence = (answers: Record<string, Array<() => unknown>>) => {
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
  options: { intervalMs?: number; abortAfter?: number } = {},
) => {
  const controller = new AbortController();
  const waits: number[] = [];
  const events: ClusterEvent[] = [];
  const cluster = createClusterModule(fakeChain().context(api));
  const iterable = cluster.watch(configHash, {
    signal: controller.signal,
    ...(options.intervalMs !== undefined
      ? { intervalMs: options.intervalMs }
      : {}),
    sleep: async ms => {
      waits.push(ms);
      if (
        options.abortAfter !== undefined &&
        waits.length >= options.abortAfter
      ) {
        controller.abort();
      }
    },
  });
  let error: ObolError | undefined;
  try {
    for await (const event of iterable) events.push(event);
  } catch (e) {
    error = e as ObolError;
  }
  return { events, waits, error };
};

describe('cluster.watch', () => {
  it('emits operator_signed per new operator, definition_ready, then lock_published', async () => {
    const api = sequence({
      [DEF]: [
        () => signedBy(1),
        () => signedBy(1),
        () => signedBy(3),
        () => signedBy(4),
      ],
      [LOCK]: [
        () => {
          throw apiError('API_NOT_FOUND', 404, LOCK);
        },
        () => lock,
      ],
    });
    const { events, waits, error } = await run(api);
    expect(error).toBeUndefined();
    const ops = definition.operators.map((o: any) => o.address);
    expect(events).toEqual([
      { type: 'operator_signed', address: ops[0], signed: 1, total: 4 },
      { type: 'operator_signed', address: ops[1], signed: 2, total: 4 },
      { type: 'operator_signed', address: ops[2], signed: 3, total: 4 },
      { type: 'operator_signed', address: ops[3], signed: 4, total: 4 },
      { type: 'definition_ready' },
      { type: 'lock_published', lockHash: lock.lock_hash },
    ]);
    expect(waits).toEqual([12_000, 12_000, 12_000, 12_000, 12_000]);
  });

  it('emits what is already true on the first poll', async () => {
    const api = sequence({ [DEF]: [() => definition], [LOCK]: [() => lock] });
    const { events, waits } = await run(api);
    expect(events.map(e => e.type)).toEqual([
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'operator_signed',
      'definition_ready',
      'lock_published',
    ]);
    expect(waits).toEqual([12_000]);
  });

  it('treats a solo definition as ready', async () => {
    const solo = copy(clusterLockSoloV1X10);
    const hash = solo.cluster_definition.config_hash;
    const api = sequence({
      [`/v1/definition/${hash}`]: [() => solo.cluster_definition],
      [`/v1/lock/configHash/${hash}`]: [() => solo],
    });
    const controller = new AbortController();
    const events: ClusterEvent[] = [];
    for await (const event of createClusterModule(
      fakeChain().context(api),
    ).watch(hash, { signal: controller.signal, sleep: async () => {} })) {
      events.push(event);
    }
    expect(events.map(e => e.type)).toEqual([
      'definition_ready',
      'lock_published',
    ]);
  });

  it('backs off on transient errors and returns to intervalMs after a success', async () => {
    const api = sequence({
      [DEF]: [
        () => {
          throw apiError('API_RATE_LIMIT', 429, DEF);
        },
        () => {
          throw apiError('API_ERROR', 503, DEF);
        },
        () => {
          throw apiError('API_TIMEOUT', 0, DEF);
        },
        () => signedBy(1),
        () => definition,
      ],
      [LOCK]: [() => lock],
    });
    const { waits, error } = await run(api, { intervalMs: 20_000 });
    expect(error).toBeUndefined();
    expect(waits).toEqual([40_000, 60_000, 60_000, 20_000, 20_000]);
  });

  it('throws after 5 transient failures in a row', async () => {
    const api = sequence({
      [DEF]: [
        () => {
          throw apiError('API_ERROR', 502, DEF);
        },
      ],
    });
    const { error, waits } = await run(api);
    expect(error?.code).toBe('API_ERROR');
    expect(waits).toEqual([24_000, 48_000, 60_000, 60_000]);
  });

  it('throws other API errors at once (404 on the definition)', async () => {
    const api = sequence({
      [DEF]: [
        () => {
          throw apiError('API_NOT_FOUND', 404, DEF);
        },
      ],
    });
    const { error, waits } = await run(api);
    expect(error?.code).toBe('API_NOT_FOUND');
    expect(waits).toEqual([]);
  });

  it('throws API_RESPONSE_MISMATCH for another definition', async () => {
    const api = sequence({
      [DEF]: [() => ({ ...definition, config_hash: `0x${'ab'.repeat(32)}` })],
    });
    expect((await run(api)).error?.code).toBe('API_RESPONSE_MISMATCH');
  });

  it('ends without an error on abort', async () => {
    const api = sequence({ [DEF]: [() => signedBy(2)] });
    const { events, error, waits } = await run(api, { abortAfter: 3 });
    expect(error).toBeUndefined();
    expect(events.map(e => e.type)).toEqual([
      'operator_signed',
      'operator_signed',
    ]);
    expect(waits).toHaveLength(3);
  });

  it('ends at once with an already aborted signal', async () => {
    const api = sequence({ [DEF]: [() => definition] });
    const controller = new AbortController();
    controller.abort();
    const events: ClusterEvent[] = [];
    for await (const event of createClusterModule(
      fakeChain().context(api),
    ).watch(configHash, { signal: controller.signal })) {
      events.push(event);
    }
    expect(events).toEqual([]);
    expect(api.calls).toHaveLength(0);
  });

  it('aborts the default sleep', async () => {
    const api = sequence({ [DEF]: [() => signedBy(1)] });
    const controller = new AbortController();
    const iterator = createClusterModule(fakeChain().context(api))
      .watch(configHash, { signal: controller.signal, intervalMs: 60_000 })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({
      type: 'operator_signed',
    });
    const pending = iterator.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it('validates its inputs when called', () => {
    const cluster = createClusterModule(fakeChain().context(fakeApi({})));
    const signal = new AbortController().signal;
    expect(() => cluster.watch('0x12' as Hex, { signal })).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
    expect(() =>
      cluster.watch(configHash, { signal, intervalMs: 1_999 }),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
    expect(() => cluster.watch(configHash, {} as any)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
    const offline = createClusterModule(fakeChain().context(null));
    expect(() => offline.watch(configHash, { signal })).toThrow(
      expect.objectContaining({ code: 'API_DISABLED' }),
    );
  });
});
