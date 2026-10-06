import { unstable_cache } from "next/cache";
import { sql } from "@/lib/data-store/connection";
import { DARWIN_VERIFY_STRATEGY } from "./darwin/verify";
import { INSTITUTION_STEPS, isWentLive, movesFromEvents, nowFromSteps, toObject, type FlowSnapshot, type FlowWaiting, type Sample } from "./flow-model";

export * from "./flow-model";

/**
 * The live flow page: which institution each agent just handled, what happened to
 * it in plain words, what each agent is doing now, and how many institutions wait
 * in front of each one. Read-only, no model calls.
 *
 * Cost: the polled reads (moves, current work) use the step agent/status, run, and
 * run-status indexes and stay well under 100ms. The "waiting in line" counts scan fee tables,
 * so they are cached for five minutes and shared by every viewer.
 */

const FLOW_WORKERS = ["magellan", "rosetta", "knox", "darwin", "hamilton"];

export async function getFlowSnapshot(): Promise<FlowSnapshot> {
  const [events, active] = await Promise.all([
    // The last few finished steps per agent, so every agent shows its own latest
    // banks even when one state's pass floods the log. ~1ms on the live database.
    sql`
      SELECT e.id, e.created_at, e.detail, s.step_key, r.state_code
        FROM unnest(${FLOW_WORKERS}::text[]) AS a(agent)
        CROSS JOIN LATERAL (
          SELECT s.id, s.agent_run_id, s.step_key
            FROM agent_run_steps s
           WHERE s.agent_name = a.agent
             AND s.status = 'completed'
             AND s.step_key = ANY(${INSTITUTION_STEPS})
             AND s.queued_at >= NOW() - INTERVAL '24 hours'
           ORDER BY s.queued_at DESC
           LIMIT 6
        ) s
        JOIN agent_runs r ON r.id = s.agent_run_id
        JOIN LATERAL (
          SELECT e.id, e.created_at, e.detail
            FROM agent_run_events e
           WHERE e.agent_run_id = s.agent_run_id
             AND e.step_id = s.id
             AND e.event_type = 'step.finished'
           ORDER BY e.created_at DESC
           LIMIT 1
        ) e ON true
    `,
    sql`
      SELECT r.id AS run_id, r.state_code, s.step_key, s.agent_name, s.status
        FROM agent_runs r
        JOIN agent_run_steps s ON s.agent_run_id = r.id
       WHERE r.status IN ('queued', 'running')
         AND s.status IN ('queued', 'running')
    `,
  ]);

  const ids = new Set<number>();
  for (const row of events) {
    const detail = toObject(row.detail);
    for (const list of [detail.sample_results, detail.institution_results]) {
      if (!Array.isArray(list)) continue;
      for (const sample of list as Sample[]) {
        const id = Number(sample.institution_id);
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }
    }
  }
  const nameRows = ids.size > 0
    ? await sql`SELECT id, institution_name FROM institution_sources WHERE id = ANY(${[...ids]})`
    : [];
  const names = new Map(nameRows.map((row) => [Number(row.id), String(row.institution_name)]));

  const moves = movesFromEvents(events, names).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  // How many fees each just-published bank now has live, for the "On the site" column.
  const liveIds = [...new Set(moves.filter(isWentLive).map((move) => move.institutionId))].slice(0, 20);
  const liveRows = liveIds.length > 0
    ? await sql`
        SELECT institution_id, COUNT(*)::int AS fees
          FROM published_fee_catalog
         WHERE institution_id = ANY(${liveIds})
         GROUP BY institution_id
      `
    : [];

  return {
    moves,
    now: nowFromSteps(active),
    liveFees: Object.fromEntries(liveRows.map((row) => [Number(row.institution_id), Number(row.fees)])),
    generatedAt: new Date().toISOString(),
  };
}

/** Institutions waiting in front of each agent (and published), cached five minutes. */
export const getFlowWaiting = unstable_cache(
  async (): Promise<FlowWaiting> => {
    const [row] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM institution_sources i
          WHERE COALESCE(i.fee_schedule_url, '') = ''
            AND COALESCE(i.document_type, '') NOT IN ('offline', 'no_website')) AS magellan,
        (SELECT COUNT(DISTINCT doc.institution_id)::int
           FROM source_documents doc
           LEFT JOIN agent_source_texts t
             ON t.source_document_id = doc.id
            AND t.source_hash IS NOT DISTINCT FROM doc.content_hash
            AND t.status IN ('completed', 'empty', 'needs_ocr', 'skipped')
          WHERE doc.status = 'success' AND doc.document_url IS NOT NULL AND t.id IS NULL
            -- Only the bank's current document, as Rosetta reads it (rosetta/read.ts).
            AND NOT EXISTS (
              SELECT 1 FROM source_documents newer
               WHERE newer.institution_id = doc.institution_id
                 AND newer.id > doc.id
                 AND (
                   (newer.status = 'success' AND newer.duplicate_of_id IS DISTINCT FROM doc.id)
                   OR (newer.status = 'failed' AND doc.document_r2_key IS NULL)
                 ))
            AND NOT (
              doc.document_r2_key IS NULL
              AND EXISTS (
                SELECT 1 FROM pipeline_attempts dead
                 WHERE dead.institution_id = doc.institution_id
                   AND dead.stage = 'read'
                   AND dead.source_document_id = doc.id
                   AND dead.outcome IN ('http_404', 'http_410')))) AS rosetta,
        (SELECT COUNT(DISTINCT t.institution_id)::int
           FROM agent_source_texts t
          WHERE t.status = 'completed' AND t.char_count > 0
            AND NOT EXISTS (
              SELECT 1 FROM raw_fee_observations fr
               WHERE fr.source = 'knox' AND fr.source_document_id = t.source_document_id)) AS knox,
        (SELECT COUNT(DISTINCT fr.institution_id)::int
           FROM raw_fee_observations fr
          WHERE fr.source = 'knox' AND fr.outlier_flags ? 'needs_darwin_verification'
            AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
            -- Rows Darwin already decided (rejected, held for review, duplicate) never
            -- reach the verified table, so only rows its current rules have not seen wait.
            AND NOT EXISTS (
              SELECT 1 FROM pipeline_attempts pa
               WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                 AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                 AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version})) AS darwin,
        (SELECT COUNT(DISTINCT fv.institution_id)::int
           FROM verified_fee_observations fv
          WHERE fv.review_status IN ('verified', 'approved')
            AND fv.outlier_flags ? 'agentic_darwin_verified'
            AND NOT EXISTS (
              SELECT 1 FROM published_fee_records fp
               WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL)) AS hamilton,
        (SELECT COUNT(DISTINCT institution_id)::int FROM published_fee_catalog) AS published,
        (SELECT COUNT(*)::int FROM institution_sources) AS total
    `;
    return {
      magellan: Number(row?.magellan ?? 0),
      rosetta: Number(row?.rosetta ?? 0),
      knox: Number(row?.knox ?? 0),
      darwin: Number(row?.darwin ?? 0),
      hamilton: Number(row?.hamilton ?? 0),
      published: Number(row?.published ?? 0),
      total: Number(row?.total ?? 0),
    };
  },
  ["admin", "flow-waiting"],
  { revalidate: 300 },
);
