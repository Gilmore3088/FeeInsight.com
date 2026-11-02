import { AsyncLocalStorage } from "node:async_hooks";
import { databasePoolMax } from "./pool-size";

/**
 * How many shared-cache recomputes one server runs against the database at once.
 *
 * A public read that is missing or stale is recomputed by the render that asks for it, and the
 * catalog-wide ones (the U.S. comparable index, the fee summaries, the fee-share cohort) take
 * 10-50 s under load. Each server has DATABASE_POOL_MAX connections (5). On Nov 2 at 16:10 UTC
 * a crawler burst met stale entries: every connection on a server held one of those
 * recomputes, so a page's own one-row reads (the institution itself, its rate fees) waited for
 * a connection, missed their 10-15 s deadlines and the pages failed with a 500
 * (findings/2026-11-02-cache-recomputes-starve-page-reads.md).
 *
 * Recomputes therefore take a lane, and there are two fewer lanes than connections, so a page's
 * own reads always find a free one. A recompute waiting for a lane holds no connection; a render
 * that already has a last good value for it stops waiting after STALE_GRACE_MS as before.
 */
export function recomputeLaneCount(poolMax: number = databasePoolMax()): number {
  return Math.max(1, poolMax - 2);
}

export interface Lanes {
  /** Run `work` once a lane is free. A call made from inside running work runs at once. */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Lanes in use and calls waiting, for tests and logs. */
  readonly busy: number;
  readonly waiting: number;
}

/**
 * Longest a recompute waits for a lane before it runs without one. A recompute holding a lane can
 * wait on another server-wide shared read that is itself queued for a lane; if every lane is held
 * that way, none would ever free. The cap turns that into a delay. Renders have stopped waiting
 * long before it (15 s budgets), so it only bounds how late the cache is refreshed.
 */
export const LANE_WAIT_MAX_MS = 60_000;

export function createLanes(count: number, waitMaxMs: number = LANE_WAIT_MAX_MS): Lanes {
  const inside = new AsyncLocalStorage<true>();
  const queue: Array<() => void> = [];
  let busy = 0;

  const release = () => {
    const next = queue.shift();
    if (next) next();
    else busy -= 1;
  };

  /** True when the call got a lane, false when it gave up waiting and runs without one. */
  const acquire = (): Promise<boolean> => {
    if (busy < count) {
      busy += 1;
      return Promise.resolve(true);
    }
    // The releasing call hands its lane straight to the next waiter, so busy stays the same.
    return new Promise<boolean>((resolve) => {
      const granted = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const at = queue.indexOf(granted);
        if (at >= 0) queue.splice(at, 1);
        resolve(false);
      }, waitMaxMs);
      queue.push(granted);
    });
  };

  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      // A recompute that reads another shared entry already holds a lane. Making the inner one
      // wait for a second lane could deadlock once every lane is held by an outer recompute.
      if (inside.getStore()) return work();
      const laned = await acquire();
      try {
        return await inside.run(true, work);
      } finally {
        if (laned) release();
      }
    },
    get busy() {
      return busy;
    },
    get waiting() {
      return queue.length;
    },
  };
}
