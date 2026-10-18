import type { Metadata } from "next";

/**
 * One deadline for every database read in an institution page render (#1919). A saturated
 * connection pool used to hold the page on its loading skeleton until the function was killed
 * at 300 seconds. Now the core reads (the institution and its fees) answer within this budget
 * or the page's error boundary shows, and every other section drops out instead of waiting.
 */
export const PAGE_READ_BUDGET_MS = 15_000;

/** The layout's existence check runs before anything streams; past this the error boundary answers. */
export const LAYOUT_READ_BUDGET_MS = 10_000;

/** Metadata renders before the page; it gets less time and falls back to a plain title. */
export const METADATA_READ_BUDGET_MS = 8_000;

/** The metadata used while the database cannot answer; kept out of the index until a full render. */
export function degradedMetadata(instId: number): Metadata {
  return {
    robots: { index: false, follow: true },
    alternates: { canonical: `/institution/${instId}` },
    title: "Bank and credit union fees",
  };
}
