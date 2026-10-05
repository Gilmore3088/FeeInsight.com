import { sql } from "@/lib/data-store/connection";

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

/** Current alerts, most important first. Never throws: a broken check is not an outage. */
export async function getFailureAlerts(db: SqlTag = sql): Promise<FailureAlert[]> {
  try {
    const window = `${FAILURE_ALERT_WINDOW_MINUTES} minutes`;
    const [steps, attempts] = await Promise.all([
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
    ]);
    return [...attemptAlerts(attempts), ...stepAlerts(steps)];
  } catch (error) {
    console.error("getFailureAlerts failed:", error);
    return [];
  }
}
