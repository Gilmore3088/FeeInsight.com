import { sql } from "@/lib/data-store/connection";
import { answerKeySchemaReady, scoreboardSchemaReady } from "@/lib/data-store/answer-key";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { readAgentHealth, summarizeAgentHealth, type AgentHealthReport } from "@/lib/agents/agent-health";
import { getMarketReadiness, summarizeReportReady, type ReportReadyCount } from "@/lib/data-store/market-readiness";

/**
 * Atlas's daily scoreboard: six numbers that say whether the pipeline is getting
 * better, snapshotted once a day into pipeline_scoreboard_snapshots. Deterministic
 * SQL over the ledger and fee tiers; never calls a model.
 *
 *   coverage             active institutions with a website whose fee link is verified:
 *                        it has a fee URL and Rosetta's newest text of it passed the
 *                        fee-page check (status 'completed')
 *   right-document rate  read attempts (30 days) that passed the fee-page check:
 *                        ok / (ok + wrong_document) in pipeline_attempts
 *   Knox yield           Knox fees per priced line (a line with a $ amount) on a fixed
 *                        sample: the answer-key institutions' newest completed texts
 *   depth                median distinct fee categories per live institution
 *   accuracy             the newest answer-key score (end-to-end precision and recall)
 *   freshness            median age in days of live fees, from the last time their
 *                        source document was fetched or checked
 *   Knox survival        of Knox fees ever published, the share still live, overall and
 *                        per Knox strategy. Yield rewards finding more fees; survival
 *                        rewards finding fees that stay right. Stored in `detail`.
 *   report-ready         institutions passing the report rule (state peers, or Fed
 *                        district peers where the state has too few). Stored in
 *                        `detail.report_ready`; /admin/leads shows it week over week.
 */

type SqlTag = typeof sql;

/** A line that carries a dollar amount (same signal as the fee-page check). */
export const PRICED_LINE_PATTERN = "\\$\\s?[0-9]";

export interface ScoreboardNumbers {
  coverage: { rate: number | null; numerator: number; denominator: number };
  rightDocument: { rate: number | null; numerator: number; denominator: number; windowDays: number } | null;
  knoxYield: { yield: number | null; fees: number; pricedLines: number; sampleSize: number } | null;
  depth: { median: number | null; liveInstitutions: number };
  accuracy: { precision: number | null; recall: number | null; scoreRunId: number | null; scoredAt: string | null } | null;
  freshness: { medianDays: number | null; liveFees: number };
  knoxSurvival: KnoxSurvival;
  /** Null when the count could not be read; the other numbers are still stored. */
  reportReady: ReportReadyCount | null;
}

export interface KnoxSurvival {
  rate: number | null;
  live: number;
  published: number;
  byStrategy: Array<{ strategy: string; rate: number | null; live: number; published: number }>;
}

const RIGHT_DOCUMENT_WINDOW_DAYS = 30;

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function numberOrNull(value: unknown, digits = 2): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const scale = 10 ** digits;
  return Math.round(parsed * scale) / scale;
}

async function readCoverage(db: SqlTag): Promise<ScoreboardNumbers["coverage"]> {
  const [row] = await db`
    WITH newest_text AS (
      SELECT DISTINCT ON (institution_id) institution_id, status
        FROM agent_source_texts
       ORDER BY institution_id, updated_at DESC, id DESC
    )
    SELECT COUNT(*)::int AS denominator,
           COUNT(*) FILTER (
             WHERE NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL
               AND nt.status = 'completed'
           )::int AS numerator
      FROM institution_sources inst
      LEFT JOIN newest_text nt ON nt.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND NULLIF(btrim(inst.website_url), '') IS NOT NULL
  `;
  const numerator = Number(row?.numerator ?? 0);
  const denominator = Number(row?.denominator ?? 0);
  return { rate: rate(numerator, denominator), numerator, denominator };
}

async function readRightDocument(db: SqlTag): Promise<ScoreboardNumbers["rightDocument"]> {
  if (!(await learningSchemaReady(db))) return null;
  const [row] = await db`
    SELECT COUNT(*) FILTER (WHERE outcome IN ('ok', 'ok_partial'))::int AS passed,
           COUNT(*)::int AS checked
      FROM pipeline_attempts
     WHERE stage = 'read'
       AND outcome IN ('ok', 'ok_partial', 'wrong_document')
       AND created_at >= NOW() - make_interval(days => ${RIGHT_DOCUMENT_WINDOW_DAYS}::int)
  `;
  const numerator = Number(row?.passed ?? 0);
  const denominator = Number(row?.checked ?? 0);
  return { rate: rate(numerator, denominator), numerator, denominator, windowDays: RIGHT_DOCUMENT_WINDOW_DAYS };
}

async function readKnoxYield(db: SqlTag): Promise<ScoreboardNumbers["knoxYield"]> {
  if (!(await answerKeySchemaReady(db))) return null;
  const [row] = await db`
    WITH sample AS (
      SELECT DISTINCT ON (t.institution_id) t.institution_id, t.source_document_id, t.normalized_text
        FROM agent_source_texts t
        JOIN answer_key_institutions ak ON ak.institution_id = t.institution_id
       WHERE t.status = 'completed'
       ORDER BY t.institution_id, t.updated_at DESC, t.id DESC
    )
    SELECT COUNT(*)::int AS sample_size,
           COALESCE(SUM((
             SELECT COUNT(*) FROM regexp_split_to_table(COALESCE(s.normalized_text, ''), E'\n') AS line
              WHERE line ~ ${PRICED_LINE_PATTERN}
           )), 0)::int AS priced_lines,
           COALESCE(SUM((
             SELECT COUNT(*) FROM raw_fee_observations fr
              WHERE fr.institution_id = s.institution_id
                AND fr.source_document_id = s.source_document_id
                AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ?| array['superseded_by_reread', 'superseded_by_newer_copy'])
           )), 0)::int AS fees
      FROM sample s
  `;
  const fees = Number(row?.fees ?? 0);
  const pricedLines = Number(row?.priced_lines ?? 0);
  return {
    yield: pricedLines > 0 ? Math.round((fees / pricedLines) * 10_000) / 10_000 : null,
    fees,
    pricedLines,
    sampleSize: Number(row?.sample_size ?? 0),
  };
}

async function readDepth(db: SqlTag): Promise<ScoreboardNumbers["depth"]> {
  const [row] = await db`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY categories) AS median,
           COUNT(*)::int AS live_institutions
      FROM (
        SELECT institution_id, COUNT(DISTINCT canonical_fee_key) AS categories
          FROM published_fee_catalog
         GROUP BY institution_id
      ) per_institution
  `;
  return { median: numberOrNull(row?.median), liveInstitutions: Number(row?.live_institutions ?? 0) };
}

async function readAccuracy(db: SqlTag): Promise<ScoreboardNumbers["accuracy"]> {
  if (!(await answerKeySchemaReady(db))) return null;
  const [row] = await db`
    SELECT id, precision, recall, scored_at
      FROM answer_key_score_runs
     ORDER BY scored_at DESC, id DESC
     LIMIT 1
  `;
  if (!row) return { precision: null, recall: null, scoreRunId: null, scoredAt: null };
  return {
    precision: numberOrNull(row.precision, 4),
    recall: numberOrNull(row.recall, 4),
    scoreRunId: Number(row.id),
    scoredAt: row.scored_at instanceof Date ? row.scored_at.toISOString() : String(row.scored_at),
  };
}

async function readFreshness(db: SqlTag): Promise<ScoreboardNumbers["freshness"]> {
  const [row] = await db`
    SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (NOW() - COALESCE(sd.last_checked_at, sd.crawled_at, c.created_at))) / 86400.0
           ) AS median_days,
           COUNT(*)::int AS live_fees
      FROM published_fee_catalog c
      LEFT JOIN source_documents sd ON sd.id = c.source_document_id
  `;
  return { medianDays: numberOrNull(row?.median_days), liveFees: Number(row?.live_fees ?? 0) };
}

/** Knox's strategy for a published fee, from its raw row's flags (as `knoxStrategyFromFlags`). */
async function readKnoxSurvival(db: SqlTag): Promise<KnoxSurvival> {
  const rows = await db<Array<{ strategy: string; published: number | string; live: number | string }>>`
    SELECT CASE
             WHEN fr.outlier_flags ? 'knox_paid_extraction' THEN 'extract.paid'
             ELSE COALESCE((
               SELECT substr(flag, length('knox_specialist:') + 1)
                 FROM jsonb_array_elements_text(fr.outlier_flags) flag
                WHERE flag LIKE 'knox_specialist:%'
                LIMIT 1
             ), 'extract.rules')
           END AS strategy,
           COUNT(*)::int AS published,
           (COUNT(*) FILTER (WHERE fp.rolled_back_at IS NULL))::int AS live
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fr.source = 'knox'
     GROUP BY 1
     ORDER BY 2 DESC
  `;
  const byStrategy = rows.map((row) => ({
    strategy: row.strategy,
    published: Number(row.published),
    live: Number(row.live),
    rate: rate(Number(row.live), Number(row.published)),
  }));
  const live = byStrategy.reduce((sum, row) => sum + row.live, 0);
  const published = byStrategy.reduce((sum, row) => sum + row.published, 0);
  return { rate: rate(live, published), live, published, byStrategy };
}

async function readReportReady(db: SqlTag): Promise<ReportReadyCount | null> {
  return inSavepoint(db, async (scope) => summarizeReportReady(await getMarketReadiness(scope))).catch((error) => {
    console.error("readReportReady failed:", error);
    return null;
  });
}

export async function readScoreboardNumbers(db: SqlTag = sql): Promise<ScoreboardNumbers> {
  const [coverage, rightDocument, knoxYield, depth, accuracy, freshness, knoxSurvival] = await Promise.all([
    readCoverage(db),
    readRightDocument(db),
    readKnoxYield(db),
    readDepth(db),
    readAccuracy(db),
    readFreshness(db),
    readKnoxSurvival(db),
  ]);
  // Its own savepoint, after the others: a failure here must not abort the snapshot.
  const reportReady = await readReportReady(db);
  return { coverage, rightDocument, knoxYield, depth, accuracy, freshness, knoxSurvival, reportReady };
}

export interface ScoreboardSnapshotResult {
  schemaReady: boolean;
  snapshotDate: string;
  numbers: ScoreboardNumbers;
  stored: boolean;
  /** Per-agent health check (agent-health.ts); null when it could not be read. */
  agentHealth?: AgentHealthReport | null;
}

/** Reads the six numbers and stores today's snapshot (one row per UTC day; reruns replace it). */
export async function runScoreboardSnapshot({
  runId,
  dryRun = false,
  db = sql,
  now = new Date(),
}: {
  runId: number | null;
  dryRun?: boolean;
  db?: SqlTag;
  now?: Date;
}): Promise<ScoreboardSnapshotResult> {
  const snapshotDate = now.toISOString().slice(0, 10);
  const numbers = await readScoreboardNumbers(db);
  const schemaReady = await scoreboardSchemaReady(db);
  // The health check reads yesterday's snapshot, so it needs the scoreboard table too.
  const agentHealth = schemaReady
    ? await inSavepoint(db, (scope) => readAgentHealth(scope, snapshotDate)).catch((error) => {
        console.error("readAgentHealth failed:", error);
        return null;
      })
    : null;
  if (!schemaReady || dryRun) return { schemaReady, snapshotDate, numbers, stored: false, agentHealth };
  await db`
    INSERT INTO pipeline_scoreboard_snapshots (
      snapshot_date, agent_run_id,
      coverage_rate, coverage_numerator, coverage_denominator,
      right_document_rate, right_document_numerator, right_document_denominator,
      knox_yield, knox_yield_fees, knox_yield_priced_lines, knox_yield_sample_size,
      depth_median_categories, depth_live_institutions,
      accuracy_precision, accuracy_recall, accuracy_score_run_id,
      freshness_median_days, freshness_live_fees, detail
    ) VALUES (
      ${snapshotDate}::date, ${runId},
      ${numbers.coverage.rate}, ${numbers.coverage.numerator}, ${numbers.coverage.denominator},
      ${numbers.rightDocument?.rate ?? null}, ${numbers.rightDocument?.numerator ?? null}, ${numbers.rightDocument?.denominator ?? null},
      ${numbers.knoxYield?.yield ?? null}, ${numbers.knoxYield?.fees ?? null}, ${numbers.knoxYield?.pricedLines ?? null}, ${numbers.knoxYield?.sampleSize ?? null},
      ${numbers.depth.median}, ${numbers.depth.liveInstitutions},
      ${numbers.accuracy?.precision ?? null}, ${numbers.accuracy?.recall ?? null}, ${numbers.accuracy?.scoreRunId ?? null},
      ${numbers.freshness.medianDays}, ${numbers.freshness.liveFees},
      ${JSON.stringify({
        right_document_window_days: numbers.rightDocument?.windowDays ?? null,
        accuracy_scored_at: numbers.accuracy?.scoredAt ?? null,
        knox_survival: numbers.knoxSurvival,
        ...(numbers.reportReady
          ? {
              report_ready: {
                institutions: numbers.reportReady.institutions,
                via_district: numbers.reportReady.viaDistrict,
                markets_ready: numbers.reportReady.marketsReady,
              },
            }
          : {}),
        ...(agentHealth ? { agent_health: agentHealth } : {}),
      })}::jsonb
    )
    ON CONFLICT (snapshot_date) DO UPDATE SET
      agent_run_id = EXCLUDED.agent_run_id,
      coverage_rate = EXCLUDED.coverage_rate,
      coverage_numerator = EXCLUDED.coverage_numerator,
      coverage_denominator = EXCLUDED.coverage_denominator,
      right_document_rate = EXCLUDED.right_document_rate,
      right_document_numerator = EXCLUDED.right_document_numerator,
      right_document_denominator = EXCLUDED.right_document_denominator,
      knox_yield = EXCLUDED.knox_yield,
      knox_yield_fees = EXCLUDED.knox_yield_fees,
      knox_yield_priced_lines = EXCLUDED.knox_yield_priced_lines,
      knox_yield_sample_size = EXCLUDED.knox_yield_sample_size,
      depth_median_categories = EXCLUDED.depth_median_categories,
      depth_live_institutions = EXCLUDED.depth_live_institutions,
      accuracy_precision = EXCLUDED.accuracy_precision,
      accuracy_recall = EXCLUDED.accuracy_recall,
      accuracy_score_run_id = EXCLUDED.accuracy_score_run_id,
      freshness_median_days = EXCLUDED.freshness_median_days,
      freshness_live_fees = EXCLUDED.freshness_live_fees,
      detail = EXCLUDED.detail,
      updated_at = NOW()
  `;
  return { schemaReady, snapshotDate, numbers, stored: true, agentHealth };
}

function pct(value: number | null | undefined): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/** One sentence for the step summary (and the crew log). */
export function summarizeScoreboard(result: ScoreboardSnapshotResult): string {
  const n = result.numbers;
  const parts = [
    `coverage ${pct(n.coverage.rate)} (${n.coverage.numerator.toLocaleString("en-US")} of ${n.coverage.denominator.toLocaleString("en-US")})`,
    `right documents ${pct(n.rightDocument?.rate)}`,
    `Knox yield ${n.knoxYield?.yield == null ? "n/a" : `${n.knoxYield.yield.toFixed(2)} fees per priced line`}`,
    `depth ${n.depth.median == null ? "n/a" : `${n.depth.median} categories`}`,
    `accuracy ${pct(n.accuracy?.precision)} precision / ${pct(n.accuracy?.recall)} recall`,
    `freshness ${n.freshness.medianDays == null ? "n/a" : `${n.freshness.medianDays} days`}`,
    `Knox survival ${pct(n.knoxSurvival.rate)} of ${n.knoxSurvival.published.toLocaleString("en-US")} published fees still live`,
    n.reportReady
      ? `${n.reportReady.institutions.toLocaleString("en-US")} institutions pass the report rule (${n.reportReady.viaDistrict.toLocaleString("en-US")} on Fed district peers)`
      : "report-ready count n/a",
  ];
  const prefix = result.stored
    ? `Atlas recorded the ${result.snapshotDate} scoreboard`
    : result.schemaReady
      ? `Atlas read the scoreboard (dry run, not stored)`
      : `Atlas read the scoreboard (not stored: the scoreboard migration is not applied yet)`;
  const health = result.agentHealth ? ` ${summarizeAgentHealth(result.agentHealth)}` : "";
  return `${prefix}: ${parts.join(", ")}.${health}`;
}
