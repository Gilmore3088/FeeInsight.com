/**
 * A time budget for the database reads behind one public page render.
 *
 * When Supabase's transaction pooler has no free server connection it queues the client
 * ("No server connection available in postgres backend, client being queued") and the
 * query simply waits. Nothing in the page bounded that wait, so on Oct 18 every
 * institution page and the directory sat on the loading skeleton until Vercel killed the
 * function at 300 seconds; a response cut off mid-stream then showed "Application error:
 * a client-side exception has occurred" (#1919).
 *
 * A budget gives the whole render one deadline. A required read that misses it rejects with
 * ReadDeadlineError, so the page's error boundary answers within seconds. An optional read
 * that fails or misses it is logged and replaced by its fallback, so one slow section no
 * longer holds the page. The read itself is not cancelled; its late result is dropped.
 */

export class ReadDeadlineError extends Error {
  constructor(
    readonly label: string,
    readonly budgetMs: number,
  ) {
    super(`${label} read missed its ${budgetMs} ms deadline`);
    this.name = "ReadDeadlineError";
  }
}

export interface ReadBudget {
  /** Milliseconds left before the deadline (never negative). */
  remaining(): number;
  /** The read's value, or ReadDeadlineError once the budget runs out first. A read's own error passes through. */
  required<T>(read: Promise<T>, label: string): Promise<T>;
  /** The read's value, or `fallback` when it fails or the budget runs out first (both logged). */
  optional<T>(read: Promise<T>, label: string, fallback: T): Promise<T>;
}

/**
 * Starts the deadline now. `logPrefix` names the page in the log line, e.g.
 * "Institution page" logs "Institution page branch footprint failed: ...".
 */
export function createReadBudget(totalMs: number, logPrefix: string, now: () => number = Date.now): ReadBudget {
  const endsAt = now() + totalMs;
  const remaining = () => Math.max(0, endsAt - now());

  function required<T>(read: Promise<T>, label: string): Promise<T> {
    // A read that settles after the deadline must not surface as an unhandled rejection.
    read.catch(() => undefined);
    const left = remaining();
    if (left === 0) return Promise.reject(new ReadDeadlineError(label, totalMs));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadDeadlineError(label, totalMs)), left);
    });
    return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
  }

  function optional<T>(read: Promise<T>, label: string, fallback: T): Promise<T> {
    return required(read, label).catch((error: unknown) => {
      console.error(`${logPrefix} ${label} failed:`, error);
      return fallback;
    });
  }

  return { remaining, required, optional };
}
