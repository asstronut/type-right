/**
 * Runs one Engine's check for a Field: debounced, one at a time, and held back
 * while blocked. It knows nothing of why it is blocked: the check says how long
 * to wait, and whoever learns the wait is over can lift it.
 */
export interface CheckScheduler {
  /** (Re)starts the wait before the next run; `debounceMs` unless given. */
  schedule(delayMs?: number): void;
  /** Holds runs back for `ms`, then runs again. */
  blockFor(ms: number): void;
  /** Ends a block early and runs at once; does nothing when not blocked. */
  unblock(): void;
  dispose(): void;
}

export interface CheckSchedulerOptions {
  debounceMs: number;
  /**
   * Whether the Engine may run at all, asked on every fire before any block's
   * wait; on false the fire ends without rescheduling.
   */
  mayRun(): boolean;
  run(): Promise<void>;
}

export function createCheckScheduler(options: CheckSchedulerOptions): CheckScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let blockedUntil = 0;
  let disposed = false;

  function schedule(delayMs = options.debounceMs): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void fire(), delayMs);
  }

  async function fire(): Promise<void> {
    timer = undefined;
    if (disposed || !options.mayRun()) return;
    const waitMs = blockedUntil - Date.now();
    if (waitMs > 0) return schedule(waitMs);
    if (running) return schedule();

    running = true;
    try {
      await options.run();
    } finally {
      running = false;
    }
  }

  return {
    schedule,
    blockFor(ms) {
      blockedUntil = Date.now() + ms;
      schedule(0);
    },
    unblock() {
      if (blockedUntil <= Date.now()) return;
      blockedUntil = 0;
      schedule(0);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
