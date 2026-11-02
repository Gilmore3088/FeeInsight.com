/**
 * The one rule for which fees Hamilton may give the model (wiring audit, 2026-11-02): only fees a
 * customer can see on the site, which are the rows of `published_fee_catalog`. The view marks every
 * live row `review_status = 'approved'` and leaves out rolled-back, held and superseded rows, so a
 * row that reads anything else is not published and stays out. Fees read from a schedule but not
 * yet verified or published (the evidence preview the admin pages show) are never passed on, not
 * even labelled as provisional.
 */

/** What the tool output and the briefing say when an institution has no published fee. */
export const NO_PUBLISHED_FEES_NOTE = "No verified fees are published for this institution yet.";

/** The catalog rows that are published: approved, as every live `published_fee_catalog` row is. */
export function publishedCatalogFees<T extends { review_status?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.review_status === "approved");
}
