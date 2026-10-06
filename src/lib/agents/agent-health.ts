import { sql } from "@/lib/data-store/connection";
import { KNOX_EXTRACT_STRATEGY } from "./knox/extract";
import { SOURCE_CHECK_REASON, SOURCE_CHECK_STRATEGY } from "./hamilton/source-check";

/**
 * Agent health check: the same numbers for each agent every day, stored with the daily
 * scoreboard (pipeline_scoreboard_snapshots.detail.agent_health) and compared with the
 * day before, so a change or a broken contract rule shows up as a flagged row instead
 * of something a person has to go looking for. Deterministic read-only SQL; never calls
 * a model. Atlas first (James, 2026-10-06); the other agents add their own section with
 * the same shape: numbers, contract rules each tested by one number, and day-over-day
 * moves.
 */

type SqlTag = typeof sql;

/** A number that moved more than this share since yesterday is flagged as a change. */
export const HEALTH_CHANGE_SHARE = 0.25;
/** Atlas's lanes are meant to run hourly; a median gap above this breaks the contract. */
export const ATLAS_MAX_MEDIAN_GAP_MINUTES = 90;
/** More than this share of catch-up runs doing nothing means a lane is looping. */
export const ATLAS_MAX_EMPTY_RUN_SHARE = 0.1;

/** Catch-up steps whose summary line starts with the count of things they did. */
const WORK_STEP_KEYS = ["discover", "fetch", "read", "extract", "classify", "publish"];
const WORK_COUNT_PATTERN = "(?:discovered|fetched|read|extracted|verified|published) (\\d+)";

export interface AtlasHealth {
  laneRuns: number;
  laneRunsFailed: number;
  backlogRuns: number;
  emptyBacklogRuns: number;
  medianGapMinutes: number | null;
  overdueLanes: number;
  queuedRuns: number;
  paidStepsSkipped: number;
  spendUsd: number;
  dailyCapUsd: number | null;
  /** Texts the lane's backlog check would count that Knox will never pick up (PR 204). */
  phantomExtractTexts: number;
  banksDueSearch: number;
  staleLinks: number;
  banksNotSourceChecked: number;
}

export interface HealthRule {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface HealthChange {
  key: keyof AtlasHealth;
  today: number;
  yesterday: number;
}

export interface AgentHealthReport {
  atlas: AtlasHealth;
  rules: HealthRule[];
  changes: HealthChange[];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

/** Atlas's numbers over the last 24 hours, plus its open backlog right now. */
export async function readAtlasHealth(db: SqlTag = sql): Promise<AtlasHealth> {
  const [runs] = await db`
    WITH lane AS (
      SELECT r.id, upper(btrim(r.state_code)) AS state_code, r.status, r.started_at,
             COALESCE(r.params_json->>'lane_mode', 'full') AS mode
        FROM agent_runs r
       WHERE r.run_kind = 'workflow_lane'
         AND r.started_at > NOW() - INTERVAL '24 hours'
    ),
    gaps AS (
      SELECT started_at - lag(started_at) OVER (PARTITION BY state_code ORDER BY started_at) AS gap
        FROM lane
    )
    SELECT
      (SELECT COUNT(*) FROM lane)::int AS lane_runs,
      (SELECT COUNT(*) FROM lane WHERE status = 'failed')::int AS lane_runs_failed,
      (SELECT COUNT(*) FROM lane WHERE mode = 'backlog' AND status = 'completed')::int AS backlog_runs,
      (SELECT COUNT(*) FROM lane
        WHERE mode = 'backlog' AND status = 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM agent_run_steps s
             WHERE s.agent_run_id = lane.id
               AND s.step_key = ANY(${WORK_STEP_KEYS}::text[])
               AND COALESCE((regexp_match(s.summary, ${WORK_COUNT_PATTERN}))[1]::int, 0) > 0
          ))::int AS empty_backlog_runs,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM gap) / 60.0)
         FROM gaps WHERE gap IS NOT NULL) AS median_gap_minutes,
      (SELECT COUNT(*) FROM agent_state_lanes l
        WHERE l.next_run_after <= NOW()
          AND NOT EXISTS (
            SELECT 1 FROM agent_runs a
             WHERE a.id = l.last_agent_run_id
               AND a.status IN ('queued', 'running', 'cancel_requested')
          ))::int AS overdue_lanes,
      (SELECT COUNT(*) FROM agent_runs WHERE status = 'queued')::int AS queued_runs,
      (SELECT COUNT(*) FROM agent_run_steps s
        WHERE s.status = 'skipped'
          AND s.summary LIKE 'Paid pass skipped%'
          AND s.completed_at > NOW() - INTERVAL '24 hours')::int AS paid_steps_skipped,
      (SELECT COALESCE(SUM(estimated_cost_microusd), 0) FROM ai_api_usage_events
        WHERE created_at > NOW() - INTERVAL '24 hours') AS spend_microusd,
      (SELECT MIN(hard_daily_microusd) FROM api_budget_policies
        WHERE scope = 'global' AND enabled AND hard_daily_microusd IS NOT NULL) AS daily_cap_microusd
  `;

  const [backlog] = await db`
    SELECT
      (SELECT COUNT(*)
         FROM agent_source_texts adt
        WHERE adt.status = 'completed'
          AND adt.char_count > 0
          AND (SELECT COUNT(*) FROM raw_fee_observations fr
                WHERE fr.source = 'knox' AND fr.source_document_id = adt.source_document_id) < 5
          AND NOT EXISTS (
            SELECT 1 FROM pipeline_attempts pa
             WHERE pa.stage = 'extract'
               AND pa.institution_id = adt.institution_id
               AND pa.input_fingerprint = adt.text_hash
               AND pa.strategy = ${KNOX_EXTRACT_STRATEGY.strategy}
               AND pa.strategy_version = ${KNOX_EXTRACT_STRATEGY.version}
          )
          AND EXISTS (
            SELECT 1 FROM agent_source_texts prior
              JOIN raw_fee_observations prior_fr
                ON prior_fr.source = 'knox' AND prior_fr.source_document_id = prior.source_document_id
             WHERE adt.text_hash IS NOT NULL
               AND prior.institution_id = adt.institution_id
               AND prior.text_hash = adt.text_hash
               AND prior.id <> adt.id
          ))::int AS phantom_extract_texts,
      (SELECT COUNT(*)
         FROM institution_sources inst
         LEFT JOIN institution_source_profiles p ON p.institution_id = inst.id
        WHERE COALESCE(inst.status, 'active') = 'active'
          AND NULLIF(btrim(inst.fee_schedule_url), '') IS NULL
          AND NULLIF(btrim(inst.website_url), '') IS NOT NULL
          AND COALESCE(p.source_kind, 'unknown') <> 'offline'
          AND COALESCE(p.read_strategy, '') <> 'manual_review'
          AND (
            inst.last_rescue_attempt_at IS NULL
            OR (COALESCE(inst.rescue_status, 'pending') IN ('pending', 'retry_after')
                AND inst.last_rescue_attempt_at < NOW() - INTERVAL '12 hours')
          ))::int AS banks_due_search,
      (SELECT COUNT(*)
         FROM institution_sources inst
        WHERE COALESCE(inst.status, 'active') = 'active'
          AND NULLIF(btrim(inst.fee_schedule_url), '') IS NOT NULL
          AND inst.last_crawl_at < NOW() - INTERVAL '30 days')::int AS stale_links,
      (SELECT COUNT(*)
         FROM (
           SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_id
             FROM published_fee_records fp
            -- Same set as the lane's unchecked-live-fee wake: source-check takedowns count.
            WHERE fp.rolled_back_at IS NULL
               OR fp.rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`}
            GROUP BY fp.institution_id
         ) live
        WHERE NOT EXISTS (
          SELECT 1 FROM pipeline_attempts pa
           WHERE pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
             AND pa.institution_id = live.institution_id
             AND pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || live.max_id::text
        ))::int AS banks_not_source_checked
  `;

  const cap = runs?.daily_cap_microusd == null ? null : num(runs.daily_cap_microusd) / 1e6;
  return {
    laneRuns: num(runs?.lane_runs),
    laneRunsFailed: num(runs?.lane_runs_failed),
    backlogRuns: num(runs?.backlog_runs),
    emptyBacklogRuns: num(runs?.empty_backlog_runs),
    medianGapMinutes: numOrNull(runs?.median_gap_minutes),
    overdueLanes: num(runs?.overdue_lanes),
    queuedRuns: num(runs?.queued_runs),
    paidStepsSkipped: num(runs?.paid_steps_skipped),
    spendUsd: Math.round(num(runs?.spend_microusd) / 1e4) / 100,
    dailyCapUsd: cap,
    phantomExtractTexts: num(backlog?.phantom_extract_texts),
    banksDueSearch: num(backlog?.banks_due_search),
    staleLinks: num(backlog?.stale_links),
    banksNotSourceChecked: num(backlog?.banks_not_source_checked),
  };
}

/** Atlas's contract (src/lib/agents/atlas/AGENTS.md), each rule tested by one number. */
export function atlasRules(h: AtlasHealth): HealthRule[] {
  const emptyShare = h.backlogRuns > 0 ? h.emptyBacklogRuns / h.backlogRuns : 0;
  return [
    {
      key: "no_failed_runs",
      label: "Lane runs do not fail",
      ok: h.laneRunsFailed === 0,
      detail: `${h.laneRunsFailed} failed of ${h.laneRuns}`,
    },
    {
      key: "lanes_hourly",
      label: `A state with work gets a turn at least every ${ATLAS_MAX_MEDIAN_GAP_MINUTES} minutes`,
      ok: h.medianGapMinutes == null || h.medianGapMinutes <= ATLAS_MAX_MEDIAN_GAP_MINUTES,
      detail: `median gap ${h.medianGapMinutes ?? "n/a"} min`,
    },
    {
      key: "no_empty_runs",
      label: "Catch-up runs only start when there is work",
      ok: emptyShare <= ATLAS_MAX_EMPTY_RUN_SHARE,
      detail: `${h.emptyBacklogRuns} of ${h.backlogRuns} did nothing`,
    },
    {
      key: "backlog_matches_steps",
      label: "The backlog check counts only work a step will pick up",
      ok: h.phantomExtractTexts === 0,
      detail: `${h.phantomExtractTexts} texts counted that Knox skips`,
    },
    {
      key: "paid_steps_run",
      label: "Paid steps are not skipped while under budget",
      ok: h.paidStepsSkipped === 0,
      detail: `${h.paidStepsSkipped} skipped`,
    },
    {
      key: "within_daily_cap",
      label: "Spend stays inside the daily cap",
      ok: h.dailyCapUsd == null || h.spendUsd <= h.dailyCapUsd,
      detail: `$${h.spendUsd.toFixed(2)} of ${h.dailyCapUsd == null ? "no cap" : `$${h.dailyCapUsd.toFixed(2)}`}`,
    },
  ];
}

/** Numbers that moved more than HEALTH_CHANGE_SHARE since yesterday's snapshot. */
export function healthChanges(today: AtlasHealth, yesterday: Partial<AtlasHealth> | null | undefined): HealthChange[] {
  if (!yesterday) return [];
  const changes: HealthChange[] = [];
  for (const key of Object.keys(today) as Array<keyof AtlasHealth>) {
    const now = today[key];
    const before = yesterday[key];
    if (typeof now !== "number" || typeof before !== "number") continue;
    const base = Math.max(Math.abs(before), 1);
    if (Math.abs(now - before) / base > HEALTH_CHANGE_SHARE && Math.abs(now - before) >= 2) {
      changes.push({ key, today: now, yesterday: before });
    }
  }
  return changes;
}

/** The Atlas section stored in the previous snapshot before `snapshotDate`, if any. */
export async function previousAtlasHealth(db: SqlTag, snapshotDate: string): Promise<Partial<AtlasHealth> | null> {
  const [row] = await db`
    SELECT detail->'agent_health'->'atlas' AS atlas
      FROM pipeline_scoreboard_snapshots
     WHERE snapshot_date < ${snapshotDate}::date
       AND detail ? 'agent_health'
     ORDER BY snapshot_date DESC
     LIMIT 1
  `;
  const atlas = row?.atlas;
  if (!atlas) return null;
  return (typeof atlas === "string" ? JSON.parse(atlas) : atlas) as Partial<AtlasHealth>;
}

export async function readAgentHealth(db: SqlTag, snapshotDate: string): Promise<AgentHealthReport> {
  const atlas = await readAtlasHealth(db);
  const yesterday = await previousAtlasHealth(db, snapshotDate);
  return { atlas, rules: atlasRules(atlas), changes: healthChanges(atlas, yesterday) };
}

/** One sentence: broken rules first, then what moved since yesterday. */
export function summarizeAgentHealth(report: AgentHealthReport): string {
  const broken = report.rules.filter((rule) => !rule.ok);
  const rules = broken.length === 0
    ? `Atlas health: all ${report.rules.length} rules hold`
    : `Atlas health: ${broken.length} of ${report.rules.length} rules broken (${broken.map((rule) => `${rule.label}: ${rule.detail}`).join("; ")})`;
  const moved = report.changes.length === 0
    ? "nothing moved more than 25% since yesterday"
    : `changed since yesterday: ${report.changes.map((change) => `${change.key} ${change.yesterday} → ${change.today}`).join(", ")}`;
  return `${rules}; ${moved}.`;
}
