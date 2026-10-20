import { cache } from "react";
import { getSql } from "@/lib/data-store/connection";

/** One public report, as the landing page shows it. `artifact_key` never reaches the client (T-16-06). */
export interface PublicReportRow {
  id: string;
  job_id: string;
  report_type: string;
  slug: string;
  title: string;
  published_at: string;
  is_public: boolean;
  artifact_key: string | null;
}

/**
 * The public report for a slug, or null when there is none; read once per request and shared by
 * the layout (404 check), the metadata and the page (#1495). A failed read throws (500), never
 * null, so a database blip is not cached as a 404 for the hour this route keeps its pages.
 */
export const loadPublicReport = cache(async (slug: string): Promise<PublicReportRow | null> => {
  const sql = getSql();
  const rows = await sql<PublicReportRow[]>`
    SELECT
      pr.id,
      pr.job_id,
      pr.report_type,
      pr.slug,
      pr.title,
      pr.published_at,
      pr.is_public,
      rj.artifact_key
    FROM published_reports pr
    JOIN report_jobs rj ON pr.job_id = rj.id
    WHERE pr.slug = ${slug}
      AND pr.is_public = true
    LIMIT 1
  `;
  return rows[0] ?? null;
});
