import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

import type { CandidateDiscoveryResult } from "./discovery";
import { FINDERS } from "./finders";

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

/**
 * The reader of those rows (#2062): the bank's next search learns from its last miss. Each
 * specialist the miss ran that saw nothing at all on the site (outcome `no_candidates`) runs after
 * the others this time, so a search squeezed by the clock spends its time first on specialists
 * that saw candidates, were cut short or never ran. Nothing is dropped, every page found still
 * passes the fee-page check, and the order is the only thing a miss changes, so no miss can
 * replace or clear a link. A miss counts only for the website it searched: one recorded on an
 * older website says nothing about the bank's current site.
 */
export const DEMOTED_MISS_OUTCOMES = new Set(["no_candidates"]);

/** Pure: the specialists (by strategy) a miss ran with nothing to show. */
export function missDemotedStrategies(finders: unknown): string[] {
  if (!Array.isArray(finders)) return [];
  const strategies = new Set<string>();
  for (const finder of finders) {
    if (!finder || typeof finder !== "object") continue;
    const { key, outcome } = finder as { key?: unknown; outcome?: unknown };
    if (typeof key !== "string" || typeof outcome !== "string" || !DEMOTED_MISS_OUTCOMES.has(outcome)) continue;
    const known = (FINDERS as Record<string, { strategy: string }>)[key];
    if (known) strategies.add(known.strategy);
  }
  return [...strategies];
}

function sameWebsite(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && a.trim() !== "" && a.trim() === b.trim();
}

/**
 * Reads each bank's latest search miss and returns, for the banks whose miss searched their
 * current website, the specialists to run last. Never throws: a lesson must not fail the search.
 */
export async function loadSearchMissDemotions(
  db: SqlTag,
  banks: ReadonlyArray<{ id: number | string; website_url: string | null }>,
): Promise<Map<number, string[]>> {
  const demotions = new Map<number, string[]>();
  if (banks.length === 0) return demotions;
  try {
    if (!(await feedbackSchemaReady(db))) return demotions;
    const rows = await inSavepoint(db, (scope) => scope<Array<{ institution_id: number | string; source_url: string | null; finders: string | null }>>`
      -- search-miss lessons for the next search
      SELECT DISTINCT ON (f.institution_id) f.institution_id, f.source_url, (f.evidence->'finders')::text AS finders
        FROM pipeline_feedback f
       WHERE f.kind = 'search_miss'
         AND f.check_name = ${SEARCH_MISS_CHECK}
         AND f.about_stage = 'discover'
         AND f.institution_id = ANY(${banks.map((bank) => Number(bank.id))}::bigint[])
       ORDER BY f.institution_id, f.updated_at DESC, f.id DESC
    `);
    const websites = new Map(banks.map((bank) => [Number(bank.id), bank.website_url]));
    for (const row of rows) {
      const id = Number(row.institution_id);
      if (!sameWebsite(row.source_url, websites.get(id))) continue;
      let finders: unknown = null;
      try {
        finders = row.finders == null ? null : JSON.parse(row.finders);
      } catch {
        finders = null;
      }
      const demoted = missDemotedStrategies(finders);
      if (demoted.length > 0) demotions.set(id, demoted);
    }
    return demotions;
  } catch (error) {
    console.error("loadSearchMissDemotions failed:", error);
    return demotions;
  }
}
