// chainUtils.scanLogs against RPCs that cap eth_getLogs: by block range
// (10,000) or by the number of results. The window starts at
// LOG_CHUNK_START, doubles after each round that works up to LOG_CHUNK_SIZE,
// halves on a refusal and never grows back to a refused size; it is
// remembered per client. A genuine failure still rejects.
import type { Address, Hex } from 'viem';
import {
  isLogRangeError,
  LOG_CHUNK_CONCURRENCY,
  LOG_CHUNK_FLOOR,
  LOG_CHUNK_SIZE,
  LOG_CHUNK_START,
  scanLogs,
} from '../../src/chainUtils.js';
import { fakeChain, type FakeLog } from '../helpers/fakeChain.js';

const CONTRACT = '0x00000000000000000000000000000000000c0de0' as Address;
const TOPIC = `0x${'ab'.repeat(32)}` as Hex;
const log = (blockNumber: bigint): FakeLog => ({
  address: CONTRACT,
  topics: [TOPIC],
  data: '0x',
  blockNumber,
});

const rangeError = (message: string, code: number): Error =>
  Object.assign(new Error(message), { code });

/** A fake chain whose eth_getLogs enforces `cap` (blocks) and/or `maxResults`. */
const capped = (
  logs: FakeLog[],
  limits: { cap?: bigint; maxResults?: number; failAt?: bigint },
) => {
  const ranges: Array<[bigint, bigint]> = [];
  const chain = fakeChain({
    logs,
    getLogsError: filter => {
      const from = BigInt(filter.fromBlock);
      const to = BigInt(filter.toBlock);
      ranges.push([from, to]);
      if (
        limits.failAt !== undefined &&
        from <= limits.failAt &&
        limits.failAt <= to
      ) {
        return new Error('internal error');
      }
      if (limits.cap !== undefined && to - from + 1n > limits.cap) {
        return rangeError(`exceed maximum block range: ${limits.cap}`, -32602);
      }
      const n = logs.filter(
        l => l.blockNumber >= from && l.blockNumber <= to,
      ).length;
      if (limits.maxResults !== undefined && n > limits.maxResults) {
        return rangeError(
          `query returned more than ${limits.maxResults} results`,
          -32005,
        );
      }
      return undefined;
    },
  });
  return { client: chain.context().publicClient, ranges };
};

const filter = { address: CONTRACT, topics: [TOPIC] };

describe('scanLogs', () => {
  it('halves the window under a 10,000-block cap, finds every log, and remembers the size', async () => {
    const logs = [log(1_000_100n), log(1_150_000n), log(1_199_999n)];
    const { client, ranges } = capped(logs, { cap: 10_000n });
    const found = await scanLogs(client, filter, 1_000_000n, 1_200_000n);
    expect(found.map(l => l.blockNumber)).toEqual(logs.map(l => l.blockNumber));
    const refused = ranges.filter(([a, b]) => b - a + 1n > 10_000n).length;
    expect(refused).toBeGreaterThan(0);
    // A second scan starts at the size that worked: no refused range.
    ranges.length = 0;
    await scanLogs(client, filter, 1_000_000n, 1_200_000n);
    expect(ranges.every(([a, b]) => b - a + 1n <= 10_000n)).toBe(true);
  });

  it('splits a range whose answer has too many results', async () => {
    const logs = Array.from({ length: 30 }, (_, i) =>
      log(1_000_000n + BigInt(i) * 1_000n),
    );
    const { client } = capped(logs, { maxResults: 10 });
    const found = await scanLogs(client, filter, 1_000_000n, 1_049_999n);
    expect(found).toHaveLength(30);
  });

  it('stopOnFirst reads newest first and stops at the first range with a log', async () => {
    const { client, ranges } = capped([log(1_000_500n), log(1_995_000n)], {});
    const found = await scanLogs(client, filter, 1_000_000n, 2_000_000n, true);
    expect(found.map(l => l.blockNumber)).toEqual([1_995_000n]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0][1]).toBe(2_000_000n);
  });

  it('starts small and grows to the largest window on an uncapped RPC', async () => {
    const { client, ranges } = capped([], {});
    await scanLogs(client, filter, 1_000_000n, 2_000_000n);
    const sizes = ranges.map(([a, b]) => b - a + 1n);
    expect(sizes[0]).toBe(LOG_CHUNK_START);
    expect(sizes).toContain(LOG_CHUNK_SIZE);
    expect(sizes.every(n => n <= LOG_CHUNK_SIZE)).toBe(true);
  });

  it('pays a slow refusal about once per client, then never grows back to it', async () => {
    const { client, ranges } = capped([log(1_000_100n)], { cap: 15_000n });
    const refusedIn = async (): Promise<number> => {
      ranges.length = 0;
      await scanLogs(client, filter, 1_000_000n, 1_500_000n);
      return ranges.filter(([a, b]) => b - a + 1n > 15_000n).length;
    };
    // One round grows to 20,000 and is refused, at most once per concurrent range.
    expect(await refusedIn()).toBeLessThanOrEqual(LOG_CHUNK_CONCURRENCY);
    expect(await refusedIn()).toBe(0);
  });

  it('rejects a genuine failure (never a partial scan)', async () => {
    const { client } = capped([log(1_000_100n)], { failAt: 1_100_000n });
    await expect(
      scanLogs(client, filter, 1_000_000n, 1_200_000n),
    ).rejects.toThrow();
  });

  it('gives up below the floor', async () => {
    const { client } = capped([log(1_000_100n)], { cap: LOG_CHUNK_FLOOR - 1n });
    await expect(
      scanLogs(client, filter, 1_000_000n, 1_100_000n),
    ).rejects.toThrow();
  });

  it('recognises the common refusals', () => {
    expect(isLogRangeError(rangeError('block range too large', -32600))).toBe(
      true,
    );
    expect(isLogRangeError(rangeError('limit exceeded', -32005))).toBe(true);
    expect(isLogRangeError({ status: 413, message: 'Payload Too Large' })).toBe(
      true,
    );
    expect(
      isLogRangeError({
        message: 'wrapped',
        cause: rangeError('ranges over 10000 blocks are not supported', 35),
      }),
    ).toBe(true);
    // eRPC
    expect(
      isLogRangeError(
        rangeError('getLogs request exceeded max allowed range', -32012),
      ),
    ).toBe(true);
    expect(
      isLogRangeError(
        rangeError('Archive requests require a personal token', -32602),
      ),
    ).toBe(false);
    expect(isLogRangeError(new Error('fetch failed'))).toBe(false);
  });
});
