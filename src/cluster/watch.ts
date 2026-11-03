/**
 * cluster.watch: polls the Obol API and yields the cluster lifecycle events
 * (spec/lifecycles.md "Cluster"). An API stream may replace the polling
 * later without changing the events.
 */
import type { Address, Hex } from 'viem';
import type { ClusterDefinition as LegacyDefinition } from '../internal/types.js';
import { definitionFlow } from '../internal/definitionFlow.js';
import type { ObolApi } from '../api.js';
import { requireApi, type Context } from '../context.js';
import { isObolError, ObolApiError } from '../errors.js';
import { checksum, decode, invalid, T } from '../schema.js';
import { fetchDefinition, fetchLockByConfigHash } from './api.js';
import type { ClusterDefinition } from './schema.js';

export type ClusterEvent =
  | { type: 'operator_signed'; address: Address; signed: number; total: number }
  | { type: 'definition_ready' }
  | { type: 'lock_published'; lockHash: Hex };

export interface WatchOptions {
  signal: AbortSignal;
  /** Poll interval in ms; default 12,000, minimum 2,000. */
  intervalMs?: number;
  /** @internal Replaces the timer (tests). Must reject or resolve when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_WATCH_INTERVAL_MS = 12_000;
export const MIN_WATCH_INTERVAL_MS = 2_000;
export const MAX_WATCH_BACKOFF_MS = 60_000;
export const MAX_WATCH_FAILURES = 5;

const defaultSleep = async (ms: number, signal: AbortSignal): Promise<void> => {
  await new Promise<void>(resolve => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
};

/** Rate limits, timeouts and 5xx are retried with backoff; anything else is thrown. */
const isTransient = (error: unknown): boolean =>
  error instanceof ObolApiError &&
  (error.code === 'API_RATE_LIMIT' ||
    error.code === 'API_TIMEOUT' ||
    error.status >= 500);

const signedOperators = (definition: ClusterDefinition): string[] =>
  (definition.operators ?? [])
    .filter(
      o =>
        typeof o.address === 'string' &&
        o.address !== '' &&
        typeof o.config_signature === 'string' &&
        o.config_signature !== '' &&
        typeof o.enr_signature === 'string' &&
        o.enr_signature !== '',
    )
    .map(o => (o.address as string).toLowerCase());

/** Group (every operator signed), solo and Charon definitions are ready for the DKG. */
const isReady = (definition: ClusterDefinition): boolean =>
  definitionFlow(definition as unknown as LegacyDefinition) !== null;

// eslint-disable-next-line generator-star-spacing -- prettier's spacing
async function* poll(
  api: ObolApi,
  configHash: string,
  options: WatchOptions,
  intervalMs: number,
): AsyncGenerator<ClusterEvent> {
  const { signal } = options;
  const sleep = options.sleep ?? defaultSleep;
  const seen = new Set<string>();
  let wait = intervalMs;
  let failures = 0;
  let phase: 'definition' | 'lock' = 'definition';

  while (!signal.aborted) {
    try {
      if (phase === 'definition') {
        const definition = await fetchDefinition(api, configHash, { signal });
        const total = (definition.operators ?? []).length;
        for (const address of signedOperators(definition)) {
          if (seen.has(address)) continue;
          seen.add(address);
          yield {
            type: 'operator_signed',
            address: checksum(address),
            signed: seen.size,
            total,
          };
        }
        if (isReady(definition)) {
          yield { type: 'definition_ready' };
          phase = 'lock';
        }
      } else {
        try {
          const lock = await fetchLockByConfigHash(api, configHash, { signal });
          yield {
            type: 'lock_published',
            lockHash: lock.lock_hash.toLowerCase() as Hex,
          };
          return;
        } catch (error) {
          if (!isObolError(error, 'API_NOT_FOUND')) throw error;
        }
      }
      failures = 0;
      wait = intervalMs;
    } catch (error) {
      if (signal.aborted) return;
      if (!isTransient(error)) throw error;
      failures += 1;
      if (failures >= MAX_WATCH_FAILURES) throw error;
      wait = Math.min(wait * 2, MAX_WATCH_BACKOFF_MS);
    }
    if (signal.aborted) return;
    try {
      await sleep(wait, signal);
    } catch {
      return;
    }
  }
}

/**
 * Watches a cluster until its lock is published. Yields `operator_signed`
 * once per newly signed operator, `definition_ready` once when every
 * operator signed (or for solo / Charon definitions), then
 * `lock_published` and ends. Events already true on the first poll are
 * still yielded.
 *
 * Polls every `intervalMs` (default 12,000, minimum 2,000). After a rate
 * limit, timeout or 5xx the wait doubles up to 60,000 and returns to
 * `intervalMs` after a success; the error is thrown after 5 failures in a
 * row. Other API errors are thrown from the iterator. Aborting `signal` ends
 * the iteration without an error.
 *
 * @throws PAYLOAD_INVALID, API_DISABLED (when called), API_* and
 *   API_RESPONSE_MISMATCH (from the iterator).
 */
export const watch = (
  ctx: Context,
  configHash: string,
  options: WatchOptions,
): AsyncIterable<ClusterEvent> => {
  const hash = decode(T.Hash32, configHash, 'configHash') as Hex;
  if (!(options?.signal instanceof AbortSignal)) {
    throw invalid('signal', 'must be an AbortSignal');
  }
  const intervalMs = decode(
    T.Uint,
    options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS,
    'intervalMs',
  );
  if (intervalMs < MIN_WATCH_INTERVAL_MS) {
    throw invalid('intervalMs', `must be at least ${MIN_WATCH_INTERVAL_MS}`);
  }
  const api = requireApi(ctx, 'cluster.watch');
  return poll(api, hash, options, intervalMs);
};
