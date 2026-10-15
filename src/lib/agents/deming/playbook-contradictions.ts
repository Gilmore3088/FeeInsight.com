import { sql } from "@/lib/data-store/connection";
import { THIN_DOCUMENT_MAX_FEES } from "@/lib/agents/thin-document";
import { PAID_MIN_PRICED_LINES } from "@/lib/agents/knox/paid-extract";
import { SECOND_DOCUMENT_FINDER, SITE_SEARCH_STRATEGY } from "@/lib/agents/magellan/second-document";

/**
 * Deming's daily check of each institution's playbook against itself (#1105): the learning
 * core's per-institution memory (`institution_source_profiles`) should not contradict itself.
 * Read-only: one SELECT, nothing written but the step's own ledger detail. No model calls.
 *
 * A contradiction is counted per institution:
 * - `source_rejected`: the current source address is on the playbook's own rejected list.
 * - `source_unfetchable`: the current source is on its do-not-retry list for a fetch failure
 *   (too large, gone), so no stage can read it again.
 * - `source_judged_wrong`: a discovery strategy judged the current source itself the wrong
 *   document. Not counted for the search-from strategies (`SEARCH_FROM_STRATEGIES`): the
 *   second-document finder and its site searches record the bank's current link as the input
 *   they searched *from*, so their `wrong_document` / `no_candidates` means "found nothing
 *   better", not "this link is wrong" (Oct 15: 1,758 playbooks carry such an entry, Space Coast
 *   8109 among them). They are reported as `search_from_entries`, not as contradictions.
 * - `schedule_expects_few`: the current text is a fee schedule (Rosetta's kind) but the playbook
 *   expects fewer than THIN_DOCUMENT_MAX_FEES fees from it.
 * - `product_page_expects_many`: the current text is a product page but the playbook expects at
 *   least PAID_MIN_PRICED_LINES fees, a whole schedule's worth.
 * - `layout_never_recorded`: the institution has a completed current text and no layout
 *   fingerprint. A pile to report, not a per-bank error: no stage writes the field yet.
 */

type SqlTag = typeof sql;

export const PLAYBOOK_CHECK_VERSION = 1;
/** Institutions listed per check in the step detail. */
export const PLAYBOOK_CHECK_SAMPLE = 20;
/** Strategies whose do-not-retry fingerprint is the link they searched from, not a document they judged. */
export const SEARCH_FROM_STRATEGIES: readonly string[] = [SECOND_DOCUMENT_FINDER.strategy, SITE_SEARCH_STRATEGY.strategy];

export const PLAYBOOK_CHECKS = [
  "source_rejected",
  "source_unfetchable",
  "source_judged_wrong",
  "schedule_expects_few",
  "product_page_expects_many",
] as const;
export type PlaybookCheck = (typeof PLAYBOOK_CHECKS)[number];

export interface PlaybookContradictionsResult {
  version: number;
  ready: boolean;
  profiles: number;
  /** Institutions per contradiction. */
  counts: Record<PlaybookCheck, number>;
  /** Up to PLAYBOOK_CHECK_SAMPLE institution ids per contradiction, lowest first. */
  samples: Record<PlaybookCheck, number[]>;
  /** Institutions with at least one contradiction. */
  institutions: number;
  /** Playbooks carrying a search-from entry on their current source (not a contradiction). */
  searchFromEntries: number;
  layoutNeverRecorded: number;
}

interface CountsRow {
  profiles: number | string;
  any_contradiction: number | string;
  search_from_entries: number | string;
  layout_never_recorded: number | string;
  [key: string]: unknown;
}

/** The check's one read. Exported for the SQL test. */
export function playbookContradictionsSql(): string {
  const counts = PLAYBOOK_CHECKS.map((check) => `COUNT(*) FILTER (WHERE ${check}) AS ${check}`).join(",\n             ");
  const samples = PLAYBOOK_CHECKS.map(
    (check) => `(array_agg(institution_id ORDER BY institution_id) FILTER (WHERE ${check}))[1:$4] AS ${check}_sample`,
  ).join(",\n             ");
  return `
      WITH profile AS (
        SELECT p.institution_id,
               p.canonical_source_url AS source,
               CASE WHEN jsonb_typeof(p.rejected_source_urls) = 'array' THEN p.rejected_source_urls ELSE '[]'::jsonb END AS rejected,
               CASE WHEN jsonb_typeof(p.do_not_retry) = 'array' THEN p.do_not_retry ELSE '[]'::jsonb END AS do_not_retry,
               p.expected_fee_count,
               p.layout_fingerprint,
               adt.id AS text_id,
               adt.document_kind
          FROM institution_source_profiles p
          LEFT JOIN agent_source_texts adt ON adt.id = p.last_successful_text_id AND adt.status = 'completed'
      ), flags AS (
        SELECT institution_id,
               (source IS NOT NULL AND rejected ? source) AS source_rejected,
               (source IS NOT NULL AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(do_not_retry) entry
                  WHERE entry->>'fingerprint' = source AND entry->>'stage' = 'fetch')) AS source_unfetchable,
               (source IS NOT NULL AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(do_not_retry) entry
                  WHERE entry->>'fingerprint' = source AND entry->>'stage' = 'discover'
                    AND entry->>'outcome' = 'wrong_document'
                    AND NOT (entry->>'strategy' = ANY($1::text[])))) AS source_judged_wrong,
               (source IS NOT NULL AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(do_not_retry) entry
                  WHERE entry->>'fingerprint' = source AND entry->>'strategy' = ANY($1::text[]))) AS search_from_entry,
               (document_kind = 'fee_schedule' AND expected_fee_count IS NOT NULL AND expected_fee_count < $2::int) AS schedule_expects_few,
               (document_kind = 'product_page' AND expected_fee_count IS NOT NULL AND expected_fee_count >= $3::int) AS product_page_expects_many,
               (text_id IS NOT NULL AND layout_fingerprint IS NULL) AS layout_never_recorded
          FROM profile
      )
      SELECT COUNT(*) AS profiles,
             COUNT(*) FILTER (WHERE ${PLAYBOOK_CHECKS.join(" OR ")}) AS any_contradiction,
             COUNT(*) FILTER (WHERE search_from_entry) AS search_from_entries,
             COUNT(*) FILTER (WHERE layout_never_recorded) AS layout_never_recorded,
             ${counts},
             ${samples}
        FROM flags
    `;
}

function emptyRecord<T>(value: () => T): Record<PlaybookCheck, T> {
  return Object.fromEntries(PLAYBOOK_CHECKS.map((check) => [check, value()])) as Record<PlaybookCheck, T>;
}

/** The check, read-only. A missing table reads as not ready rather than failing the scoreboard run. */
export async function runPlaybookContradictions({ db = sql }: { db?: SqlTag } = {}): Promise<PlaybookContradictionsResult> {
  const empty: PlaybookContradictionsResult = {
    version: PLAYBOOK_CHECK_VERSION,
    ready: false,
    profiles: 0,
    counts: emptyRecord(() => 0),
    samples: emptyRecord(() => [] as number[]),
    institutions: 0,
    searchFromEntries: 0,
    layoutNeverRecorded: 0,
  };
  const [ready] = await db<Array<{ ready: boolean }>>`
    SELECT to_regclass('institution_source_profiles') IS NOT NULL
       AND to_regclass('agent_source_texts') IS NOT NULL AS ready
  `;
  if (!ready?.ready) return empty;
  const [row] = await db.unsafe<CountsRow[]>(playbookContradictionsSql(), [
    [...SEARCH_FROM_STRATEGIES],
    THIN_DOCUMENT_MAX_FEES,
    PAID_MIN_PRICED_LINES,
    PLAYBOOK_CHECK_SAMPLE,
  ]);
  if (!row) return { ...empty, ready: true };
  const sample = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);
  return {
    version: PLAYBOOK_CHECK_VERSION,
    ready: true,
    profiles: Number(row.profiles ?? 0),
    counts: Object.fromEntries(PLAYBOOK_CHECKS.map((check) => [check, Number(row[check] ?? 0)])) as Record<PlaybookCheck, number>,
    samples: Object.fromEntries(PLAYBOOK_CHECKS.map((check) => [check, sample(row[`${check}_sample`])])) as Record<PlaybookCheck, number[]>,
    institutions: Number(row.any_contradiction ?? 0),
    searchFromEntries: Number(row.search_from_entries ?? 0),
    layoutNeverRecorded: Number(row.layout_never_recorded ?? 0),
  };
}

const CHECK_TEXT: Record<PlaybookCheck, string> = {
  source_rejected: "current source on its own rejected list",
  source_unfetchable: "current source on its own do-not-retry list for a fetch failure",
  source_judged_wrong: "current source judged the wrong document",
  schedule_expects_few: "a fee schedule expected to hold fewer than 5 fees",
  product_page_expects_many: "a product page expected to hold a whole schedule",
};

export function summarizePlaybookContradictions(result: PlaybookContradictionsResult): string {
  if (!result.ready) return "Deming could not check the playbooks: the playbook table is not there.";
  const found = PLAYBOOK_CHECKS.filter((check) => result.counts[check] > 0)
    .map((check) => `${result.counts[check].toLocaleString("en-US")} ${CHECK_TEXT[check]}`);
  const lead = found.length === 0
    ? `Deming checked ${result.profiles.toLocaleString("en-US")} playbooks: none contradicts itself`
    : `Deming checked ${result.profiles.toLocaleString("en-US")} playbooks: ${result.institutions.toLocaleString("en-US")} contradict themselves (${found.join("; ")})`;
  return `${lead}. ${result.searchFromEntries.toLocaleString("en-US")} carry a second-document search entry on their current link (not a contradiction), and ${result.layoutNeverRecorded.toLocaleString("en-US")} have no layout recorded.`;
}

export function playbookContradictionsDetail(result: PlaybookContradictionsResult) {
  return {
    version: result.version,
    ready: result.ready,
    profiles: result.profiles,
    institutions: result.institutions,
    counts: result.counts,
    samples: result.samples,
    search_from_entries: result.searchFromEntries,
    layout_never_recorded: result.layoutNeverRecorded,
  };
}
