import { unstable_cache } from "next/cache";
import { getSql } from "./connection";
import type { ReportType } from "@/lib/report-engine/types";

/** Invalidated when a report is published (admin/hamilton/actions.ts). */
export const PUBLISHED_REPORTS_TAG = "published-reports";

export interface PublicReportRow {
  id: string;
  report_type: ReportType;
  slug: string;
  title: string;
  /** ISO timestamp; a string so the row survives the cache's JSON round trip. */
  published_at: string;
}

/** The 100 most recent public reports, newest first. Throws when the database does. */
export async function getPublicReportCatalog(): Promise<PublicReportRow[]> {
  const sql = getSql();
  const rows = await sql<Array<{ id: unknown; report_type: ReportType; slug: string; title: string; published_at: unknown }>>`
    SELECT id, report_type, slug, title, published_at
    FROM published_reports
    WHERE is_public = true
    ORDER BY published_at DESC
    LIMIT 100
  `;
  return rows.map((r) => ({
    id: String(r.id),
    report_type: r.report_type,
    slug: r.slug,
    title: r.title,
    published_at: r.published_at instanceof Date ? r.published_at.toISOString() : String(r.published_at),
  }));
}

/** The `?type=` and `?range=` filters, applied to the cached catalog instead of a fresh query. */
export function filterReportCatalog(
  rows: PublicReportRow[],
  typeFilter: string | null,
  fromIso: string | null,
): PublicReportRow[] {
  const from = fromIso ? Date.parse(fromIso) : null;
  return rows.filter(
    (r) => (!typeFilter || r.report_type === typeFilter) && (from === null || Date.parse(r.published_at) >= from),
  );
}

const cachedCatalog = unstable_cache(getPublicReportCatalog, ["published-report-catalog-v1"], {
  tags: [PUBLISHED_REPORTS_TAG],
  revalidate: 3600,
});

/**
 * The /reports catalog through Next's data cache (#1953). The page used to query the database
 * on every visit with a 2.5 s deadline, and on a slow pool the deadline fired and printed an
 * error. An empty catalog is cached too (it is the normal state until a report is published);
 * a failed read throws and is never cached.
 */
export async function getPublicReportCatalogCached(): Promise<PublicReportRow[]> {
  try {
    return await cachedCatalog();
  } catch (error) {
    // Outside a Next request (tests, scripts) there is no incremental cache; read directly.
    if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) {
      return getPublicReportCatalog();
    }
    throw error;
  }
}
