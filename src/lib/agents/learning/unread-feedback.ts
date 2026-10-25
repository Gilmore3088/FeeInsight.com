import { sql } from "@/lib/data-store/connection";
import {
  UNREAD_FEEDBACK_MIN_AGE_HOURS,
  UNREAD_FEEDBACK_WINDOW_DAYS,
  unreadFeedbackPredicate,
} from "./feedback-kinds";

type SqlTag = typeof sql;

/**
 * The morning brief's count of error rows no agent reads (#2062): `wrong` or `missed` rows with
 * weight, older than two days and from the last month, whose kind is registered as unread, is not
 * registered at all, or is read only at other stages or from other checks (`feedback-kinds.ts`).
 * Read-only, and bounded by a statement timeout so the brief never waits on it.
 */
export interface UnreadFeedbackSummary {
  total: number;
  /** Largest first. */
  byKind: Array<{ kind: string; stage: string; rows: number }>;
}

export async function readUnreadFeedback(db: SqlTag = sql): Promise<UnreadFeedbackSummary> {
  const { unreadKinds, partial, registered } = unreadFeedbackPredicate();
  const rows = await db.begin(async (scope) => {
    const tx = scope as unknown as SqlTag;
    await tx`SELECT set_config('statement_timeout', '20000', true)`;
    return tx<Array<{ kind: string; about_stage: string; rows: number | string }>>`
      WITH partial AS (
        SELECT kind, NULLIF(stages, '') AS stages, NULLIF(checks, '') AS checks
          FROM unnest(${partial.map((item) => item.kind)}::text[],
                      ${partial.map((item) => (item.stages ?? []).join(","))}::text[],
                      ${partial.map((item) => item.checks.join(","))}::text[]) AS p(kind, stages, checks)
      )
      SELECT f.kind, f.about_stage, COUNT(*)::int AS rows
        FROM pipeline_feedback f
        LEFT JOIN partial p ON p.kind = f.kind
       WHERE f.created_at >= NOW() - make_interval(days => ${UNREAD_FEEDBACK_WINDOW_DAYS}::int)
         AND f.created_at < NOW() - make_interval(hours => ${UNREAD_FEEDBACK_MIN_AGE_HOURS}::int)
         AND f.signal IN ('wrong', 'missed')
         AND f.weight > 0
         AND (
           f.kind = ANY(${unreadKinds}::text[])
           -- A kind outside the registry, except the takedown sync's extract rows (restore detection).
           OR (f.kind <> ALL(${registered}::text[]) AND COALESCE(f.dedupe_key, '') NOT LIKE 'hamilton.takedown:pub:%:extract')
           OR (p.kind IS NOT NULL AND (
                (p.stages IS NOT NULL AND f.about_stage <> ALL(string_to_array(p.stages, ',')))
                OR (p.checks IS NOT NULL AND f.check_name = ANY(string_to_array(p.checks, ',')))
              ))
         )
       GROUP BY f.kind, f.about_stage
       ORDER BY rows DESC, f.kind
    `;
  });
  const byKind = rows.map((row) => ({ kind: row.kind, stage: row.about_stage, rows: Number(row.rows) }));
  return { total: byKind.reduce((sum, row) => sum + row.rows, 0), byKind };
}

/** Pure: the brief's line. Always one line, so a day with none reads as zero, not as missing. */
export function unreadFeedbackLines(summary: UnreadFeedbackSummary | null | undefined, shown = 5): string[] {
  if (!summary) return [];
  const window = `last ${UNREAD_FEEDBACK_WINDOW_DAYS} days, older than ${UNREAD_FEEDBACK_MIN_AGE_HOURS} hours`;
  if (summary.total === 0) return [`Error rows no agent reads (${window}): none.`];
  const top = summary.byKind.slice(0, shown).map((row) => `${row.kind} at ${row.stage} ${row.rows.toLocaleString("en-US")}`);
  const more = summary.byKind.length > shown ? `, and ${summary.byKind.length - shown} more kinds` : "";
  return [`Error rows no agent reads (${window}): ${summary.total.toLocaleString("en-US")}: ${top.join(", ")}${more}.`];
}
