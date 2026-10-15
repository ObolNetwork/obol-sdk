import { ClusterProgressTimeoutError } from './errors.js';
import {
  type ClusterDefinition,
  type ClusterLock,
  type ClusterOperator,
  type ClusterProgress,
  type ClusterProgressStep,
  type WaitForOptions,
  type WatchClusterOptions,
} from './types.js';

export const DEFAULT_WATCH_INTERVAL_MS = 2000;
export const DEFAULT_WATCH_MAX_INTERVAL_MS = 30000;
const BACKOFF_FACTOR = 1.5;

/** Fetchers and timer used by {@link watchClusterProgress}. */
export type ClusterProgressSource = {
  getDefinition: (signal?: AbortSignal) => Promise<ClusterDefinition>;
  /** Resolves `null` while no lock exists yet. */
  getLock: (signal?: AbortSignal) => Promise<ClusterLock | null>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('The operation was aborted');

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortReason(signal);
};

/** setTimeout-based sleep that rejects with `signal.reason` on abort. */
export const abortableSleep = async (
  ms: number,
  signal?: AbortSignal,
): Promise<void> => {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/**
 * HTTP status of an error thrown by `Base.request`, which throws the parsed
 * response body (NestJS bodies carry `statusCode`) or a typed error with
 * `status`. Returns undefined for network and parse errors.
 */
export const errorStatus = (e: unknown): number | undefined => {
  if (e === null || typeof e !== 'object') return undefined;
  const err = e as Record<string, any>;
  const status = err.status ?? err.statusCode ?? err.response?.status;
  return typeof status === 'number' ? status : undefined;
};

/** Network errors, 408, 429 and 5xx are worth retrying; other 4xx are not. */
export const isTransientError = (e: unknown): boolean => {
  const status = errorStatus(e);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
};

const hasOperatorSigned = (operator: ClusterOperator): boolean =>
  !!(
    operator.address &&
    operator.enr &&
    operator.enr_signature &&
    operator.config_signature
  );

/**
 * Derives the signing progress of a definition. Definitions with a
 * `definition_hash`, or without operator addresses (solo and Charon-created
 * definitions), have nothing left to sign.
 */
export const definitionProgress = (
  definition: ClusterDefinition,
): ClusterProgress => {
  const operators = definition.operators ?? [];
  const nothingToSign = operators.every(operator => !operator.address);
  const pending = operators
    .filter(operator => !hasOperatorSigned(operator))
    .map(operator => operator.address);

  if (definition.definition_hash || nothingToSign || pending.length === 0) {
    return { step: 'definition_ready', definition };
  }
  return {
    step: 'awaiting_signatures',
    signed: operators.length - pending.length,
    total: operators.length,
    pending,
    definition,
  };
};

const progressKey = (progress: ClusterProgress): string =>
  progress.step === 'awaiting_signatures'
    ? `${progress.step}:${progress.signed}`
    : progress.step;

const resolveIntervals = (
  options: WatchClusterOptions,
): { intervalMs: number; maxIntervalMs: number } => {
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_WATCH_MAX_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('intervalMs must be a positive number');
  }
  if (!Number.isFinite(maxIntervalMs) || maxIntervalMs <= 0) {
    throw new Error('maxIntervalMs must be a positive number');
  }
  return { intervalMs, maxIntervalMs: Math.max(intervalMs, maxIntervalMs) };
};

/**
 * Polls a cluster definition, then its lock, yielding the initial state and
 * every change. Ends after `lock_published`.
 */
// eslint-disable-next-line generator-star-spacing -- prettier formats generators as `function*`
export async function* watchClusterProgress(
  source: ClusterProgressSource,
  options: WatchClusterOptions = {},
): AsyncGenerator<ClusterProgress, void, undefined> {
  const { signal } = options;
  const { intervalMs, maxIntervalMs } = resolveIntervals(options);
  const sleep = source.sleep ?? abortableSleep;

  // Runs one request; transient failures resolve undefined so the loop retries.
  const attempt = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ value: T } | undefined> => {
    try {
      return { value: await fn() };
    } catch (e) {
      throwIfAborted(signal);
      if (!isTransientError(e)) throw e;
      return undefined;
    }
  };

  let delay = intervalMs;
  let lastKey: string | undefined;
  let definitionReady = false;

  while (true) {
    throwIfAborted(signal);
    let changed = false;

    if (!definitionReady) {
      const result = await attempt(
        async () => await source.getDefinition(signal),
      );
      if (result !== undefined) {
        const progress = definitionProgress(result.value);
        definitionReady = progress.step === 'definition_ready';
        if (progressKey(progress) !== lastKey) {
          lastKey = progressKey(progress);
          changed = true;
          yield progress;
          throwIfAborted(signal);
        }
      }
    }

    if (definitionReady) {
      const result = await attempt(async () => await source.getLock(signal));
      if (result?.value) {
        const lock = result.value;
        yield { step: 'lock_published', lockHash: lock.lock_hash, lock };
        return;
      }
    }

    delay = changed
      ? intervalMs
      : Math.min(delay * BACKOFF_FACTOR, maxIntervalMs);
    await sleep(delay, signal);
  }
}

/**
 * Consumes `watch` until it yields `target`, honouring `timeoutMs` and the
 * caller's `signal`.
 */
export const waitForClusterProgress = async <
  T extends Exclude<ClusterProgressStep, 'awaiting_signatures'>,
>(
  watch: (signal: AbortSignal) => AsyncGenerator<ClusterProgress>,
  target: T,
  options: Pick<WaitForOptions, 'signal' | 'onProgress' | 'timeoutMs'> = {},
): Promise<Extract<ClusterProgress, { step: T }>> => {
  const { signal, onProgress, timeoutMs } = options;
  if (target !== 'definition_ready' && target !== 'lock_published') {
    throw new Error(`Unknown target step: ${String(target)}`);
  }
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  ) {
    throw new Error('timeoutMs must be a non-negative number');
  }
  throwIfAborted(signal);

  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort(abortReason(signal as AbortSignal));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  // 0 means no timeout, as for the Client's request `timeoutMs`.
  const timer =
    timeoutMs === undefined || timeoutMs === 0
      ? undefined
      : setTimeout(() => {
          controller.abort(new ClusterProgressTimeoutError(target, timeoutMs));
        }, timeoutMs);

  try {
    for await (const progress of watch(controller.signal)) {
      onProgress?.(progress);
      if (progress.step === target) {
        return progress as Extract<ClusterProgress, { step: T }>;
      }
    }
    throw new Error(`Cluster progress ended before reaching '${target}'`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};
