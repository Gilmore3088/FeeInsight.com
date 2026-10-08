import { sql } from "@/lib/data-store/connection";
import { SOURCE_CHECK_RESTORE_PREFIX, SOURCE_CHECK_STRATEGY } from "@/lib/agents/hamilton/source-check";

type SqlTag = typeof sql;

/**
 * Loud failures. On 2026-10-05 OCR failed on every scanned PDF for hours and nothing said
 * so: the read step "completed" and the failures sat inside its counts. These checks look
 * for a step type or a strategy that is mostly failing, and say what and why in plain
 * words, for the banner on the admin home page.
 */

/** Recent window the rates are taken over. */
export const FAILURE_ALERT_WINDOW_MINUTES = 120;
/** A step type or strategy alerts at this failure share or above... */
export const FAILURE_ALERT_MIN_RATE = 0.5;
/** ...once it has failed at least this many times in the window. */
export const FAILURE_ALERT_MIN_FAILURES = 3;
/**
 * Attempt outcomes that mean our own code or build broke, not that a bank's site did
 * (a 404 or a wrong document is the bank's problem and is expected at some rate).
 */
export const BROKEN_ATTEMPT_OUTCOMES = ["parse_error", "error"] as const;
/**
 * A step type whose last this-many finished steps all failed is broken, whatever its
 * share. On 2026-10-08 a deploy broke every Hamilton publish from 12:06, but 38 publishes
 * from before the deploy kept the two-hour share at 12% and no alert fired.
 */
export const FAILURE_STREAK_MIN_FAILURES = 3;
/** How far back a failure streak is looked for. */
export const FAILURE_STREAK_WINDOW_HOURS = 24;

export interface FailureAlert {
  /** Stable key, e.g. `step:read` or `attempt:read.ocr_tesseract`. */
  key: string;
  title: string;
  /** Plain words: what is failing, how often, and the latest reason. */
  message: string;
  failures: number;
  total: number;
  latestAt: string | null;
}

interface StepRateRow {
  step_key: string;
  failed: number;
  total: number;
  latest_error: string | null;
  latest_at: Date | string | null;
}

interface StepStreakRow {
  step_key: string;
  /** Finished steps of this type that failed since its last success. */
  failed: number;
  latest_error: string | null;
  latest_at: Date | string | null;
  since: Date | string | null;
}

interface AttemptRateRow {
  strategy: string;
  stage: string;
  broken: number;
  total: number;
  latest_error: string | null;
  latest_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function reason(text: string | null): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "no reason recorded";
  return clean.length > 220 ? `${clean.slice(0, 219)}…` : clean;
}

function percent(part: number, whole: number): string {
  return `${Math.round((part / Math.max(whole, 1)) * 100)}%`;
}

export function stepAlerts(rows: StepRateRow[]): FailureAlert[] {
  return rows
    .filter((row) => row.failed >= FAILURE_ALERT_MIN_FAILURES && row.failed / Math.max(row.total, 1) >= FAILURE_ALERT_MIN_RATE)
    .map((row) => ({
      key: `step:${row.step_key}`,
      title: `"${row.step_key}" steps are failing`,
      message: `${row.failed} of ${row.total} "${row.step_key}" steps failed in the last ${FAILURE_ALERT_WINDOW_MINUTES / 60} hours (${percent(row.failed, row.total)}). Latest reason: ${reason(row.latest_error)}`,
      failures: row.failed,
      total: row.total,
      latestAt: iso(row.latest_at),
    }));
}

/** Step types whose most recent finished steps have all failed (a break, not bad luck). */
export function stepStreakAlerts(rows: StepStreakRow[]): FailureAlert[] {
  return rows
    .filter((row) => row.failed >= FAILURE_STREAK_MIN_FAILURES)
    .map((row) => ({
      key: `step:${row.step_key}`,
      title: `"${row.step_key}" steps are failing`,
      message: `The last ${row.failed} "${row.step_key}" steps all failed${row.since ? ` (since ${iso(row.since)?.slice(11, 16)} UTC)` : ""}, with none succeeding since. Latest reason: ${reason(row.latest_error)}`,
      failures: row.failed,
      total: row.failed,
      latestAt: iso(row.latest_at),
    }));
}

/** A streak alert and a rate alert on the same step type say one thing: keep the streak. */
export function mergeStepAlerts(streaks: FailureAlert[], rates: FailureAlert[]): FailureAlert[] {
  const keys = new Set(streaks.map((alert) => alert.key));
  return [...streaks, ...rates.filter((alert) => !keys.has(alert.key))];
}

export function attemptAlerts(rows: AttemptRateRow[]): FailureAlert[] {
  return rows
    .filter((row) => row.broken >= FAILURE_ALERT_MIN_FAILURES && row.broken / Math.max(row.total, 1) >= FAILURE_ALERT_MIN_RATE)
    .map((row) => ({
      key: `attempt:${row.strategy}`,
      title: `${row.strategy} is broken`,
      message: `${row.broken} of ${row.total} ${row.stage} attempts with ${row.strategy} errored in the last ${FAILURE_ALERT_WINDOW_MINUTES / 60} hours (${percent(row.broken, row.total)}). Latest reason: ${reason(row.latest_error)}`,
      failures: row.broken,
      total: row.total,
      latestAt: iso(row.latest_at),
    }));
}

/**
 * Coverage: a live fee must be checked against the bank's own schedule soon after it is
 * published. On 2026-10-06, 495 institutions across the states had never been checked
 * because the check ran only in publish steps that named a state. This alert fires for
 * any state with institutions holding a live fee published this long ago and not checked
 * since, so a gap in any state shows on the admin home page instead of waiting for a sample.
 */
export const SOURCE_CHECK_GRACE_HOURS = 12;

interface UncheckedStateRow {
  state_code: string | null;
  institutions: number;
}

export function sourceCheckCoverageAlert(rows: UncheckedStateRow[]): FailureAlert[] {
  const total = rows.reduce((sum, row) => sum + Number(row.institutions), 0);
  if (total === 0) return [];
  const byState = rows
    .map((row) => `${row.state_code || "no state"} ${row.institutions}`)
    .join(", ");
  return [{
    key: "coverage:source_check",
    title: "Live fees are not being checked against bank schedules",
    message: `${total} institution${total === 1 ? "" : "s"} in ${rows.length} state${rows.length === 1 ? "" : "s"} have live fees published over ${SOURCE_CHECK_GRACE_HOURS} hours ago and never checked against the bank's own schedule (${byState}).`,
    failures: total,
    total,
    latestAt: null,
  }];
}

/** Current alerts, most important first. Never throws: a broken check is not an outage. */
export async function getFailureAlerts(db: SqlTag = sql): Promise<FailureAlert[]> {
  try {
    const window = `${FAILURE_ALERT_WINDOW_MINUTES} minutes`;
    const [streaks, steps, attempts, unchecked] = await Promise.all([
      db<StepStreakRow[]>`
        WITH finished AS (
          SELECT step_key, status, error_summary, updated_at,
                 ROW_NUMBER() OVER (PARTITION BY step_key ORDER BY updated_at DESC) AS rn
            FROM agent_run_steps
           WHERE status IN ('completed', 'failed')
             AND updated_at > NOW() - ${`${FAILURE_STREAK_WINDOW_HOURS} hours`}::interval
        ), marked AS (
          SELECT finished.*,
                 MIN(rn) FILTER (WHERE status = 'completed') OVER (PARTITION BY step_key) AS first_ok
            FROM finished
        )
        SELECT step_key,
               COUNT(*)::int AS failed,
               (ARRAY_AGG(error_summary ORDER BY updated_at DESC))[1] AS latest_error,
               MAX(updated_at) AS latest_at,
               MIN(updated_at) AS since
          FROM marked
         WHERE status = 'failed' AND (first_ok IS NULL OR rn < first_ok)
         GROUP BY step_key
      `,
      db<StepRateRow[]>`
        SELECT step_key,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'skipped'))::int AS total,
               (ARRAY_AGG(error_summary ORDER BY updated_at DESC) FILTER (WHERE status = 'failed'))[1] AS latest_error,
               MAX(updated_at) FILTER (WHERE status = 'failed') AS latest_at
          FROM agent_run_steps
         WHERE updated_at > NOW() - ${window}::interval
          GROUP BY step_key
      `,
      db<AttemptRateRow[]>`
        SELECT strategy, MIN(stage) AS stage,
               COUNT(*) FILTER (WHERE outcome = ANY(${[...BROKEN_ATTEMPT_OUTCOMES]}::text[]))::int AS broken,
               COUNT(*)::int AS total,
               (ARRAY_AGG(detail->>'error' ORDER BY created_at DESC)
                  FILTER (WHERE outcome = ANY(${[...BROKEN_ATTEMPT_OUTCOMES]}::text[])))[1] AS latest_error,
               MAX(created_at) FILTER (WHERE outcome = ANY(${[...BROKEN_ATTEMPT_OUTCOMES]}::text[])) AS latest_at
          FROM pipeline_attempts
         WHERE created_at > NOW() - ${window}::interval
         GROUP BY strategy
      `,
      db<UncheckedStateRow[]>`
        SELECT upper(btrim(inst.state_code)) AS state_code, COUNT(*)::int AS institutions
          FROM (
            SELECT fp.institution_id
              FROM published_fee_records fp
              LEFT JOIN LATERAL (
                SELECT MAX(pa.created_at) AS checked_at
                  FROM pipeline_attempts pa
                 WHERE pa.institution_id = fp.institution_id
                   AND pa.stage = 'publish'
                   AND pa.strategy = ${SOURCE_CHECK_STRATEGY.strategy}
                   -- A restore marker is not a check (markRestoredForSourceCheck).
                   AND pa.input_fingerprint NOT LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
              ) last_check ON true
             WHERE fp.rolled_back_at IS NULL
               AND fp.published_at < NOW() - ${`${SOURCE_CHECK_GRACE_HOURS} hours`}::interval
               AND (last_check.checked_at IS NULL OR last_check.checked_at < fp.published_at)
             GROUP BY fp.institution_id
          ) unchecked
          JOIN institution_sources inst ON inst.id = unchecked.institution_id
         GROUP BY 1
         ORDER BY 2 DESC, 1
      `,
    ]);
    return [
      ...sourceCheckCoverageAlert(unchecked),
      ...attemptAlerts(attempts),
      ...mergeStepAlerts(stepStreakAlerts(streaks), stepAlerts(steps)),
    ];
  } catch (error) {
    console.error("getFailureAlerts failed:", error);
    return [];
  }
}
