import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { FEE_TEXT_LIGATURE_WORDS, LIGATURE_CANDIDATES, REPLACEMENT_CHARACTER } from "@/lib/agents/rosetta/glyph-repair";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { pricePrints, sameLineExcerptSql } from "@/lib/agents/hamilton/same-line-read";
import { publishNameHold, publishedFeeName } from "@/lib/agents/hamilton/publish";
import { restoreTarget } from "@/lib/agents/hamilton/category-guard";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { productKeySql } from "@/lib/fee-product";
import { CHANNEL_WORDS, NEGATED_STANDARD_WORDS, STANDARD_WORDS, statesWireChannel, WIRE_CHANNEL_CATEGORIES } from "@/lib/wire-channel";

type SqlTag = typeof sql;

/**
 * Hamilton's live name refresh (#1912). Knox re-reads a document and names a live fee's own
 * printed line better than the live row does, but nothing carried that name to the live fee:
 * - publish refuses the re-read as a second read of the live fee's line (`same-line-read.ts`) or
 *   skips it as identical to the live fee (same category and price, one name's words inside the
 *   other's), and both are right: publishing it would show the line twice;
 * - Knox's name re-tidy (`knox/name-retidy.ts`) repairs a live name's shape from the name alone,
 *   and leaves a glyph inside a word for "a re-read" (`junkStrippedName`), which never came.
 * So Dutrac's (7711) wires kept their names without the channel Knox v135 reads ("$55.00 - phone
 * request"), and 14 live names kept U+FFFD after Rosetta's glyph repair (#2598) had restored their
 * texts: 140286 "Wire Interna�onal Transfer-Remote Outgoing" hides "International" from the
 * category guard and stays filed as a domestic wire.
 *
 * A live fee takes its re-read's name in place only when all of these hold:
 * - the re-read is a newer raw read of the live fee's own document at the same amount, variant,
 *   audience and product, verified and not itself live;
 * - it reads the same printed line: its stored line is printed once in the document's newest
 *   completed text and prices the amount once (`pricePrints`), and the live read's stored line is
 *   that line, up to repaired glyphs or a wider window (`sameLine`);
 * - no frequency differs (`frequencyClass`), and the re-read keeps the live category or files the
 *   new name where the category guard re-files it from the live category (`refileCategory`);
 * - the new name is a strict improvement of a known kind (`nameImprovement`): every changed word is
 *   the old word with its unknown glyphs or dropped ligatures restored, or, for a wire, the old
 *   name's words are all kept in order and the added words state a channel (`statesWireChannel`);
 * - publish would not hold the name (`publishNameHold`), the guard accepts it under the re-read's
 *   category, `checkFeeAgainstSource` traces it at the amount in the newest text, exactly one new
 *   name passes for the fee, and no other live fee of the bank shows that name at that price.
 * Anything else keeps the live name, as before. The rename changes only `fee_name`: a fee whose
 * repaired name the category guard now fails ("International" on a domestic wire) is re-judged by
 * the guard's own live pass (`category-guard.ts`), not here. That pass moves it where a guard re-file
 * rule names a home (`restoreTarget`); otherwise its second look takes it down, and the re-read, a
 * verified row under the right category, publishes in its place. Guard v101 has no domestic to
 * international wire move, so 140286 takes the second path.
 *
 * Shadow first (CLAUDE.md standing rule), now on: since 2026-10-31 (James, "Turn on all 7" on the
 * decision card, #2072; 6 of 6 renames traced on the bank's newest text) the refresh writes unless
 * `LIVE_NAME_REFRESH_LIVE` is set to false, 0 or off (the roll-back), and never in a dry run; off,
 * it reports what it would rename.
 * Each rename logs the old and new name in `pipeline_feedback` (kind `live_name_refreshed`) and an
 * agent run event. Dry run, prod read-only, 2026-10-27: docs/project/findings/2026-10-27-live-name-refresh.md.
 */
export const LIVE_NAME_REFRESH_CHECK = "hamilton.live_name_refresh";
export const LIVE_NAME_REFRESH_VERSION = 1;
/** The environment switch: unset or any value but false, 0 or off renames; those report only. */
export const LIVE_NAME_REFRESH_ENV = "LIVE_NAME_REFRESH_LIVE";
export const LIVE_NAME_REFRESHED_KIND = "live_name_refreshed";
/** Candidate pairs read per step (197 on prod, Oct 27; the cap is a guard). */
export const LIVE_NAME_REFRESH_LIMIT = 500;
/**
 * The full read joins every live fee to its document's newer reads: 23 s on prod (Oct 27, 197 pairs
 * of 86,044 live flat fees), so a step reads at most this often. Re-reads land in batches.
 */
export const LIVE_NAME_REFRESH_INTERVAL_HOURS = 6;
export const LIVE_NAME_REFRESH_SAMPLES = 20;
/** Added words a channel clause may carry ("not in person", "phone request"). */
const MAX_CLAUSE_WORDS = 5;
/** Glyphs one word may carry, as Rosetta's repair allows. */
const MAX_GLYPHS_PER_WORD = 2;
/** A widened window counts as the same line only when the shorter one says this much. */
const MIN_LINE_SKELETON = 12;

export function liveNameRefreshOn(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[LIVE_NAME_REFRESH_ENV];
  if (raw == null || raw.trim() === "") return true;
  return !["false", "0", "off"].includes(raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase());
}

export type NameImprovement = "glyph_repair" | "channel_clause";

export type LiveNameRefreshOutcome =
  | "refresh"
  | "no_text"
  | "not_an_improvement"
  | "frequency_differs"
  | "category_differs"
  | "not_same_line"
  | "name_hold"
  | "category_guard"
  | "untraced"
  | "ambiguous"
  | "same_name_live";

export interface LiveNameRefreshSameAmount {
  fee_published_id: number | string;
  fee_name: string | null;
  canonical_fee_key: string | null;
}

export interface LiveNameRefreshRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string;
  canonical_fee_key: string;
  amount: number | string | null;
  frequency: string | null;
  source_document_id: number | string | null;
  live_excerpt: string | null;
  reread_raw_id: number | string;
  reread_verified_id: number | string;
  reread_name: string;
  reread_key: string;
  reread_frequency: string | null;
  reread_excerpt: string | null;
  document_text_id: number | string | null;
  normalized_text: string | null;
  same_amount: LiveNameRefreshSameAmount[] | string | null;
}

export interface LiveNameRefreshVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  amount: number | null;
  canonicalFeeKey: string;
  oldName: string;
  outcome: LiveNameRefreshOutcome;
  newName?: string;
  improvement?: NameImprovement;
  rereadRawId?: number;
  rereadVerifiedId?: number;
  rereadKey?: string;
  sourceLine?: string;
  refusedBy?: string;
  /**
   * After the rename: whether the guard accepts the new name under the live category, and where its
   * live pass moves it (`restoreTarget`); a failing name with no move goes to the guard's second look.
   */
  guardAfter?: { ok: boolean; refileTo: string | null };
}

export interface LiveNameRefreshFindings {
  /** Live fees with at least one candidate re-read. */
  checked: number;
  outcomes: Partial<Record<LiveNameRefreshOutcome, number>>;
  /** Live fees this step would rename. */
  matched: number;
  /** Of those, the ones the category guard then fails under their live category (moved, or taken down on its second look). */
  wouldRefile: number;
  samples: LiveNameRefreshVerdict[];
}

export interface LiveNameRefreshResult extends LiveNameRefreshFindings {
  live: boolean;
  dryRun: boolean;
  /** True when the step skipped the read (the last full read was under the interval ago). */
  skipped: boolean;
  /** An institution-scoped read: it never restarts the interval. */
  scoped: boolean;
  renamed: number[];
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const spaced = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
const folded = (text: string | null | undefined): string => spaced(text).toLowerCase();
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LIGATURE_GROUP = `(?:${[...LIGATURE_CANDIDATES].sort((a, b) => b.length - a.length).join("|")})`;
const LIGATURE_LETTERS = new RegExp(LIGATURE_GROUP, "g");

/** A word with its unknown glyphs read as ligatures ("Interna�onal" -> "International"). */
function glyphWordRepaired(old: string, next: string): boolean {
  const parts = old.split(REPLACEMENT_CHARACTER);
  if (parts.length < 2 || parts.length - 1 > MAX_GLYPHS_PER_WORD) return false;
  return new RegExp(`^${parts.map(escaped).join(LIGATURE_GROUP)}$`).test(next);
}

/** `next` with one or two ligatures' letters taken out is `old`. */
function dropsLigatures(next: string, old: string, depth = MAX_GLYPHS_PER_WORD): boolean {
  if (depth === 0 || next.length <= old.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    for (const ligature of LIGATURE_CANDIDATES) {
      if (!next.startsWith(ligature, index)) continue;
      const shorter = next.slice(0, index) + next.slice(index + ligature.length);
      if (shorter === old || dropsLigatures(shorter, old, depth - 1)) return true;
    }
  }
  return false;
}

/**
 * A word whose ligature letters a font dropped ("Overdra" for "Overdraft"): each letter run that
 * differs is a listed fee word (`FEE_TEXT_LIGATURE_WORDS`) with one or two ligatures taken out.
 */
function droppedWordRepaired(old: string, next: string): boolean {
  const oldRuns = old.split(/([A-Za-z]+)/);
  const nextRuns = next.split(/([A-Za-z]+)/);
  if (oldRuns.length !== nextRuns.length) return false;
  let repaired = 0;
  for (let index = 0; index < oldRuns.length; index += 1) {
    if (oldRuns[index] === nextRuns[index]) continue;
    // Odd indexes are letter runs; anything else that differs is not a dropped ligature.
    if (index % 2 === 0) return false;
    if (!FEE_TEXT_LIGATURE_WORDS.has(nextRuns[index].toLowerCase()) || !dropsLigatures(nextRuns[index], oldRuns[index])) return false;
    repaired += 1;
  }
  return repaired > 0;
}

/** Every word of `next` is `old`'s, with at least one word's glyphs or dropped ligatures restored. */
function glyphRepaired(old: string, next: string): boolean {
  const oldWords = old.split(" ");
  const nextWords = next.split(" ");
  if (oldWords.length !== nextWords.length) return false;
  let repaired = 0;
  for (let index = 0; index < oldWords.length; index += 1) {
    const [a, b] = [oldWords[index], nextWords[index]];
    if (a === b) continue;
    if (!(a.includes(REPLACEMENT_CHARACTER) ? glyphWordRepaired(a, b) : droppedWordRepaired(a, b))) return false;
    repaired += 1;
  }
  return repaired > 0;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Channel phrases, and the few words that join them ("phone request", "via online banking"). */
const CHANNEL_CLAUSE_PART = new RegExp(
  `\\b(?:${NEGATED_STANDARD_WORDS}|${CHANNEL_WORDS}|${STANDARD_WORDS}|requests?|requested|initiated|agreement|banking|by|via|through|using|or|and|only)\\b`,
  "gi",
);

/**
 * Review of #2766: the added words are a channel clause only when they state a channel and nothing
 * else is left once the channel phrases and their joining words are taken out, so "Each Additional
 * Recurring" or "Waived Online" (another price's words beside a channel word) is not one.
 */
function onlyStatesChannel(added: string): boolean {
  return statesWireChannel(added) && added.replace(CHANNEL_CLAUSE_PART, " ").trim() === "";
}

/** For a wire: `old`'s words all kept in order, and the words added state a channel and nothing else. */
function addsChannelClause(old: string, next: string): boolean {
  if (old.includes(REPLACEMENT_CHARACTER)) return false;
  const oldWords = words(old);
  const nextWords = words(next);
  if (oldWords.length < 2) return false;
  const added: string[] = [];
  let at = 0;
  for (const word of nextWords) {
    if (at < oldWords.length && word === oldWords[at]) at += 1;
    else added.push(word);
  }
  if (at < oldWords.length || added.length === 0 || added.length > MAX_CLAUSE_WORDS) return false;
  return onlyStatesChannel(added.join(" "));
}

/**
 * Pure: the kind of strict improvement `newName` makes on the live `oldName`, or null when it is
 * anything else (a different reading, a dropped word, a case change, a non-channel addition).
 */
export function nameImprovement(oldName: string | null | undefined, newName: string | null | undefined, canonicalKey: string): NameImprovement | null {
  const old = spaced(oldName);
  const next = spaced(newName);
  if (!old || !next || old === next || next.includes(REPLACEMENT_CHARACTER)) return null;
  if (glyphRepaired(old, next)) return "glyph_repair";
  if (WIRE_CHANNEL_CATEGORIES.has(canonicalKey) && addsChannelClause(old, next)) return "channel_clause";
  return null;
}

/** A stored line with case, spacing, glyphs, ligature letters and punctuation folded away. */
function lineSkeleton(line: string | null | undefined): string {
  return folded(line).replace(/�/g, "").replace(LIGATURE_LETTERS, "").replace(/[^a-z0-9]/g, "");
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

/**
 * Pure: the re-read's stored line is printed once in `text` and prices `amount` once, and the live
 * read's stored line is that line: the same once glyphs, ligature letters and punctuation are
 * folded away, or one a wider window of the other.
 */
export function sameLine(liveExcerpt: string | null, rereadExcerpt: string | null, text: string, amount: number): boolean {
  const reread = folded(rereadExcerpt);
  if (!reread || occurrences(folded(text), reread) !== 1) return false;
  if (pricePrints(reread, amount) !== 1) return false;
  const [a, b] = [lineSkeleton(liveExcerpt), lineSkeleton(rereadExcerpt)];
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < MIN_LINE_SKELETON) return false;
  return a.includes(b) || b.includes(a);
}

function parseSameAmount(value: LiveNameRefreshRow["same_amount"]): LiveNameRefreshSameAmount[] {
  if (value == null) return [];
  return typeof value === "string" ? (JSON.parse(value) as LiveNameRefreshSameAmount[]) : value;
}

function baseOf(row: LiveNameRefreshRow) {
  return {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    amount: num(row.amount),
    canonicalFeeKey: row.canonical_fee_key,
    oldName: row.fee_name,
  };
}

/** Pure: one live fee and one candidate re-read. */
export function judgeLiveNameRefresh(row: LiveNameRefreshRow): LiveNameRefreshVerdict {
  const base = baseOf(row);
  const amount = base.amount;
  const rereadKey = row.reread_key;
  const newName = publishedFeeName(row.reread_name, rereadKey);
  const pair = { newName, rereadKey, rereadRawId: Number(row.reread_raw_id), rereadVerifiedId: Number(row.reread_verified_id) };
  const verdict = (outcome: LiveNameRefreshOutcome, extra: Partial<LiveNameRefreshVerdict> = {}): LiveNameRefreshVerdict => ({ ...base, ...pair, outcome, ...extra });
  const text = row.normalized_text ?? "";
  if (!text.trim() || amount == null) return verdict("no_text");
  const improvement = nameImprovement(row.fee_name, newName, row.canonical_fee_key);
  if (!improvement) return verdict("not_an_improvement");
  const [liveFrequency, rereadFrequency] = [frequencyClass(row.frequency), frequencyClass(row.reread_frequency)];
  if (liveFrequency != null && rereadFrequency != null && liveFrequency !== rereadFrequency) return verdict("frequency_differs", { improvement });
  // A re-read under another category counts only where the repaired name is what moved it: the
  // guard fails the new name under the live category and its re-file rule names the re-read's.
  if (rereadKey !== row.canonical_fee_key
    && (checkFeeCategory(row.canonical_fee_key, newName).ok || refileCategory(row.canonical_fee_key, newName) !== rereadKey)) {
    return verdict("category_differs", { improvement });
  }
  if (!sameLine(row.live_excerpt, row.reread_excerpt, text, amount)) return verdict("not_same_line", { improvement });
  const hold = publishNameHold(newName, rereadKey, amount);
  if (hold) return verdict("name_hold", { improvement, refusedBy: hold.code });
  if (!checkFeeCategory(rereadKey, newName).ok) return verdict("category_guard", { improvement });
  const traced = checkFeeAgainstSource(text, newName, amount, ".", rereadKey);
  if (!traced.ok) return verdict("untraced", { improvement, refusedBy: "reason" in traced ? String(traced.reason) : "untraced" });
  const guard = checkFeeCategory(row.canonical_fee_key, newName);
  // What the guard's live pass then does with it: nothing, a move in place (`restoreTarget`), or,
  // with no move, its second look and a takedown (the re-read then publishes under its own category).
  const refileTo = guard.ok ? null : restoreTarget({
    canonical_fee_key: row.canonical_fee_key, fee_name: newName, amount, conditions: null, document_nsf_amount: null, fee_published_id: row.fee_published_id,
  });
  return verdict("refresh", {
    improvement,
    sourceLine: "sourceLine" in traced && typeof traced.sourceLine === "string" ? traced.sourceLine : undefined,
    guardAfter: { ok: guard.ok, refileTo },
  });
}

/** Refusals in the order the most telling one is reported for a fee with several candidates. */
const REFUSAL_ORDER: LiveNameRefreshOutcome[] = ["untraced", "category_guard", "name_hold", "not_same_line", "category_differs", "frequency_differs", "not_an_improvement", "no_text"];

/**
 * Pure: one verdict per live fee. A fee takes a new name only when every passing candidate gives
 * the same one, no other live fee of the bank shows that name in the category at that price, and
 * no other fee of this pass would take it too.
 */
export function findLiveNameRefreshes(rows: LiveNameRefreshRow[]): LiveNameRefreshFindings & { verdicts: LiveNameRefreshVerdict[] } {
  const byFee = new Map<number, LiveNameRefreshRow[]>();
  for (const row of rows) {
    const id = Number(row.fee_published_id);
    byFee.set(id, [...(byFee.get(id) ?? []), row]);
  }
  const verdicts: LiveNameRefreshVerdict[] = [];
  for (const [, candidates] of [...byFee.entries()].sort(([a], [b]) => a - b)) {
    const judged = candidates.map(judgeLiveNameRefresh);
    const passing = judged.filter((verdict) => verdict.outcome === "refresh");
    const names = new Set(passing.map((verdict) => verdict.newName));
    if (names.size > 1) {
      verdicts.push({ ...baseOf(candidates[0]), outcome: "ambiguous", refusedBy: [...names].join(" | ") });
      continue;
    }
    if (passing.length > 0) {
      // The newest re-read stands for the line.
      const chosen = passing.sort((a, b) => (b.rereadRawId ?? 0) - (a.rereadRawId ?? 0))[0];
      const twin = parseSameAmount(candidates[0].same_amount).find((fee) =>
        String(fee.fee_published_id) !== String(chosen.feePublishedId)
        && (fee.canonical_fee_key === chosen.canonicalFeeKey || fee.canonical_fee_key === chosen.rereadKey)
        && folded(fee.fee_name) === folded(chosen.newName));
      verdicts.push(twin ? { ...chosen, outcome: "same_name_live", refusedBy: `live fee #${twin.fee_published_id}` } : chosen);
      continue;
    }
    const rank = (verdict: LiveNameRefreshVerdict) => REFUSAL_ORDER.indexOf(verdict.outcome);
    verdicts.push(judged.sort((a, b) => rank(a) - rank(b))[0]);
  }
  // Two live fees of one bank taking one name at one price would be one line shown twice.
  const takers = new Map<string, number>();
  const takerKey = (verdict: LiveNameRefreshVerdict) => `${verdict.institutionId}|${verdict.canonicalFeeKey}|${verdict.amount}|${folded(verdict.newName)}`;
  for (const verdict of verdicts) if (verdict.outcome === "refresh") takers.set(takerKey(verdict), (takers.get(takerKey(verdict)) ?? 0) + 1);
  for (const verdict of verdicts) {
    if (verdict.outcome === "refresh" && (takers.get(takerKey(verdict)) ?? 0) > 1) {
      verdict.outcome = "same_name_live";
      verdict.refusedBy = "another fee of this pass takes the same name";
    }
  }
  const outcomes: Partial<Record<LiveNameRefreshOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  const refreshing = verdicts.filter((verdict) => verdict.outcome === "refresh");
  return {
    checked: verdicts.length,
    outcomes,
    matched: refreshing.length,
    wouldRefile: refreshing.filter((verdict) => verdict.guardAfter && !verdict.guardAfter.ok).length,
    samples: [...refreshing, ...verdicts.filter((verdict) => verdict.outcome !== "refresh")].slice(0, LIVE_NAME_REFRESH_SAMPLES),
    verdicts,
  };
}

const LIGATURE_SKELETON_SQL = (column: string) => `regexp_replace(lower(${column}), '(${[...LIGATURE_CANDIDATES].sort((a, b) => b.length - a.length).join("|")}|[^a-z0-9])', '', 'g')`;

/**
 * Read-only: each live flat fee paired with every newer verified, unpublished read of its own
 * document at its amount, variant, audience and product under another name that may be a repair
 * (a glyph in the live name, the same letters but for ligatures, or a longer wire name), with the
 * document's newest completed text and the bank's other live fees at the amount. The step's own
 * read; run it in a read-only transaction for the dry-run count. `$1` an institution id or null,
 * `$2` the pair cap.
 */
export const LIVE_NAME_REFRESH_ROWS_SQL = `
    WITH pairs AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.canonical_fee_key,
             fp.amount, fp.frequency, lr.source_document_id, lr.fee_raw_id AS live_raw_id,
             rr.fee_raw_id AS reread_raw_id, rv.fee_verified_id AS reread_verified_id, rv.fee_name AS reread_name,
             rv.canonical_fee_key AS reread_key, rv.frequency AS reread_frequency
        FROM published_fee_records fp
        JOIN verified_fee_observations lv ON lv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations lr ON lr.fee_raw_id = lv.fee_raw_id
        JOIN raw_fee_observations rr
          ON rr.institution_id = fp.institution_id
         AND rr.source_document_id = lr.source_document_id
         AND rr.fee_raw_id > lr.fee_raw_id
         AND rr.amount = fp.amount
         AND rr.rate_percent IS NULL
        JOIN verified_fee_observations rv ON rv.fee_raw_id = rr.fee_raw_id AND rv.review_status IN ('verified', 'approved')
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND fp.rate_percent IS NULL
         AND lr.source_document_id IS NOT NULL
         AND ($1::bigint IS NULL OR fp.institution_id = $1::bigint)
         -- Never rename an admin-corrected fee (#978).
         AND ${notAdminCorrectedSql("fp")}
         AND COALESCE(rv.variant_type, '') = COALESCE(fp.variant_type, '')
         AND COALESCE(rv.fee_audience, 'unknown') = COALESCE(fp.fee_audience, 'unknown')
         AND ${productKeySql("rr.product_name")} = ${productKeySql("lr.product_name")}
         AND lower(btrim(rv.fee_name)) <> lower(btrim(fp.fee_name))
         AND (
           position(chr(65533) in fp.fee_name) > 0
           OR ${LIGATURE_SKELETON_SQL("rv.fee_name")} = ${LIGATURE_SKELETON_SQL("fp.fee_name")}
           OR (fp.canonical_fee_key IN (${[...WIRE_CHANNEL_CATEGORIES].map((key) => `'${key}'`).join(", ")})
               AND length(btrim(rv.fee_name)) > length(btrim(fp.fee_name)))
         )
         AND NOT EXISTS (
           SELECT 1 FROM published_fee_records other
            WHERE other.lineage_ref = rv.fee_verified_id
              AND other.rolled_back_at IS NULL
         )
       ORDER BY fp.fee_published_id, rr.fee_raw_id
       LIMIT $2::int
    )
    SELECT p.fee_published_id, p.fee_verified_id, p.institution_id, p.fee_name, p.canonical_fee_key, p.amount, p.frequency,
           p.source_document_id, ${sameLineExcerptSql("lr")} AS live_excerpt,
           p.reread_raw_id, p.reread_verified_id, p.reread_name, p.reread_key, p.reread_frequency,
           ${sameLineExcerptSql("rr")} AS reread_excerpt,
           adt.id AS document_text_id, adt.normalized_text,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('fee_published_id', o.fee_published_id, 'fee_name', o.fee_name,
                                                 'canonical_fee_key', o.canonical_fee_key) ORDER BY o.fee_published_id)
               FROM published_fee_records o
              WHERE o.institution_id = p.institution_id
                AND o.fee_published_id <> p.fee_published_id
                AND o.rolled_back_at IS NULL
                AND o.quarantined_at IS NULL
                AND o.amount = p.amount
                AND o.rate_percent IS NULL
           ), '[]'::jsonb) AS same_amount
      FROM pairs p
      JOIN raw_fee_observations lr ON lr.fee_raw_id = p.live_raw_id
      JOIN raw_fee_observations rr ON rr.fee_raw_id = p.reread_raw_id
      LEFT JOIN LATERAL (
        SELECT t.id, t.normalized_text FROM agent_source_texts t
         WHERE t.source_document_id = p.source_document_id
           AND t.status = 'completed'
           AND t.normalized_text IS NOT NULL
         ORDER BY t.id DESC
         LIMIT 1
      ) adt ON TRUE
     ORDER BY p.fee_published_id, p.reread_raw_id`;

export function liveNameRefreshRows(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<LiveNameRefreshRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? LIVE_NAME_REFRESH_LIMIT, 5_000));
  return db.unsafe<LiveNameRefreshRow[]>(LIVE_NAME_REFRESH_ROWS_SQL, [options.institutionId ?? null, limit]);
}

/** True when a full (not institution-scoped) read ran under the interval ago. A failed read never skips. */
async function readRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${LIVE_NAME_REFRESH_CHECK}
         AND COALESCE(detail->>'scoped', 'false') <> 'true'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < LIVE_NAME_REFRESH_INTERVAL_HOURS * 3_600_000;
  } catch (error) {
    console.warn("[hamilton] live name refresh interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * One step's refresh (see the module note). Never throws: a failed read reports nothing checked,
 * and a failed write leaves the names as they were. A full read runs at most once per
 * `LIVE_NAME_REFRESH_INTERVAL_HOURS`, keyed on its last event; an institution-scoped read runs every
 * time and does not restart the clock.
 */
export async function refreshLiveFeeNames(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<LiveNameRefreshResult> {
  const live = options.live ?? liveNameRefreshOn();
  const scoped = options.institutionId != null;
  const result: LiveNameRefreshResult = {
    live, dryRun: options.dryRun, skipped: false, scoped, checked: 0, outcomes: {}, matched: 0, wouldRefile: 0, samples: [], renamed: [],
  };
  if (!scoped && !options.dryRun && await readRecently(db, options.now ?? new Date())) {
    result.skipped = true;
    return result;
  }
  let rows: LiveNameRefreshRow[];
  try {
    rows = await inSavepoint(db, (scope) => liveNameRefreshRows(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[hamilton] live name refresh read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const found = findLiveNameRefreshes(rows);
  Object.assign(result, { checked: found.checked, outcomes: found.outcomes, matched: found.matched, wouldRefile: found.wouldRefile, samples: found.samples });

  if (live && !options.dryRun) {
    result.renamed = await writeLiveNameRefreshes(db, options.runId, options.stepId ?? null, found.verdicts.filter((verdict) => verdict.outcome === "refresh"));
    if (result.renamed.length > 0) invalidatePublicReadCache();
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LIVE_NAME_REFRESH_CHECK}, 'completed',
          ${liveNameRefreshMessage(result)},
          ${JSON.stringify(liveNameRefreshDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[hamilton] live name refresh event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Rename confirmed fees in place, guarded on the old name and category; the old name logged first. */
export async function writeLiveNameRefreshes(db: SqlTag, runId: number, stepId: number | null, verdicts: LiveNameRefreshVerdict[]): Promise<number[]> {
  if (verdicts.length === 0) return [];
  try {
    return await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET fee_name = v.new_name
          FROM unnest(${verdicts.map((verdict) => verdict.feePublishedId)}::bigint[], ${verdicts.map((verdict) => verdict.canonicalFeeKey)}::text[],
                      ${verdicts.map((verdict) => verdict.oldName)}::text[], ${verdicts.map((verdict) => verdict.newName as string)}::text[])
               AS v(fee_published_id, canonical_fee_key, old_name, new_name)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.canonical_fee_key
           AND fp.fee_name = v.old_name
           AND fp.rolled_back_at IS NULL
           AND fp.quarantined_at IS NULL
           -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template:
           -- never rename an admin-corrected fee (#978).
           AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
        RETURNING fp.fee_published_id
      `;
      const done = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = verdicts.filter((verdict) => done.has(verdict.feePublishedId));
      if (applied.length > 0) {
        await recordFeedback(scope, applied.map((verdict) => refreshedRow(verdict, runId)));
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${runId}, ${stepId}, ${`${LIVE_NAME_REFRESH_CHECK}_rename`}, 'completed',
            ${`Renamed ${applied.length} live fee(s) to the name Knox's re-read of their own line gives (repaired glyphs or a wire's channel)`},
            ${JSON.stringify({ version: LIVE_NAME_REFRESH_VERSION, renamed: applied.map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((verdict) => verdict.feePublishedId);
    });
  } catch (error) {
    console.error("[hamilton] live name refresh write failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function refreshedRow(verdict: LiveNameRefreshVerdict, runId: number): FeedbackRow {
  return {
    aboutStage: "publish",
    aboutStrategy: LIVE_NAME_REFRESH_CHECK,
    aboutVersion: LIVE_NAME_REFRESH_VERSION,
    signal: "wrong",
    kind: LIVE_NAME_REFRESHED_KIND,
    reportedBy: "hamilton",
    checkName: LIVE_NAME_REFRESH_CHECK,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeRawId: verdict.rereadRawId ?? null,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: {
      old_name: verdict.oldName,
      new_name: verdict.newName,
      improvement: verdict.improvement,
      reread_raw_id: verdict.rereadRawId,
      reread_verified_id: verdict.rereadVerifiedId,
      source_line: verdict.sourceLine ?? null,
      guard_after: verdict.guardAfter ?? null,
    },
    runId,
    dedupeKey: `${LIVE_NAME_REFRESH_CHECK}:pub:${verdict.feePublishedId}:raw:${verdict.rereadRawId}`,
  };
}

function sampleDetail(verdict: LiveNameRefreshVerdict) {
  return {
    fee_published_id: verdict.feePublishedId,
    institution_id: verdict.institutionId,
    source_document_id: verdict.sourceDocumentId,
    amount: verdict.amount,
    canonical_fee_key: verdict.canonicalFeeKey,
    outcome: verdict.outcome,
    old_name: verdict.oldName,
    ...(verdict.newName ? { new_name: verdict.newName } : {}),
    ...(verdict.improvement ? { improvement: verdict.improvement } : {}),
    ...(verdict.rereadRawId ? { reread_raw_id: verdict.rereadRawId, reread_key: verdict.rereadKey } : {}),
    ...(verdict.refusedBy ? { refused_by: verdict.refusedBy } : {}),
    ...(verdict.guardAfter ? { guard_after: verdict.guardAfter } : {}),
  };
}

export function liveNameRefreshMessage(result: LiveNameRefreshResult): string {
  const outcomes = Object.entries(result.outcomes).map(([outcome, count]) => `${count} ${outcome.replace(/_/g, " ")}`).join(", ") || "none";
  const action = result.live && !result.dryRun ? `${result.renamed.length} renamed` : `${result.dryRun ? "dry run" : "switch off"}, nothing written`;
  return `Read ${result.checked} live fee(s) with a newer re-read of their own line under another name (${outcomes}): ${result.matched} would take the re-read's name, ${result.wouldRefile} of them then failed by the category guard under their live category; ${action}`;
}

/** The step's detail for the run ledger. */
export function liveNameRefreshDetail(result: LiveNameRefreshResult) {
  return {
    check: LIVE_NAME_REFRESH_CHECK,
    version: LIVE_NAME_REFRESH_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    skipped: result.skipped,
    checked: result.checked,
    outcomes: result.outcomes,
    matched: result.matched,
    would_refile: result.wouldRefile,
    renamed: result.renamed,
    samples: result.samples.map(sampleDetail),
  };
}
