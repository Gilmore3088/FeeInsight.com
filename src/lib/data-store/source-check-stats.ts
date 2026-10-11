import { sql } from "@/lib/data-store/connection";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";

type SqlTag = typeof sql;

/**
 * The measured line on /methodology: what Hamilton's source check (`takeDownUntraceableFees`,
 * which runs `checkFeeAgainstSource` on every live fee) found over the last 7 days. Read from
 * the publish steps' own `step.finished` events (`source_check_fees`, `_traced`, `_relinked`,
 * `_takedowns`), so the page shows the run ledger's numbers and nothing estimated.
 *
 * What it measures, and only that: the fee's name and amount are stated in the bank's own
 * stored schedule. It does not check frequency, the account a fee belongs to, or category, and
 * fees that fail are taken down, so the share is of checks, not a whole-record accuracy score.
 */

export const SOURCE_CHECK_WINDOW_DAYS = 7;

export interface SourceCheckWeek {
  /** Fee checks run in the window (a fee checked twice counts twice). */
  checks: number;
  /** Checks that found the name and amount in the bank's stored schedule (traced or relinked). */
  matched: number;
  /** Live fees taken off the site in the window after failing a second check. */
  takenDown: number;
  /** ISO date (UTC) the window ends: the day of the newest check. */
  through: string;
}

export async function readSourceCheckWeek(db: SqlTag = sql): Promise<SourceCheckWeek | null> {
  try {
    const [row] = await db<
      { checks: string | null; matched: string | null; taken_down: string | null; through: string | null }[]
    >`
      SELECT SUM((detail->>'source_check_fees')::bigint)::text AS checks,
             SUM((detail->>'source_check_traced')::bigint + (detail->>'source_check_relinked')::bigint)::text AS matched,
             SUM((detail->>'source_check_takedowns')::bigint)::text AS taken_down,
             MAX(created_at)::date::text AS through
      FROM agent_run_events
      WHERE event_type = 'step.finished'
        AND created_at > now() - make_interval(days => ${SOURCE_CHECK_WINDOW_DAYS})
        AND detail ? 'source_check_fees'
        AND COALESCE(detail->>'dry_run', 'false') = 'false'`;
    const checks = Number(row?.checks ?? 0);
    if (!row?.through || !Number.isFinite(checks) || checks <= 0) return null;
    return { checks, matched: Number(row.matched ?? 0), takenDown: Number(row.taken_down ?? 0), through: row.through };
  } catch (error) {
    console.error("[source-check-stats] read failed; methodology shows no measured line", error);
    return null;
  }
}

export const getSourceCheckWeek = cachedPublicRead("source-check-week", () => readSourceCheckWeek());

/** One decimal, rounded down, so 99.96% never prints as 100%. */
export function matchedPercent(week: Pick<SourceCheckWeek, "checks" | "matched">): string {
  const share = Math.floor((week.matched / week.checks) * 1000) / 10;
  return share.toFixed(1);
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The measured paragraphs, worded as exactly what the check measures, or null when there is no
 * measurement (nothing is shown rather than a stale or guessed figure).
 */
export function sourceCheckParagraphs(week: SourceCheckWeek | null): string[] | null {
  if (!week || week.checks <= 0) return null;
  const n = (value: number) => value.toLocaleString("en-US");
  return [
    `In the ${SOURCE_CHECK_WINDOW_DAYS} days through ${longDate(week.through)}, ${matchedPercent(week)}% of ${n(week.checks)} fee checks found the fee's name and amount stated in the bank's own published schedule. A fee is checked again whenever its schedule or the check changes, so a fee can be counted more than once.`,
    `A fee that fails is held for a second check and taken off the site if it fails again; ${n(week.takenDown)} ${week.takenDown === 1 ? "fee was" : "fees were"} taken off in that period. Because failures are removed, this figure describes the check, not a share of all fees ever collected.`,
    "The check confirms the name and amount only. It does not confirm how often a fee is charged, which account it applies to, or its category; those are reviewed separately.",
  ];
}
