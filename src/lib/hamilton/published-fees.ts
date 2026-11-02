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

/**
 * An institution's fee status as the model may read it: built from its published fees alone. The
 * registry's own status, readiness and confidence summary count fees still under review
 * (`provisional_fee_count`), so they never reach a model or customer path; operators still see them.
 */
export interface PublishedFeeStatus {
  status: "verified" | "none_published";
  label: string;
  insight_readiness: "ready" | "no_published_fees";
  confidence_summary: string;
  verified_fee_count: number;
}

export function publishedFeeStatus(publishedFeeCount: number): PublishedFeeStatus {
  const count = Number.isFinite(publishedFeeCount) && publishedFeeCount > 0 ? Math.floor(publishedFeeCount) : 0;
  return count > 0
    ? { status: "verified", label: "Verified fees", insight_readiness: "ready",
        confidence_summary: "Verified fee evidence supports benchmark comparisons.", verified_fee_count: count }
    : { status: "none_published", label: "No published fees", insight_readiness: "no_published_fees",
        confidence_summary: NO_PUBLISHED_FEES_NOTE, verified_fee_count: 0 };
}

/** The evidence policy as the model reads it: fee amounts are always published fees. */
export function evidencePolicyForModel(policy: string): string {
  if (policy === "provisional-first") {
    return "published fees only; a thin benchmark sample is labelled directional with its sample size";
  }
  if (policy === "verified-only") return "published fees only, for benchmark and score conclusions";
  if (policy === "source-diligence") return "published fees only; say what evidence is missing before any benchmark finding";
  return "published fees only";
}
