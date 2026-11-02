import { AsyncLocalStorage } from "node:async_hooks";
import { databasePoolMax } from "./pool-size";

/**
 * How many catalog-wide shared-cache recomputes one server runs against the database at once.
 *
 * A public read that is missing or stale is recomputed by the render that asks for it, and the
 * catalog-wide ones (the U.S. comparable index, the fee summaries, the fee-share cohort) take
 * 10-50 s under load. Each server has DATABASE_POOL_MAX connections (5). On Nov 2 at 16:10 UTC
 * a crawler burst met stale entries: every connection on a server held one of those
 * recomputes, so a page's own one-row reads (the institution itself, its rate fees) waited for
 * a connection, missed their 10-15 s deadlines and the pages failed with a 500
 * (findings/2026-11-02-cache-recomputes-starve-page-reads.md).
 *
 * Reads marked catalog-wide therefore take a lane, and there are two fewer lanes than
 * connections. A lane counts recomputes, not connections: the marked reads each run one query
 * at a time, so they hold at most that many connections between them. A recompute waiting for a
 * lane holds no connection; a render that already has a last good value stops waiting after
 * STALE_GRACE_MS as before.
 */
export function recomputeLaneCount(poolMax: number = databasePoolMax()): number {
  return Math.max(1, poolMax - 2);
}

/**
 * Longest a recompute waits for a lane. By then every render that asked for it has stopped
 * waiting (15 s budgets), so the recompute is dropped rather than run without a lane, which would
 * put back the pile-up the lanes prevent; the next request asks again.
 */
export const LANE_WAIT_MAX_MS = 60_000;

export class LaneWaitExceeded extends Error {
  constructor(readonly waitedMs: number) {
    super(`recompute dropped: no lane free within ${waitedMs} ms`);
    this.name = "LaneWaitExceeded";
  }
}

export interface LaneRun<T> {
  readonly result: Promise<T>;
  /** Start the work now, without a lane, if it is still waiting for one. No effect otherwise. */
  promote(): void;
}

export interface Lanes {
  /**
   * Run `work` once a lane is free. A call made from inside running work runs at once: it is
   * part of work that already holds a lane.
   */
  start<T>(work: () => Promise<T>): LaneRun<T>;
  run<T>(work: () => Promise<T>): Promise<T>;
  /** True inside work that holds a lane (or was promoted to run without one). */
  inside(): boolean;
  /** Lanes in use and calls waiting, for tests and logs. */
  readonly busy: number;
  readonly waiting: number;
}

export function createLanes(count: number, waitMaxMs: number = LANE_WAIT_MAX_MS): Lanes {
  const insideStore = new AsyncLocalStorage<true>();
  const queue: Array<() => void> = [];
  let busy = 0;

  const release = () => {
    const next = queue.shift();
    if (next) next();
    else busy -= 1;
  };

  const start = <T>(work: () => Promise<T>): LaneRun<T> => {
    if (insideStore.getStore()) return { result: work(), promote: () => {} };
    if (busy < count) {
      busy += 1;
      const result = (async () => {
        try {
          return await insideStore.run(true, work);
        } finally {
          release();
        }
      })();
      return { result, promote: () => {} };
    }

    // Queued. Exactly one of three things settles it: a lane is handed over (granted), a caller
    // that holds a lane needs the result and promotes it, or the wait cap drops it.
    let settled = false;
    let promote: () => void = () => {};
    const result = new Promise<T>((resolve, reject) => {
      const runWith = (laned: boolean) => {
        insideStore.run(true, work).then(resolve, reject).finally(() => {
          if (laned) release();
        });
      };
      const leaveQueue = () => {
        const at = queue.indexOf(granted);
        if (at >= 0) queue.splice(at, 1);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        leaveQueue();
        reject(new LaneWaitExceeded(waitMaxMs));
      }, waitMaxMs);
      function granted() {
        if (settled) {
          // Cannot happen (a settled waiter has left the queue); hand the lane on regardless.
          release();
          return;
        }
        settled = true;
        clearTimeout(timer);
        runWith(true);
      }
      promote = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        leaveQueue();
        runWith(false);
      };
      queue.push(granted);
    });
    return { result, promote: () => promote() };
  };

  return {
    start,
    run: (work) => start(work).result,
    inside: () => insideStore.getStore() === true,
    get busy() {
      return busy;
    },
    get waiting() {
      return queue.length;
    },
  };
}
