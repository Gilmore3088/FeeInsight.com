import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * How long a page's reads may run during `next build` before it renders its fallback. Well
 * under Next's 60-second per-page limit, so a busy database cannot fail a deploy, and long
 * enough that a healthy one still ships the live page (#1048).
 */
export const BUILD_READ_DEADLINE_MS = 15_000;

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
 * error are dropped, and the render does not wait for it.
 */
export async function readOnRequest<T>(read: () => Promise<T>, whileBuilding: NoInfer<T>): Promise<T> {
  if (!isNextBuild()) return read();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[build-phase] build-time read passed ${BUILD_READ_DEADLINE_MS} ms; rendering the fallback`);
      resolve(whileBuilding);
    }, BUILD_READ_DEADLINE_MS);
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
