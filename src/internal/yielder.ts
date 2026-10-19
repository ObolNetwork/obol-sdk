/**
 * Cooperative yielding for long pure-JS verification: `tick()` hands control
 * back to the event loop once half of `yieldMs` has passed since the last
 * yield, so with units of work shorter than the other half the thread is
 * never blocked for longer than `yieldMs`, and timers, I/O and rendering
 * keep running.
 */
export type Tick = () => Promise<void>;

const now = (): number => performance.now();

const yieldToEventLoop = async (): Promise<void> => {
  await new Promise<void>(resolve => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
};

/** A `tick` for blocks of at most about `yieldMs` (never yields for 0). */
export const createTick = (yieldMs: number): Tick => {
  if (yieldMs <= 0) return async () => {};
  const budget = yieldMs / 2;
  let last = now();
  return async () => {
    if (now() - last < budget) return;
    await yieldToEventLoop();
    last = now();
  };
};
