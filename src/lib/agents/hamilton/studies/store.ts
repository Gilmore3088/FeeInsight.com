import type { SqlTag, StudySource } from "./common";

export interface StudyRecord {
  studyKey: string;
  methodVersion: number;
  title: string;
  asOf: string;
  metric: string;
  n: number;
  sources: StudySource[];
  findings: Record<string, unknown>;
}

export interface Placement {
  institutionId: number;
  metric: string;
  value: number | null;
  peerGroup: string;
  peerN: number;
  peerMedian: number | null;
  percentile: number | null;
  quartile: number | null;
  detail?: Record<string, unknown>;
}

export async function studiesSchemaReady(db: SqlTag): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.hamilton_studies') IS NOT NULL
       AND to_regclass('public.hamilton_study_placements') IS NOT NULL
       AND to_regclass('public.inferred_fee_volume') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

/** The stored study for this key, method and period, if one exists. */
export async function findStudy(
  db: SqlTag,
  studyKey: string,
  methodVersion: number,
  asOf: string,
): Promise<{ id: number; n: number } | null> {
  const [row] = await db`
    SELECT id, n FROM hamilton_studies
     WHERE study_key = ${studyKey} AND method_version = ${methodVersion} AND as_of = ${asOf}
  `;
  return row ? { id: Number(row.id), n: Number(row.n) } : null;
}

const PLACEMENT_BATCH = 2000;

/**
 * Store a study result and its placements, and make it the current result for its key.
 * Re-storing the same key, method and period replaces the earlier result.
 */
export async function saveStudy(
  db: SqlTag,
  record: StudyRecord,
  placements: Placement[],
  runId: number | null,
): Promise<number> {
  const [row] = await db`
    INSERT INTO hamilton_studies
      (study_key, method_version, title, as_of, metric, n, sources, findings, is_current, agent_run_id, computed_at)
    VALUES
      (${record.studyKey}, ${record.methodVersion}, ${record.title}, ${record.asOf}, ${record.metric}, ${record.n},
       ${JSON.stringify(record.sources)}::jsonb, ${JSON.stringify(record.findings)}::jsonb, false, ${runId}, NOW())
    ON CONFLICT (study_key, method_version, as_of) DO UPDATE SET
      title = EXCLUDED.title,
      metric = EXCLUDED.metric,
      n = EXCLUDED.n,
      sources = EXCLUDED.sources,
      findings = EXCLUDED.findings,
      agent_run_id = EXCLUDED.agent_run_id,
      computed_at = NOW()
    RETURNING id
  `;
  const studyId = Number(row.id);
  await db`UPDATE hamilton_studies SET is_current = false WHERE study_key = ${record.studyKey} AND is_current AND id <> ${studyId}`;
  await db`UPDATE hamilton_studies SET is_current = true WHERE id = ${studyId}`;
  await db`DELETE FROM hamilton_study_placements WHERE study_id = ${studyId}`;
  for (let i = 0; i < placements.length; i += PLACEMENT_BATCH) {
    const payload = JSON.stringify(
      placements.slice(i, i + PLACEMENT_BATCH).map((p) => ({
        institution_id: p.institutionId,
        metric: p.metric,
        value: p.value,
        peer_group: p.peerGroup,
        peer_n: p.peerN,
        peer_median: p.peerMedian,
        percentile: p.percentile,
        quartile: p.quartile,
        detail: p.detail ?? {},
      })),
    );
    await db`
      INSERT INTO hamilton_study_placements
        (study_id, institution_id, metric, value, peer_group, peer_n, peer_median, percentile, quartile, detail)
      SELECT ${studyId}, x.institution_id, x.metric, x.value, x.peer_group, x.peer_n, x.peer_median,
             x.percentile, x.quartile, x.detail
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          institution_id bigint, metric text, value float8, peer_group text, peer_n int,
          peer_median float8, percentile float8, quartile smallint, detail jsonb)
      ON CONFLICT (study_id, institution_id, metric) DO NOTHING
    `;
  }
  return studyId;
}
