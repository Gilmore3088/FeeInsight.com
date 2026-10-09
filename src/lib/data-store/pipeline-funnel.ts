import { sql } from "./connection";

/**
 * The fee-data funnel, universe to published, as the Atlas overview shows it.
 * Read-only counts over the semantic tables (same definitions as the 2026-09-30
 * pipeline audit, Appendix A).
 */
export interface PipelineFunnel {
  institutions: number;
  withFeeUrl: number;
  documentsFetched: number;
  textsRead: number;
  rawExtracted: number;
  verified: number;
  publishedRows: number;
  /** Institutions with any live fee in published_fee_catalog. */
  publishedInstitutions: number;
  /** Institutions with at least one live fee that carries a source_url. */
  sourcedInstitutions: number;
}

export const EMPTY_PIPELINE_FUNNEL: PipelineFunnel = {
  institutions: 0,
  withFeeUrl: 0,
  documentsFetched: 0,
  textsRead: 0,
  rawExtracted: 0,
  verified: 0,
  publishedRows: 0,
  publishedInstitutions: 0,
  sourcedInstitutions: 0,
};

export async function getPipelineFunnel(): Promise<PipelineFunnel> {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM institution_sources) AS institutions,
      (SELECT COUNT(*)::int FROM institution_sources
        WHERE COALESCE(fee_schedule_url, '') <> '') AS with_fee_url,
      (SELECT COUNT(*)::int FROM source_documents WHERE status = 'success') AS documents_fetched,
      (SELECT COUNT(*)::int FROM agent_source_texts WHERE status = 'completed') AS texts_read,
      (SELECT COUNT(*)::int FROM raw_fee_observations WHERE source = 'knox') AS raw_extracted,
      (SELECT COUNT(*)::int FROM verified_fee_observations) AS verified,
      (SELECT COUNT(*)::int FROM published_fee_catalog) AS published_rows,
      (SELECT COUNT(DISTINCT institution_id)::int FROM published_fee_catalog) AS published_institutions,
      (SELECT COUNT(DISTINCT institution_id)::int FROM published_fee_catalog
        WHERE source_url IS NOT NULL) AS sourced_institutions
  `;
  return {
    institutions: Number(row?.institutions ?? 0),
    withFeeUrl: Number(row?.with_fee_url ?? 0),
    documentsFetched: Number(row?.documents_fetched ?? 0),
    textsRead: Number(row?.texts_read ?? 0),
    rawExtracted: Number(row?.raw_extracted ?? 0),
    verified: Number(row?.verified ?? 0),
    publishedRows: Number(row?.published_rows ?? 0),
    publishedInstitutions: Number(row?.published_institutions ?? 0),
    sourcedInstitutions: Number(row?.sourced_institutions ?? 0),
  };
}
