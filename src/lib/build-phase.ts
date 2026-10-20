import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * How long a page's reads may run during `next build` before it renders its fallback. Well
 * under Next's 60-second per-page limit, so a busy database cannot fail a deploy, and long
 * enough that a healthy one still ships the live page (#1048).
 */
export const BUILD_READ_DEADLINE_MS = 15_000;

/**
 * All of one page's build-time reads together, for a page whose second read depends on its
 * first (/for-institutions' ladder needs the sample). Still well under the 60-second limit.
 */
export const BUILD_PAGE_BUDGET_MS = 30_000;

/** Starts a page's build budget; the returned function gives the milliseconds left of it. */
export function startBuildBudget(): () => number {
  const startedAt = Date.now();
  return () => Math.max(0, BUILD_PAGE_BUDGET_MS - (Date.now() - startedAt));
}

/**
 * True while `next build` prerenders pages. An ISR page is rendered once at build, and a
 * busy database then decided whether the deploy succeeded: queued reads held a render past
 * Next's 60-second page limit (findings/2026-10-20-isr-pages-build-time-db-reads.md).
 */
export function isNextBuild(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}

/**
 * The page's reads. On request they run as they always did, errors included. During
 * `next build` they race BUILD_READ_DEADLINE_MS: a read in time gives the live page; a read
 * that throws or runs late gives `whileBuilding`, the page's failed-read fallback, which
 * shortens its cache life (`shortenPageLife`) so the first request after the deploy
 * regenerates it. The losing read is left to settle on its own: its result and any later
 * error are dropped, and the render does not wait for it. `deadlineMs` lets a page's later read
 * use what is left of its page budget (`startBuildBudget`), capped at BUILD_READ_DEADLINE_MS.
 */
export async function readOnRequest<T>(
  read: () => Promise<T>,
  whileBuilding: NoInfer<T>,
  deadlineMs: number = BUILD_READ_DEADLINE_MS,
): Promise<T> {
  if (!isNextBuild()) return read();

  const waitMs = Math.max(0, Math.min(deadlineMs, BUILD_READ_DEADLINE_MS));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[build-phase] build-time read passed ${waitMs} ms; rendering the fallback`);
      resolve(whileBuilding);
    }, waitMs);
  });
  const attempt = Promise.resolve()
    .then(read)
    .catch((error: unknown) => {
      console.warn("[build-phase] build-time read failed; rendering the fallback", error);
      return whileBuilding;
    });

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
