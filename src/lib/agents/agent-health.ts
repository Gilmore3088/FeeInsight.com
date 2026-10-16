import { sql } from "@/lib/data-store/connection";
import { DARWIN_VERIFY_MAX_LIMIT, DARWIN_VERIFY_STRATEGY, darwinDueSql } from "./darwin/verify";
import { DARWIN_RELEASE_STRATEGY } from "./darwin/release-held";
import { KNOX_RULES_STRATEGY } from "./knox/specialists";
import { SOURCE_CHECK_REASON, SOURCE_CHECK_RESTORE_PREFIX, SOURCE_CHECK_STRATEGY } from "./hamilton/source-check";
import { GUTENBERG_AGENT, PUBLISHER_AGENT_NAMES, PUBLISHER_STEP_KEYS } from "@/lib/agents/gutenberg/names";

/**
 * Agent health check: the same numbers for every agent every day, stored with the daily
 * scoreboard (pipeline_scoreboard_snapshots.detail.agent_health) and compared with the
 * day before. Each agent has a short contract (its AGENTS.md "Daily health check"
 * table); every rule is tested by one number. A broken rule, or a number that moved more
 * than HEALTH_CHANGE_SHARE since yesterday, is named in the scoreboard step's summary,
 * so a regression or the effect of a new PR shows up as a flagged row instead of
 * something a person has to go looking for (James, 2026-10-06: "a clear process ... so
 * any new or change is easy to spot"). Deterministic read-only SQL over the last 24
 * hours; never calls a model.
 */

type SqlTag = typeof sql;

export const HEALTH_AGENTS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton", "gutenberg", "growth"] as const;
export type HealthAgent = (typeof HEALTH_AGENTS)[number];

/** A number that moved more than this share (and by at least 2) since yesterday is flagged. */
export const HEALTH_CHANGE_SHARE = 0.25;
/** Atlas's lanes are meant to run hourly; a median gap above this breaks the contract. */
export const ATLAS_MAX_MEDIAN_GAP_MINUTES = 90;
/** More than this share of catch-up runs doing nothing means a lane is looping. */
export const ATLAS_MAX_EMPTY_RUN_SHARE = 0.1;
/** A lane whose last this-many catch-up runs all did nothing is looping. */
export const ATLAS_EMPTY_STREAK_RUNS = 3;
/** The same link failing this often in a day is a retry loop, not bad luck. */
export const REPEAT_FAILURE_ATTEMPTS = 3;
/** Most of the published fees Darwin passed should survive Hamilton's source check. */
export const DARWIN_MAX_TAKEDOWN_SHARE = 0.05;

/** Catch-up steps whose summary line starts with the count of things they did. */
const WORK_STEP_KEYS = ["discover", "fetch", "read", "extract", "classify", "publish"];
const WORK_COUNT_PATTERN = "(?:discovered|fetched|read|extracted|verified|published) (\\d+)";
/** Outcomes a retry cannot fix within a day. */
const HARD_FAILURES = ["http_404", "http_403", "http_410", "network_error", "timeout", "http_5xx", "http_429"];

export type HealthNumbers = Record<string, number | null>;

export interface HealthRule {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface AgentHealthSection {
  agent: HealthAgent;
  numbers: HealthNumbers;
  rules: HealthRule[];
}

export interface HealthChange {
  agent: HealthAgent;
  key: string;
  today: number;
  yesterday: number;
}

export interface AgentHealthReport {
  agents: AgentHealthSection[];
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

function dollars(microusd: unknown): number {
  return Math.round(num(microusd) / 1e4) / 100;
}

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Steps failed and spend for one agent over the last 24 hours. Since #1075 step 2 the publisher
 * is Gutenberg: a publisher step written under Hamilton's name before the switch counts as
 * Gutenberg's (`ledgerAgent`), so Hamilton's row holds only the product's steps. Spend is read by
 * the agent's own name: `agent:hamilton` is product spend, and Gutenberg makes no paid calls.
 */
async function readCommon(db: SqlTag, agent: HealthAgent): Promise<{ stepsCompleted: number; stepsFailed: number; spendUsd: number }> {
  const stepAgents = agent === GUTENBERG_AGENT ? [...PUBLISHER_AGENT_NAMES] : [agent];
  const publisherKeys = [...PUBLISHER_STEP_KEYS];
  const [row] = await db`
    SELECT
      (SELECT COUNT(*) FROM agent_run_steps
        WHERE agent_name = ANY(${stepAgents}::text[]) AND status = 'completed'
          AND (CASE WHEN agent_name = 'hamilton' AND step_key = ANY(${publisherKeys}::text[]) THEN 'gutenberg' ELSE agent_name END) = ${agent}
          AND started_at > NOW() - INTERVAL '24 hours')::int AS steps_completed,
      (SELECT COUNT(*) FROM agent_run_steps
        WHERE agent_name = ANY(${stepAgents}::text[]) AND status = 'failed'
          AND (CASE WHEN agent_name = 'hamilton' AND step_key = ANY(${publisherKeys}::text[]) THEN 'gutenberg' ELSE agent_name END) = ${agent}
          AND started_at > NOW() - INTERVAL '24 hours')::int AS steps_failed,
      (SELECT COALESCE(SUM(estimated_cost_microusd), 0) FROM ai_api_usage_events
        WHERE agent_name = ${agent} AND created_at > NOW() - INTERVAL '24 hours') AS spend_microusd
  `;
  return {
    stepsCompleted: num(row?.steps_completed),
    stepsFailed: num(row?.steps_failed),
    spendUsd: dollars(row?.spend_microusd),
  };
}

/** Sum of the leading count in the summaries of one step key over the last 24 hours. */
async function stepCount(db: SqlTag, stepKey: string, pattern: string): Promise<number> {
  const [row] = await db`
    SELECT COALESCE(SUM((regexp_match(summary, ${pattern}))[1]::int), 0)::int AS total
      FROM agent_run_steps
     WHERE step_key = ${stepKey}
       AND status = 'completed'
       AND started_at > NOW() - INTERVAL '24 hours'
  `;
  return num(row?.total);
}

/** Documents or links that failed the same hard way REPEAT_FAILURE_ATTEMPTS or more times today. */
async function repeatFailures(db: SqlTag, stage: string): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS repeats
      FROM (
        SELECT COALESCE(source_document_id::text, input_fingerprint) AS input
          FROM pipeline_attempts
         WHERE stage = ${stage}
           AND outcome = ANY(${HARD_FAILURES}::text[])
           AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY institution_id, COALESCE(source_document_id::text, input_fingerprint)
        HAVING COUNT(*) >= ${REPEAT_FAILURE_ATTEMPTS}
      ) repeated
  `;
  return num(row?.repeats);
}

function noFailedSteps(numbers: HealthNumbers): HealthRule {
  const failed = num(numbers.stepsFailed);
  return {
    key: "no_failed_steps",
    label: "Steps do not fail",
    ok: failed === 0,
    detail: `${failed} failed of ${num(numbers.stepsCompleted) + failed}`,
  };
}

function noRepeatFailures(numbers: HealthNumbers, what: string): HealthRule {
  const repeats = num(numbers.repeatFailures);
  return {
    key: "no_repeat_failures",
    label: `No ${what} fails the same way ${REPEAT_FAILURE_ATTEMPTS}+ times a day`,
    ok: repeats === 0,
    detail: `${repeats} ${what}s did`,
  };
}

// ---------------------------------------------------------------- Atlas

export async function readAtlasNumbers(db: SqlTag): Promise<HealthNumbers> {
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
      (SELECT COUNT(*) FROM (
         SELECT state_code
           FROM (
             SELECT lane.state_code, lane.empty,
                    row_number() OVER (PARTITION BY lane.state_code ORDER BY lane.started_at DESC) AS recent
               FROM (
                 SELECT l.state_code, l.started_at,
                        NOT EXISTS (
                          SELECT 1 FROM agent_run_steps s
                           WHERE s.agent_run_id = l.id
                             AND s.step_key = ANY(${WORK_STEP_KEYS}::text[])
                             AND COALESCE((regexp_match(s.summary, ${WORK_COUNT_PATTERN}))[1]::int, 0) > 0
                        ) AS empty
                   FROM lane l
                  WHERE l.mode = 'backlog' AND l.status = 'completed'
               ) lane
           ) ranked
          WHERE recent <= ${ATLAS_EMPTY_STREAK_RUNS}
          GROUP BY state_code
         HAVING COUNT(*) = ${ATLAS_EMPTY_STREAK_RUNS} AND bool_and(empty)
       ) streaks)::int AS empty_streak_lanes,
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
               AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}
               AND pa.strategy_version = ${KNOX_RULES_STRATEGY.version}
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
          AND inst.last_crawl_at < NOW() - INTERVAL '30 days')::int AS stale_links
  `;

  const cap = runs?.daily_cap_microusd == null ? null : dollars(runs.daily_cap_microusd);
  return {
    laneRuns: num(runs?.lane_runs),
    laneRunsFailed: num(runs?.lane_runs_failed),
    backlogRuns: num(runs?.backlog_runs),
    emptyBacklogRuns: num(runs?.empty_backlog_runs),
    emptyStreakLanes: num(runs?.empty_streak_lanes),
    medianGapMinutes: numOrNull(runs?.median_gap_minutes),
    overdueLanes: num(runs?.overdue_lanes),
    queuedRuns: num(runs?.queued_runs),
    paidStepsSkipped: num(runs?.paid_steps_skipped),
    spendUsd: dollars(runs?.spend_microusd),
    dailyCapUsd: cap,
    phantomExtractTexts: num(backlog?.phantom_extract_texts),
    banksDueSearch: num(backlog?.banks_due_search),
    staleLinks: num(backlog?.stale_links),
  };
}

/** Atlas's contract (src/lib/agents/atlas/AGENTS.md), each rule tested by one number. */
export function atlasRules(n: HealthNumbers): HealthRule[] {
  const backlogRuns = num(n.backlogRuns);
  const empty = num(n.emptyBacklogRuns);
  const gap = n.medianGapMinutes;
  const spend = num(n.spendUsd);
  const cap = n.dailyCapUsd;
  return [
    {
      key: "no_failed_runs",
      label: "Lane runs do not fail",
      ok: num(n.laneRunsFailed) === 0,
      detail: `${num(n.laneRunsFailed)} failed of ${num(n.laneRuns)}`,
    },
    {
      key: "lanes_hourly",
      label: `A state with work gets a turn at least every ${ATLAS_MAX_MEDIAN_GAP_MINUTES} minutes`,
      ok: gap == null || gap <= ATLAS_MAX_MEDIAN_GAP_MINUTES,
      detail: `median gap ${gap ?? "n/a"} min`,
    },
    {
      key: "no_empty_runs",
      label: "Catch-up runs only start when there is work",
      ok: share(empty, backlogRuns) <= ATLAS_MAX_EMPTY_RUN_SHARE,
      detail: `${empty} of ${backlogRuns} did nothing`,
    },
    {
      key: "no_empty_streaks",
      label: `No lane does nothing ${ATLAS_EMPTY_STREAK_RUNS} catch-up runs in a row`,
      ok: num(n.emptyStreakLanes) === 0,
      detail: `${num(n.emptyStreakLanes)} lanes did`,
    },
    {
      key: "backlog_matches_steps",
      label: "The backlog check counts only work a step will pick up",
      ok: num(n.phantomExtractTexts) === 0,
      detail: `${num(n.phantomExtractTexts)} texts counted that Knox skips`,
    },
    {
      key: "paid_steps_run",
      label: "Paid steps are not skipped while under budget",
      ok: num(n.paidStepsSkipped) === 0,
      detail: `${num(n.paidStepsSkipped)} skipped`,
    },
    {
      key: "within_daily_cap",
      label: "Spend stays inside the daily cap",
      ok: cap == null || spend <= cap,
      detail: `$${spend.toFixed(2)} of ${cap == null ? "no cap" : `$${cap.toFixed(2)}`}`,
    },
  ];
}

// ---------------------------------------------------------------- Magellan

export async function readMagellanNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "magellan");
  return {
    ...common,
    banksSearched: await stepCount(db, "discover", "processed (\\d+)"),
    linksFound: await stepCount(db, "discover", "discovered (\\d+)"),
    docsFetched: await stepCount(db, "fetch", "fetched (\\d+)"),
    repeatFailures: await repeatFailures(db, "fetch"),
  };
}

export function magellanRules(n: HealthNumbers): HealthRule[] {
  return [noFailedSteps(n), noRepeatFailures(n, "fee link")];
}

// ---------------------------------------------------------------- Rosetta

export async function readRosettaNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "rosetta");
  const [row] = await db`
    SELECT COUNT(*) FILTER (WHERE outcome IN ('ok', 'ok_partial'))::int AS read_ok,
           COUNT(*) FILTER (WHERE outcome = 'wrong_document')::int AS wrong_document,
           COUNT(*) FILTER (WHERE outcome = ANY(${HARD_FAILURES}::text[]))::int AS read_failed
      FROM pipeline_attempts
     WHERE stage = 'read'
       AND created_at > NOW() - INTERVAL '24 hours'
  `;
  return {
    ...common,
    readOk: num(row?.read_ok),
    wrongDocument: num(row?.wrong_document),
    readFailed: num(row?.read_failed),
    repeatFailures: await repeatFailures(db, "read"),
  };
}

export function rosettaRules(n: HealthNumbers): HealthRule[] {
  return [noFailedSteps(n), noRepeatFailures(n, "document")];
}

// ---------------------------------------------------------------- Knox

export async function readKnoxNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "knox");
  const [row] = await db`
    SELECT
      (SELECT COUNT(*) FROM (
         SELECT 1 FROM pipeline_attempts
          WHERE stage = 'extract'
            AND strategy = ${KNOX_RULES_STRATEGY.strategy}
            AND strategy_version = ${KNOX_RULES_STRATEGY.version}
            AND created_at > NOW() - INTERVAL '24 hours'
          GROUP BY institution_id, input_fingerprint
       ) texts)::int AS texts_extracted,
      (SELECT COUNT(*) FROM (
         SELECT 1 FROM pipeline_attempts
          WHERE stage = 'extract'
            AND strategy = ${KNOX_RULES_STRATEGY.strategy}
            AND strategy_version = ${KNOX_RULES_STRATEGY.version}
            AND created_at > NOW() - INTERVAL '24 hours'
          GROUP BY institution_id, input_fingerprint
         HAVING COUNT(*) > 1
       ) repeats)::int AS repeat_extractions,
      (SELECT COUNT(*) FROM pipeline_attempts
        WHERE stage = 'extract' AND outcome = 'evidence_mismatch'
          AND created_at > NOW() - INTERVAL '24 hours')::int AS evidence_mismatch
  `;
  return {
    ...common,
    rawExtracted: await stepCount(db, "extract", "extracted (\\d+)"),
    textsExtracted: num(row?.texts_extracted),
    repeatExtractions: num(row?.repeat_extractions),
    evidenceMismatch: num(row?.evidence_mismatch),
  };
}

export function knoxRules(n: HealthNumbers): HealthRule[] {
  const repeats = num(n.repeatExtractions);
  return [
    noFailedSteps(n),
    {
      key: "extract_once",
      label: "Each text is extracted once per rules version",
      ok: repeats === 0,
      detail: `${repeats} of ${num(n.textsExtracted)} texts extracted again`,
    },
  ];
}

// ---------------------------------------------------------------- Darwin

/**
 * The rules hold codes a release review looks at again (`release-held.ts`). Every other
 * standing decision is final until a rule version changes.
 */
export const DARWIN_HELD_REASON_CODES = ["outside_envelope", "peer_outlier"] as const;

/**
 * Darwin's numbers. The pool is every Knox row flagged for Darwin and not verified; it splits
 * into three parts that add up to it (#1059 follow-up, 2026-10-15: one "16,363 waiting" number
 * mixed work Darwin owes with fees it already decided):
 * - `undecided`: due now (`darwinDueSql`), never decided or due again under today's rules;
 * - `heldForReview`: not due, latest rules decision a hold the release review looks at
 *   (`DARWIN_HELD_REASON_CODES`), split by the latest release verdict;
 * - `finalRejects`: not due, standing decision that is not a hold. These wait for nothing and
 *   are left out of every waiting number.
 * `audienceCorrection` counts rows the audience trigger refuses (not due, no decision needed).
 */
export async function readDarwinNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "darwin");
  const heldCodes = [...DARWIN_HELD_REASON_CODES];
  const [row] = await db`
    SELECT
      (SELECT COUNT(*) FROM pipeline_attempts
        WHERE stage = 'verify' AND strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
          AND created_at > NOW() - INTERVAL '24 hours')::int AS decided,
      (SELECT COUNT(*) FROM pipeline_attempts
        WHERE stage = 'verify' AND strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
          AND outcome = 'ok'
          AND created_at > NOW() - INTERVAL '24 hours')::int AS passed,
      split.pool,
      -- The rows the verify step would select now (#1052): never decided, or due again
      -- under today's rules (a guard, source-check, envelope or batch-key change).
      split.undecided,
      split.waiting_over_7d,
      split.held_for_review,
      split.held_keep,
      split.held_review,
      split.held_duplicate,
      split.held_reject,
      split.held_no_verdict,
      split.final_rejects,
      split.audience_correction,
      (SELECT COUNT(*) FROM published_fee_records
        WHERE published_at > NOW() - INTERVAL '24 hours')::int AS published,
      (SELECT COUNT(*) FROM published_fee_records
        WHERE rolled_back_at > NOW() - INTERVAL '24 hours'
          AND rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`})::int AS source_check_takedowns
      FROM (
        SELECT COUNT(*)::int AS pool,
               (COUNT(*) FILTER (WHERE fee.due))::int AS undecided,
               -- Due, sent to Darwin over 7 days ago, and no first decision at this rule version.
               (COUNT(*) FILTER (
                 WHERE fee.due
                   AND fee.created_at < NOW() - make_interval(days => ${DARWIN_MAX_FIRST_DECISION_DAYS})
                   AND NOT EXISTS (
                     SELECT 1 FROM pipeline_attempts first
                      WHERE first.input_fingerprint = 'raw:' || fee.fee_raw_id::text
                        AND first.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                        AND first.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
                   )
               ))::int AS waiting_over_7d,
               (COUNT(*) FILTER (WHERE fee.held))::int AS held_for_review,
               (COUNT(*) FILTER (WHERE fee.held AND fee.verdict = 'keep'))::int AS held_keep,
               (COUNT(*) FILTER (WHERE fee.held AND fee.verdict = 'review'))::int AS held_review,
               (COUNT(*) FILTER (WHERE fee.held AND fee.verdict = 'duplicate'))::int AS held_duplicate,
               (COUNT(*) FILTER (WHERE fee.held AND fee.verdict = 'reject'))::int AS held_reject,
               -- No release verdict yet, or a first "not stated" look waiting for its second.
               (COUNT(*) FILTER (
                 WHERE fee.held AND (fee.verdict IS NULL OR fee.verdict NOT IN ('keep', 'review', 'duplicate', 'reject'))
               ))::int AS held_no_verdict,
               (COUNT(*) FILTER (WHERE NOT fee.due AND NOT fee.audience AND NOT fee.held))::int AS final_rejects,
               (COUNT(*) FILTER (WHERE NOT fee.due AND fee.audience))::int AS audience_correction
          FROM (
            SELECT flagged.fee_raw_id,
                   flagged.created_at,
                   flagged.due,
                   flagged.audience,
                   flagged.latest_reason,
                   flagged.verdict,
                   (NOT flagged.due AND NOT flagged.audience
                     AND flagged.latest_reason = ANY(${heldCodes}::text[])) AS held
              FROM (
                SELECT fr.fee_raw_id,
                       fr.created_at,
                       (${db.unsafe(darwinDueSql())}) AS due,
                       (fr.outlier_flags ? 'audience_correction_required') AS audience,
                       (SELECT pa.detail->>'reason_code' FROM pipeline_attempts pa
                         WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                           AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                           AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
                         ORDER BY pa.created_at DESC, pa.id DESC
                         LIMIT 1) AS latest_reason,
                       (SELECT rel.detail->>'verdict' FROM pipeline_attempts rel
                         WHERE rel.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                           AND rel.strategy = ${DARWIN_RELEASE_STRATEGY.strategy}
                           AND rel.strategy_version = ${DARWIN_RELEASE_STRATEGY.version}
                         ORDER BY rel.created_at DESC, rel.id DESC
                         LIMIT 1) AS verdict
                  FROM raw_fee_observations fr
                 WHERE fr.source = 'knox'
                   AND fr.outlier_flags ? 'needs_darwin_verification'
                   AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
                -- A fence: without it the planner copies the due and latest-decision subqueries
                -- into every count that reads them, once per count.
                OFFSET 0
              ) flagged
          ) fee
      ) split
  `;
  return {
    ...common,
    decided: num(row?.decided),
    passed: num(row?.passed),
    pool: num(row?.pool),
    undecided: num(row?.undecided),
    waitingOver7d: num(row?.waiting_over_7d),
    heldForReview: num(row?.held_for_review),
    heldKeep: num(row?.held_keep),
    heldReview: num(row?.held_review),
    heldDuplicate: num(row?.held_duplicate),
    heldReject: num(row?.held_reject),
    heldNoVerdict: num(row?.held_no_verdict),
    finalRejects: num(row?.final_rejects),
    audienceCorrection: num(row?.audience_correction),
    published: num(row?.published),
    sourceCheckTakedowns: num(row?.source_check_takedowns),
  };
}

/** The audit's bar (#1052): no due Knox row with no first decision waits longer than this. */
export const DARWIN_MAX_FIRST_DECISION_DAYS = 7;

export function darwinRules(n: HealthNumbers): HealthRule[] {
  const undecided = num(n.undecided);
  const waiting = num(n.waitingOver7d);
  const takedowns = num(n.sourceCheckTakedowns);
  const published = num(n.published);
  return [
    noFailedSteps(n),
    {
      key: "keeps_up",
      label: `Darwin keeps up: no more than one step's worth (${DARWIN_VERIFY_MAX_LIMIT}) of rows undecided`,
      ok: undecided <= DARWIN_VERIFY_MAX_LIMIT,
      detail: `${undecided} undecided`,
    },
    {
      key: "no_week_old_waits",
      label: `No due Knox row with no first decision waits more than ${DARWIN_MAX_FIRST_DECISION_DAYS} days`,
      ok: waiting === 0,
      detail: `${waiting} with no first decision after ${DARWIN_MAX_FIRST_DECISION_DAYS} days`,
    },
    {
      key: "passed_fees_hold_up",
      label: `Fees Darwin passed survive the bank's own schedule (≤ ${pct(DARWIN_MAX_TAKEDOWN_SHARE)} taken down)`,
      ok: share(takedowns, published) <= DARWIN_MAX_TAKEDOWN_SHARE,
      detail: `${takedowns} taken down vs ${published} published (${pct(share(takedowns, published))})`,
    },
  ];
}

// ---------------------------------------------------------------- Gutenberg

/** Gutenberg (the publisher, #1075): its steps, the live catalog and the source check. */
export async function readGutenbergNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, GUTENBERG_AGENT);
  const [row] = await db`
    SELECT
      (SELECT COUNT(*) FROM published_fee_records WHERE rolled_back_at IS NULL)::int AS live_fees,
      (SELECT COUNT(*) FROM pipeline_attempts
        WHERE strategy = ${SOURCE_CHECK_STRATEGY.strategy}
          AND input_fingerprint NOT LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
          AND created_at > NOW() - INTERVAL '24 hours')::int AS source_checks,
      (SELECT COUNT(*)
         FROM (
           SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_id
             FROM published_fee_records fp
            -- Same set as Atlas's unchecked-live-fee wake: source-check takedowns count.
            WHERE fp.rolled_back_at IS NULL
               OR fp.rolled_back_reason LIKE ${`${SOURCE_CHECK_REASON}:%`}
            GROUP BY fp.institution_id
         ) live
        WHERE NOT EXISTS (
          SELECT 1 FROM pipeline_attempts pa
           WHERE pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
             AND pa.institution_id = live.institution_id
             AND pa.input_fingerprint = 'v' || ${SOURCE_CHECK_STRATEGY.version}::text || ':' || live.max_id::text
             AND NOT EXISTS (
               SELECT 1 FROM pipeline_attempts restore
                WHERE restore.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                  AND restore.institution_id = live.institution_id
                  AND restore.input_fingerprint LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
                  AND restore.id > pa.id
             )
        ))::int AS banks_not_source_checked
  `;
  return {
    ...common,
    liveFees: num(row?.live_fees),
    sourceChecks: num(row?.source_checks),
    banksNotSourceChecked: num(row?.banks_not_source_checked),
  };
}

export function gutenbergRules(n: HealthNumbers): HealthRule[] {
  const spend = num(n.spendUsd);
  return [
    noFailedSteps(n),
    {
      key: "no_paid_calls",
      label: "Gutenberg makes no paid model calls",
      ok: spend === 0,
      detail: `$${spend.toFixed(2)} spent`,
    },
  ];
}

// ---------------------------------------------------------------- Hamilton

/** Hamilton (the product): its own steps and its spend against the `agent:hamilton` daily cap. */
export async function readHamiltonNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "hamilton");
  const [row] = await db`
    SELECT MIN(hard_daily_microusd) AS daily_cap_microusd
      FROM api_budget_policies
     WHERE policy_key = 'agent:hamilton' AND enabled
  `;
  return {
    ...common,
    dailyCapUsd: row?.daily_cap_microusd == null ? null : dollars(row.daily_cap_microusd),
  };
}

export function hamiltonRules(n: HealthNumbers): HealthRule[] {
  const spend = num(n.spendUsd);
  const cap = n.dailyCapUsd;
  return [
    noFailedSteps(n),
    {
      key: "within_daily_cap",
      label: "Hamilton's spend stays inside its daily cap",
      ok: cap == null || spend <= cap,
      detail: `$${spend.toFixed(2)} of ${cap == null ? "no cap" : `$${cap.toFixed(2)}`}`,
    },
  ];
}

// ---------------------------------------------------------------- Growth

/** Growth (marketing): its steps and its spend against the `agent:growth` daily cap. */
export async function readGrowthNumbers(db: SqlTag): Promise<HealthNumbers> {
  const common = await readCommon(db, "growth");
  const [row] = await db`
    SELECT MIN(hard_daily_microusd) AS daily_cap_microusd
      FROM api_budget_policies
     WHERE policy_key = 'agent:growth' AND enabled
  `;
  return {
    ...common,
    dailyCapUsd: row?.daily_cap_microusd == null ? null : dollars(row.daily_cap_microusd),
  };
}

export function growthRules(n: HealthNumbers): HealthRule[] {
  const spend = num(n.spendUsd);
  const cap = n.dailyCapUsd;
  return [
    noFailedSteps(n),
    {
      key: "within_daily_cap",
      label: "Growth's spend stays inside its daily cap",
      ok: cap == null || spend <= cap,
      detail: `$${spend.toFixed(2)} of ${cap == null ? "no cap" : `$${cap.toFixed(2)}`}`,
    },
  ];
}

// ---------------------------------------------------------------- report

const READERS: Record<HealthAgent, (db: SqlTag) => Promise<HealthNumbers>> = {
  atlas: readAtlasNumbers,
  magellan: readMagellanNumbers,
  rosetta: readRosettaNumbers,
  knox: readKnoxNumbers,
  darwin: readDarwinNumbers,
  hamilton: readHamiltonNumbers,
  gutenberg: readGutenbergNumbers,
  growth: readGrowthNumbers,
};

const RULES: Record<HealthAgent, (numbers: HealthNumbers) => HealthRule[]> = {
  atlas: atlasRules,
  magellan: magellanRules,
  rosetta: rosettaRules,
  knox: knoxRules,
  darwin: darwinRules,
  hamilton: hamiltonRules,
  gutenberg: gutenbergRules,
  growth: growthRules,
};

/** Numbers that moved more than HEALTH_CHANGE_SHARE (and by at least 2) since yesterday. */
export function healthChanges(
  agent: HealthAgent,
  today: HealthNumbers,
  yesterday: HealthNumbers | null | undefined,
): HealthChange[] {
  if (!yesterday) return [];
  const changes: HealthChange[] = [];
  for (const [key, now] of Object.entries(today)) {
    const before = yesterday[key];
    if (typeof now !== "number" || typeof before !== "number") continue;
    const delta = Math.abs(now - before);
    if (delta >= 2 && delta / Math.max(Math.abs(before), 1) > HEALTH_CHANGE_SHARE) {
      changes.push({ agent, key, today: now, yesterday: before });
    }
  }
  return changes;
}

/** Each agent's numbers from the newest snapshot before `snapshotDate`, if any. */
export async function previousAgentNumbers(
  db: SqlTag,
  snapshotDate: string,
): Promise<Partial<Record<HealthAgent, HealthNumbers>>> {
  const [row] = await db`
    SELECT detail->'agent_health' AS health
      FROM pipeline_scoreboard_snapshots
     WHERE snapshot_date < ${snapshotDate}::date
       AND detail ? 'agent_health'
     ORDER BY snapshot_date DESC
     LIMIT 1
  `;
  const raw = row?.health;
  if (!raw) return {};
  const health = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<AgentHealthReport>;
  const out: Partial<Record<HealthAgent, HealthNumbers>> = {};
  for (const section of health.agents ?? []) out[section.agent] = section.numbers;
  return out;
}

/**
 * Reads every agent's numbers one after another (they run inside the scoreboard step's
 * transaction, which takes one statement at a time) and compares them with yesterday.
 */
export async function readAgentHealth(db: SqlTag, snapshotDate: string): Promise<AgentHealthReport> {
  const yesterday = await previousAgentNumbers(db, snapshotDate);
  const agents: AgentHealthSection[] = [];
  const changes: HealthChange[] = [];
  for (const agent of HEALTH_AGENTS) {
    const numbers = await READERS[agent](db);
    agents.push({ agent, numbers, rules: RULES[agent](numbers) });
    changes.push(...healthChanges(agent, numbers, yesterday[agent]));
  }
  return { agents, changes };
}

function agentName(agent: HealthAgent): string {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

/** One sentence: broken rules first, then what moved since yesterday. */
export function summarizeAgentHealth(report: AgentHealthReport): string {
  const total = report.agents.reduce((sum, section) => sum + section.rules.length, 0);
  const broken = report.agents.flatMap((section) =>
    section.rules.filter((rule) => !rule.ok).map((rule) => `${agentName(section.agent)}: ${rule.label} (${rule.detail})`),
  );
  const rules = broken.length === 0
    ? `Agent health: all ${total} rules hold`
    : `Agent health: ${broken.length} of ${total} rules broken: ${broken.join("; ")}`;
  const moved = report.changes.length === 0
    ? "nothing moved more than 25% since yesterday"
    : `changed since yesterday: ${report.changes
        .map((change) => `${agentName(change.agent)} ${change.key} ${change.yesterday} → ${change.today}`)
        .join(", ")}`;
  return `${rules}. ${moved.charAt(0).toUpperCase()}${moved.slice(1)}.`;
}
