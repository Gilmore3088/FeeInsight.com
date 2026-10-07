import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

import type { CandidateDiscoveryResult } from "./discovery";

type SqlTag = typeof sql;

/**
 * Link lessons for searches that found nothing. A bank whose search ends `dead` or
 * `needs_human` gets one `pipeline_feedback` row (check `magellan.search_miss`, signal
 * `missed`) per discovery method version: where the search stopped, the website it
 * searched, and what each finder tried. The link ledger only judges links Magellan handed
 * on, so without these a bank Magellan gave up on left no lesson at all. A later search
 * under the same method replaces the row; a new method version writes a new one, so the
 * rows show which banks each method still misses.
 */
export const SEARCH_MISS_CHECK = "magellan.search_miss";
const MISS_OUTCOMES = new Set(["dead", "needs_human"]);

export function searchMissFeedbackRows(
  results: CandidateDiscoveryResult[],
  context: { runId: number | null; method: string; methodVersion: number; websites: Map<number, string | null> },
): FeedbackRow[] {
  return results
    .filter((result) => MISS_OUTCOMES.has(result.outcome))
    .map((result) => ({
      aboutStage: "discover",
      aboutStrategy: context.method,
      aboutVersion: context.methodVersion,
      signal: "missed",
      kind: "search_miss",
      reportedBy: "magellan",
      checkName: SEARCH_MISS_CHECK,
      institutionId: result.institutionId,
      sourceUrl: context.websites.get(result.institutionId) ?? null,
      evidence: {
        outcome: result.outcome,
        code: result.code,
        reason: result.reason,
        attempted_urls: result.attemptedUrls,
        homepage_blocked: result.homepageBlocked,
        moved_to: result.movedTo,
        platform: result.platform,
        finders: result.finders.map((finder) => ({ key: finder.key, outcome: finder.outcome, fetches: finder.fetches, note: finder.note ?? null })),
      },
      runId: context.runId,
      dedupeKey: `${SEARCH_MISS_CHECK}:${result.institutionId}:v${context.methodVersion}`,
    }));
}

/** Writes the step's search misses. Never throws: lessons must not fail the search. */
export async function recordSearchMisses(
  db: SqlTag,
  results: CandidateDiscoveryResult[],
  context: { runId: number | null; method: string; methodVersion: number; websites: Map<number, string | null> },
): Promise<number> {
  const rows = searchMissFeedbackRows(results, context);
  if (rows.length === 0) return 0;
  try {
    if (!(await feedbackSchemaReady(db))) return 0;
    return await inSavepoint(db, (scope) => recordFeedback(scope, rows));
  } catch (error) {
    console.error("recordSearchMisses failed:", error);
    return 0;
  }
}
