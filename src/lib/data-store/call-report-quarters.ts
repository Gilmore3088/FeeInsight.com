import { getSql } from "./connection";

/**
 * call_report_quarterly_income holds every fdic/ncua call-report filing with its standalone
 * quarter already split out (migration 20270110000073; built by Hoovie's
 * registry-call-report-summaries step after each quarterly load). The call-report readers read
 * it instead of recomputing quarters from institution_financial_records on every request.
 *
 * Until the first build has run (migration applied but the step not yet run, or the pipeline
 * paused), the table is missing or empty; the readers then fall back to the per-request SQL in
 * call-reports-legacy.ts, which returns the same numbers more slowly, and say so in the log.
 */
export const CALL_REPORT_QUARTERS_TABLE = "call_report_quarterly_income";

/** How long one answer about readiness is trusted before asking the database again. */
const READY_CACHE_MS = 5 * 60_000;
/** At most one fallback warning per process in this window, so a busy page does not flood the log. */
const WARN_EVERY_MS = 10 * 60_000;

type Db = { unsafe: (query: string, params?: never[]) => Promise<unknown> };

let cached: { ready: boolean; at: number } | null = null;
let lastWarnAt = 0;

function warnFallback(reason: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = now;
  console.warn(
    `[call-reports] ${CALL_REPORT_QUARTERS_TABLE} ${reason}; reading institution_financial_records ` +
      "per request (slow path) until Hoovie's registry-call-report-summaries step builds it.",
  );
}

/** True when the summary table exists and holds rows; false (and a logged warning) otherwise. */
export async function callReportQuartersReady(db: Db = getSql() as unknown as Db): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < READY_CACHE_MS) {
    if (!cached.ready) warnFallback("is empty");
    return cached.ready;
  }
  let ready = false;
  let reason = "is empty";
  try {
    const rows = (await db.unsafe(
      `SELECT EXISTS (SELECT 1 FROM ${CALL_REPORT_QUARTERS_TABLE}) AS ready`,
    )) as Array<{ ready: boolean }>;
    ready = Boolean(rows[0]?.ready);
  } catch (error) {
    reason = `could not be read (${error instanceof Error ? error.message : String(error)})`;
  }
  cached = { ready, at: now };
  if (!ready) warnFallback(reason);
  return ready;
}

/** Test seam: forget the cached readiness answer. */
export function resetCallReportQuartersReady(): void {
  cached = null;
  lastWarnAt = 0;
}
