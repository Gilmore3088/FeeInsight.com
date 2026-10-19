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
 * longer holds the page. Lazy reads never start after the deadline. A request adapter may
 * retain already-started abandoned work so its client protocol can finish; nothing is cancelled.
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
  required<T>(read: ReadOperation<T>, label: string): Promise<T>;
  /** The read's value, or `fallback` when it fails or the budget runs out first (both logged). */
  optional<T>(read: ReadOperation<T>, label: string, fallback: T): Promise<T>;
  /** Whether any optional read fell back, so a cached page can expire early (shortenPageLife). */
  failed(): boolean;
}

export type ReadOperation<T> = Promise<T> | (() => Promise<T>);
export type OnAbandonedRead = (read: Promise<unknown>, label: string) => void;

/**
 * Starts the deadline now. `logPrefix` names the page in the log line, e.g.
 * "Institution page" logs "Institution page branch footprint failed: ...".
 */
export function createReadBudget(totalMs: number, logPrefix: string, now: () => number = Date.now,
  onAbandoned?: OnAbandonedRead): ReadBudget {
  const endsAt = now() + totalMs;
  const remaining = () => Math.max(0, endsAt - now());
  let fellBack = false;
  const abandoned = new WeakSet<Promise<unknown>>();

  function required<T>(operation: ReadOperation<T>, label: string): Promise<T> {
    if (typeof operation === "function" && remaining() === 0)
      return Promise.reject(new ReadDeadlineError(label, totalMs));
    let read: Promise<T>;
    try { read = typeof operation === "function" ? operation() : operation; }
    catch (error) { return Promise.reject(error); }
    // A read that settles after the deadline must not surface as an unhandled rejection.
    let settled = false;
    void read.then(() => { settled = true; }, () => { settled = true; });
    const retain = () => {
      if (settled || abandoned.has(read) || !onAbandoned) return;
      abandoned.add(read);
      try { onAbandoned(read, label); }
      catch (error) { console.error(`${logPrefix} ${label} abandoned read retention failed:`, error); }
    };
    const deadlineFailed = (error: unknown): never => {
      if (error instanceof ReadDeadlineError) retain();
      throw error;
    };
    const left = remaining();
    if (left === 0) return Promise.reject(new ReadDeadlineError(label, totalMs)).catch(deadlineFailed);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ReadDeadlineError(label, totalMs)), left);
    });
    return Promise.race([read, deadline]).catch(deadlineFailed).finally(() => clearTimeout(timer));
  }

  function optional<T>(read: ReadOperation<T>, label: string, fallback: T): Promise<T> {
    return required(read, label).catch((error: unknown) => {
      console.error(`${logPrefix} ${label} failed:`, error);
      fellBack = true;
      return fallback;
    });
  }

  return { remaining, required, optional, failed: () => fellBack };
}
