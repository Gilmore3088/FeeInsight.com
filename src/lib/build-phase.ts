import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * True while `next build` prerenders pages. An ISR page is rendered once at build, and a
 * busy database then decided whether the deploy succeeded: queued reads held a render past
 * Next's 60-second page limit (findings/2026-10-20-sitemap-build-time-db-reads.md).
 */
export function isNextBuild(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}

/**
 * The page's reads on request; `whileBuilding` during `next build`, without touching the database.
 * The build copy is the page's failed-read fallback, so the page shortens its cache life
 * (`shortenPageLife`) and the first request after deploy regenerates it from the cached public
 * reads in the background, as ISR does for any stale page.
 */
export async function readOnRequest<T>(read: () => Promise<T>, whileBuilding: NoInfer<T>): Promise<T> {
  return isNextBuild() ? whileBuilding : read();
}
