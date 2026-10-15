import type { sql } from "@/lib/data-store/connection";
import { refileCategory } from "@/lib/fee-category-guard";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";

type SqlTag = typeof sql;

/**
 * A Knox category change is a reason for Darwin to judge a row again (#1295): new category, new
 * decision. Darwin does not judge a raw row twice at one `verify.rules` version, so a row it
 * rejected under one category stayed rejected after Knox re-filed it under another: raw 126752,
 * "Wire Transfer - International" $45, was rejected as an overdraft fee on every run from Oct 5 to
 * Oct 14 after a re-read filed it `wire_intl_outgoing`.
 *
 * A row qualifies only when all of these hold:
 * - Knox marked it as re-read under a possibly new category: a take-over (`knox_reread_took_over`),
 *   a repaired stale category flag (`knox_stale_hint_repaired`) or a re-file
 *   (`knox_refiled_from:<old>`, #1291). The marker is required: without it, a row Darwin itself
 *   re-filed (`refileCategory`, "Collection Items" filed `collection_item` and judged as
 *   `check_cashing`) looks like a category change and is not one (86 such rows, Oct 14);
 * - it is waiting for Darwin (`needs_darwin_verification`), is not verified, and has at least one
 *   `verify.rules` decision at the current version;
 * - no decision was made under the category Knox gives it today, and each decision was made under
 *   an earlier Knox category: `knox_category` on the decision (recorded from this change on), or,
 *   for older decisions, proof from the row's flags (`categoryChangedSinceDecision`). A decision
 *   judged under an older Darwin re-file of today's category is not a Knox change (raw 132922).
 *
 * Every row that qualifies is judged by the same free checks as any other row, the shared source
 * check (`checkFeeAgainstSource`) among them; its new decision records today's category, so it is
 * judged once per category.
 *
 * Off by default: judging these rows can publish fees. While off, each verify step reads the
 * candidates and writes their count and a sample to its ledger detail (`category_change_rejudge`)
 * and changes nothing. A one-line PR turns it on after James's yes.
 */
export const DARWIN_CATEGORY_CHANGE_REJUDGE_LIVE = false;
/** Rows judged again per verify step when the switch is on. */
export const DARWIN_CATEGORY_CHANGE_LIMIT = 100;
/** Rows listed in the step's ledger detail for a hand check. */
export const DARWIN_CATEGORY_CHANGE_SAMPLE = 25;
/** Rows read per step to count candidates; the count says when it was cut short. */
export const DARWIN_CATEGORY_CHANGE_SCAN = 2000;

/** Knox's markers for a row read again under a possibly new category. */
export const KNOX_CATEGORY_CHANGE_FLAGS = ["knox_reread_took_over", "knox_stale_hint_repaired"] as const;
export const KNOX_REFILED_FROM_PREFIX = "knox_refiled_from:";

/** One earlier `verify.rules` decision on the row. */
export interface PriorDecision {
  /** The category Darwin judged the row under (Knox's category after Darwin's re-file). */
  canonical_fee_key: string | null;
  /** Knox's category when Darwin judged it; recorded from #1295 on, absent before. */
  knox_category?: string | null;
  reason_code: string | null;
  decided_at?: string | null;
}

export interface CategoryChangeRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  fee_name: string;
  amount: number | string | null;
  outlier_flags: unknown;
  conditions: string | null;
  attempts: PriorDecision[] | string | null;
}

export interface CategoryChangeCandidate {
  feeRawId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  /** The category Knox gives the row today. */
  category: string;
  /** The category of Darwin's latest decision. */
  judgedAs: string | null;
  /** Knox's old category from a `knox_refiled_from:` marker, when there is one. */
  refiledFrom: string | null;
  /** Reason codes of the earlier decisions, newest first. */
  reasons: string[];
}

export interface CategoryChangeRejudgeSummary {
  live: boolean;
  /** Rows that qualify, among those read. */
  candidates: number;
  candidateInstitutions: number;
  /** Rows the SQL selection read (marked, waiting, decided, none under today's raw category). */
  scanned: number;
  /** True when the read hit `DARWIN_CATEGORY_CHANGE_SCAN`, so `candidates` is a floor. */
  truncated: boolean;
  /** Earlier decision reasons of the candidates. */
  reasonCounts: Record<string, number>;
  /** Rows handed to this step's batch (0 while the switch is off). */
  selected: number;
  sample: Array<{
    fee_raw_id: number;
    institution_id: number;
    fee_name: string;
    amount: number | null;
    category_now: string;
    judged_as: string | null;
    refiled_from: string | null;
    reasons: string[];
  }>;
}

function parseAttempts(value: CategoryChangeRow["attempts"]): PriorDecision[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as PriorDecision[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function flagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      return flagsOf(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

/** True when Knox marked the row as read again under a possibly new category. */
export function hasCategoryChangeMarker(outlierFlags: unknown): boolean {
  return flagsOf(outlierFlags).some(
    (flag) => (KNOX_CATEGORY_CHANGE_FLAGS as readonly string[]).includes(flag) || flag.startsWith(KNOX_REFILED_FROM_PREFIX),
  );
}

/**
 * What the row's flags prove about Knox's category before today's. `knox_refiled_from:<old>` and
 * `knox_stale_hint_repaired` are written when Knox's category changes on a row Darwin judged
 * before the change (a retired row is never judged; a stale flag was the first one, the one
 * Darwin read), so every decision recorded before `knox_category` existed was made under an
 * earlier Knox category. On a plain take-over the old flags may be gone, so only a decision
 * whose judged category is another `canonical_hint:` flag still on the row is proof.
 */
function earlierKnoxCategories(outlierFlags: unknown, categoryNow: string): { all: boolean; known: Set<string> } {
  const flags = flagsOf(outlierFlags);
  const known = new Set<string>();
  for (const flag of flags) {
    if (flag.startsWith(KNOX_REFILED_FROM_PREFIX)) known.add(flag.slice(KNOX_REFILED_FROM_PREFIX.length).trim());
    if (flag.startsWith("canonical_hint:")) known.add(flag.slice("canonical_hint:".length).trim());
  }
  known.delete(categoryNow);
  const all = flags.some((flag) => flag === "knox_stale_hint_repaired" || flag.startsWith(KNOX_REFILED_FROM_PREFIX));
  return { all, known };
}

/**
 * True when every earlier decision was made under an earlier Knox category and none under the one
 * Knox gives the row today. A decision that recorded `knox_category` says which. One recorded
 * before that needs proof from the row's flags (`earlierKnoxCategories`): without it, the decision
 * may be Darwin's own re-file of today's category under an older guard (raw 132922, "Collection
 * Items (plus any bank fees)" $20: Knox `collection_item`, judged `check_cashing`, while today's
 * `refileCategory` keeps `collection_item`), and the row is left alone. A decision judged under
 * today's category or today's re-file of it always ends it. No earlier decision, nothing to redo.
 */
export function categoryChangedSinceDecision(
  categoryNow: string | null,
  feeName: string,
  decisions: readonly PriorDecision[],
  outlierFlags: unknown = [],
): boolean {
  if (!categoryNow || decisions.length === 0) return false;
  const judgedNow = new Set([categoryNow, refileCategory(categoryNow, feeName)].filter(Boolean));
  const earlier = earlierKnoxCategories(outlierFlags, categoryNow);
  return decisions.every((decision) => {
    if (decision.canonical_fee_key != null && judgedNow.has(decision.canonical_fee_key)) return false;
    if (decision.knox_category) return decision.knox_category !== categoryNow;
    return earlier.all || (decision.canonical_fee_key != null && earlier.known.has(decision.canonical_fee_key));
  });
}

/** The candidates among selected rows, given the row's category today (Darwin's `canonicalHintFrom`). */
export function categoryChangeCandidates(
  rows: readonly CategoryChangeRow[],
  categoryOf: (row: CategoryChangeRow) => string | null,
): CategoryChangeCandidate[] {
  const candidates: CategoryChangeCandidate[] = [];
  for (const row of rows) {
    if (!hasCategoryChangeMarker(row.outlier_flags)) continue;
    const decisions = parseAttempts(row.attempts);
    const category = categoryOf(row);
    if (!category || !categoryChangedSinceDecision(category, row.fee_name, decisions, row.outlier_flags)) continue;
    const refiledFrom = flagsOf(row.outlier_flags)
      .find((flag) => flag.startsWith(KNOX_REFILED_FROM_PREFIX))
      ?.slice(KNOX_REFILED_FROM_PREFIX.length) ?? null;
    const amount = row.amount == null || row.amount === "" ? null : Number(row.amount);
    candidates.push({
      feeRawId: Number(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      category,
      judgedAs: decisions[0]?.canonical_fee_key ?? null,
      refiledFrom,
      reasons: decisions.map((decision) => decision.reason_code ?? "verified"),
    });
  }
  return candidates;
}

export function summarizeCategoryChange(
  candidates: readonly CategoryChangeCandidate[],
  scanned: number,
  selected: number,
  live: boolean,
): CategoryChangeRejudgeSummary {
  const reasonCounts: Record<string, number> = {};
  for (const candidate of candidates) {
    for (const reason of new Set(candidate.reasons)) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    live,
    candidates: candidates.length,
    candidateInstitutions: new Set(candidates.map((candidate) => candidate.institutionId)).size,
    scanned,
    truncated: scanned >= DARWIN_CATEGORY_CHANGE_SCAN,
    reasonCounts,
    selected,
    sample: candidates.slice(0, DARWIN_CATEGORY_CHANGE_SAMPLE).map((candidate) => ({
      fee_raw_id: candidate.feeRawId,
      institution_id: candidate.institutionId,
      fee_name: candidate.feeName,
      amount: candidate.amount,
      category_now: candidate.category,
      judged_as: candidate.judgedAs,
      refiled_from: candidate.refiledFrom,
      reasons: candidate.reasons,
    })),
  };
}

/**
 * Read-only: rows Knox marked as re-read, waiting for Darwin, decided at least once at this rule
 * version, and never decided under their first `canonical_hint:` today. The final test (Darwin's
 * own re-file, a category stated only in `conditions`) is `categoryChangeCandidates`.
 * 0.7 s on production on Oct 14 (EXPLAIN ANALYZE).
 */
export function selectCategoryChangeRows(
  db: SqlTag,
  options: { strategy: string; version: number; institutionId?: number; stateCode?: string; scan?: number },
): Promise<CategoryChangeRow[]> {
  const params: Array<number | string | string[]> = [
    options.scan ?? DARWIN_CATEGORY_CHANGE_SCAN,
    options.strategy,
    options.version,
    [...KNOX_CATEGORY_CHANGE_FLAGS],
    `${KNOX_REFILED_FROM_PREFIX}%`,
  ];
  const filters: string[] = [];
  if (options.institutionId) {
    params.push(options.institutionId);
    filters.push(`AND fr.institution_id = $${params.length}`);
  }
  const state = normalizeStateCode(options.stateCode);
  if (state) {
    params.push(state);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  return db.unsafe<CategoryChangeRow[]>(
    `
      SELECT fr.fee_raw_id,
             fr.institution_id,
             fr.fee_name,
             fr.amount,
             fr.outlier_flags,
             COALESCE(fr.extraction_note, fr.conditions) AS conditions,
             att.attempts
        FROM raw_fee_observations fr
        JOIN institution_sources inst ON inst.id = fr.institution_id
        CROSS JOIN LATERAL (
          SELECT substring(f FROM 'canonical_hint:(.*)') AS hint
            FROM jsonb_array_elements_text(fr.outlier_flags) WITH ORDINALITY AS t(f, o)
           WHERE f LIKE 'canonical_hint:%'
           ORDER BY o
           LIMIT 1
        ) first_hint
        CROSS JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
                   'canonical_fee_key', pa.detail->>'canonical_fee_key',
                   'knox_category', pa.detail->>'knox_category',
                   'reason_code', pa.detail->>'reason_code',
                   'decided_at', pa.created_at
                 ) ORDER BY pa.created_at DESC) AS attempts,
                 bool_or(pa.detail->>'canonical_fee_key' = first_hint.hint
                         OR pa.detail->>'knox_category' = first_hint.hint) AS judged_under_current
            FROM pipeline_attempts pa
           WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
             AND pa.strategy = $2
             AND pa.strategy_version = $3
        ) att
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT (fr.outlier_flags ? 'audience_correction_required')
         AND (fr.outlier_flags ?| $4::text[]
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(fr.outlier_flags) marker WHERE marker LIKE $5))
         AND att.attempts IS NOT NULL
         AND NOT COALESCE(att.judged_under_current, false)
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
         ${filters.join("\n         ")}
       ORDER BY fr.fee_raw_id
       LIMIT $1
    `,
    params,
  );
}
