/**
 * Cooperative yielding for long pure-JS verification: `tick()` hands control
 * back to the event loop once half of `yieldMs` has passed since the last
 * yield, so with units of work shorter than the other half the thread is
 * never blocked for longer than `yieldMs`, and timers, I/O and rendering
 * keep running.
 */
import { ObolError, isObolError } from '../errors.js';
import { invalid } from '../schema.js';

export type Tick = () => Promise<void>;

const now = (): number => performance.now();

const yieldToEventLoop = async (): Promise<void> => {
  await new Promise<void>(resolve => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
};

/** PAYLOAD_INVALID unless `signal` is absent or an AbortSignal-like object. */
export const assertSignal = (signal: unknown, path: string): void => {
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof (signal as { aborted?: unknown }).aborted !== 'boolean')
  ) {
    throw invalid(path, 'must be an AbortSignal');
  }
};

/** ABORTED for `operation`, with the signal's reason as `cause`. */
const aborted = (signal: AbortSignal, operation: string): ObolError =>
  new ObolError('ABORTED', `${operation} was aborted`, {
    hint: 'The signal passed in options was aborted (a deadline, or the request went away)',
    details: { operation },
    cause: signal.reason,
  });

/** ABORTED when `signal` is already aborted. */
export const throwIfAborted = (
  signal: AbortSignal | undefined,
  operation: string,
): void => {
  if (signal?.aborted === true) throw aborted(signal, operation);
};

/** Rethrows an ABORTED error (for code that turns other errors into results). */
export const rethrowAborted = (error: unknown): void => {
  if (isObolError(error, 'ABORTED')) throw error;
};

/**
 * A `tick` for blocks of at most about `yieldMs` (never yields for 0). With
 * `signal`, every call (and so every yield point) throws ABORTED once it is
 * aborted.
 */
export const createTick = (
  yieldMs: number,
  signal?: AbortSignal,
  operation = 'The verification',
): Tick => {
  const check = (): void => {
    throwIfAborted(signal, operation);
  };
  if (yieldMs <= 0) {
    return async () => {
      check();
    };
  }
  const budget = yieldMs / 2;
  let last = now();
  return async () => {
    check();
    if (now() - last < budget) return;
    await yieldToEventLoop();
    last = now();
    check();
  };
};
