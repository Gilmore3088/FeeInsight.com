import { sql } from "@/lib/data-store/connection";

export interface RosettaStatus {
  readableBacklog: number;
  completedTexts: number;
  completedToday: number;
  needsOcr: number;
  browserRenderBacklog: number;
  failedReads: number;
  totalTextArtifacts: number;
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

export async function getRosettaStatus(): Promise<RosettaStatus> {
  const fallback: RosettaStatus = {
    readableBacklog: 0,
    completedTexts: 0,
    completedToday: 0,
    needsOcr: 0,
    browserRenderBacklog: 0,
    failedReads: 0,
    totalTextArtifacts: 0,
  };

  try {
    const [row] = await sql`
      WITH readable_backlog AS (
        SELECT COUNT(*)::int AS count
          FROM source_documents doc
          JOIN institution_sources inst ON inst.id = doc.institution_id
          LEFT JOIN agent_source_texts text
            ON text.source_document_id = doc.id
           AND text.source_hash IS NOT DISTINCT FROM doc.content_hash
           AND text.status IN ('completed', 'empty', 'needs_ocr', 'skipped')
         WHERE doc.status = 'success'
           AND doc.document_url IS NOT NULL
           AND text.id IS NULL
           AND COALESCE(inst.document_type, '') NOT IN ('offline', 'no_website')
      ),
      text_counts AS (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (
            WHERE status = 'completed'
              AND updated_at >= date_trunc('day', NOW())
          )::int AS completed_today,
          COUNT(*) FILTER (WHERE status = 'needs_ocr')::int AS needs_ocr,
          COUNT(*) FILTER (WHERE status = 'empty' AND document_type = 'html')::int AS browser_render,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM agent_source_texts
      )
      SELECT
        readable_backlog.count AS readable_backlog,
        text_counts.total,
        text_counts.completed,
        text_counts.completed_today,
        text_counts.needs_ocr,
        text_counts.browser_render,
        text_counts.failed
      FROM readable_backlog
      CROSS JOIN text_counts
    `;

    return {
      readableBacklog: num(row?.readable_backlog),
      completedTexts: num(row?.completed),
      completedToday: num(row?.completed_today),
      needsOcr: num(row?.needs_ocr),
      browserRenderBacklog: num(row?.browser_render),
      failedReads: num(row?.failed),
      totalTextArtifacts: num(row?.total),
    };
  } catch (error) {
    console.error("getRosettaStatus failed:", error);
    return fallback;
  }
}
