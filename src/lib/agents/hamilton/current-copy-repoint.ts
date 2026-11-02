import { productKeySql, sameProduct } from "@/lib/fee-product";
import { PUBLISHED_IDENTITY_COLUMNS } from "./published-identity";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import { FREE_READ_PREFIX } from "@/lib/agents/hamilton/product-page";
import { moveLiveFeeInPlace, type RefreshCopyCandidate } from "./refresh-copy";
import {
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  HAMILTON_PUBLISH_STRATEGY,
  IDENTICAL_FEE_REASON,
  feeValue,
  normalizedAmount,
  normalizedFeeName,
  publishNameHold,
  publishSkipReason,
  publishedFeeName,
  significantWords,
} from "./publish";
import { OPENING_SCAN_CHARS } from "@/lib/non-deposit-document";
import { checkFeeAgainstSource, checkRateAgainstSource, type SourceCheckFailure, type SourceCheckResult } from "@/lib/custom-report/source-check";
import { isPercentFee, ratePercentOf, type RateFields } from "@/lib/percent-fees";

type SqlTag = typeof sql;

/**
 * #1200: publish follows the current copy. When Magellan fetches a newer copy of a page, Knox
 * reads it and Darwin verifies its rows, publish meets each row that restates a live fee and skips
 * it as "Identical fee already published" (`decidePriorFee`, kind `identical`), keeping the live fee
 * read from the superseded copy. The fee is right, but it cites the old copy, so freshness checks
 * and line tracing cannot reach it (findings/2026-11-02-stale-copy-twins-unjudged.md: 1,391 live
 * fees were the previous fee of such a skip on Nov 2). The refresh-copy pass (`refresh-copy.ts`)
 * moves a fee only when the names match too, and left 840 of those pairs as `name_differs`.
 *
 * This pass takes publish's own decision as the pairing: a live fee that a current-copy row was
 * skipped as identical to, still the same line by today's identity (institution, category, variant,
 * frequency, audience, product and amount or rate, as `selectLivePublishedFees` and `decidePriorFee`
 * read it), moves onto that row in place (`moveLiveFeeInPlace`): its lineage, link, file and events
 * become the current copy's, and its id, name, amount, category and published date stay. The row
 * must come from the current copy at the end of the live fee's document's supersession chain
 * (`source_documents.superseded_by_id`), still be Darwin-verified, pass today's publish rules and
 * category guard, and never have been taken down. No fee is published or taken down, and no price
 * change is recorded.
 *
 * `PUBLISH_REPOINT_CURRENT_COPY_LIVE` false is a shadow run: each publish step counts the pairs it
 * would re-point and logs them on the run ledger (`hamilton.current_copy_repoint`, `live: false`),
 * and changes nothing. Dry run measured Nov 2 (read-only SQL, the selection below with the name
 * rule mirrored in SQL): 454 live fees (495 before the latest-decision, bookkeeping-close and name
 * rules; the name rule alone drops 39). The other ~900 of the finding's 1,391 were skipped
 * against a live fee that has since changed
 * identity (mostly the row's audience is now `unknown` where the live fee's is consumer, both or
 * business), so today's publish would not call them identical, and moving them would change the
 * fee's audience; they stay as they are.
 *
 * v2 (Nov 2 sample: 51 of 60 eligible pairs clean against the current copy's stored text, 5 wrong,
 * 4 unclear) adds three rules. The row itself must name the live line (`rowNameMismatch`): the live
 * fee and the row trace to the same printed line of the current copy, and a row whose name is not
 * related to the live name must print the live name at the price on that line, which names no other
 * line; the live name printed anywhere on the page moved "Balance Inquiry" onto "Withdrawals" at
 * the same $1.50 (`name_unrelated`). The current copy must be strictly newer than the copy the live
 * fee cites, by `source_documents.crawled_at` (23 of 536 pairs pointed back in time;
 * `copy_not_newer`). And the live fee must pass the one shared source check (`checkFeeAgainstSource`,
 * or `checkRateAgainstSource` for a rate) against the current copy's stored text, so a fee that was
 * already wrong never gets fresh provenance (`source_check_failed`). Nov 2 re-measure (read-only):
 * 513 of 536 pairs pass the date rule; on 67 of them drawn at random, read on excerpts of the
 * stored text, 41 pass every rule (about 315 of 513), and 38 of the first 40 kept were clean.
 * The source check does not judge category: a $50 wire the page prices for transfers not routed
 * through a U.S. bank, filed as domestic, still passes.
 */
export const PUBLISH_REPOINT_CURRENT_COPY_LIVE = false;
export const CURRENT_COPY_REPOINT_STRATEGY = { strategy: "hamilton.current_copy_repoint", version: 2 } as const;
/** Live fees re-pointed (or counted, in shadow) per publish step; later steps take the rest. */
export const CURRENT_COPY_REPOINT_LIMIT = 500;
/** Supersession chains are short (a few copies); the bound only stops a cycle. */
export const CURRENT_COPY_CHAIN_MAX_DEPTH = 20;
/**
 * A current-copy row whose own publication was closed only as bookkeeping (a v1 refresh's
 * `refreshed by #`, a duplicate collapse onto another row, or a price supersede) can still carry
 * the live fee; any other close (a takedown, a guard) means a check judged that row, and it never
 * becomes a live fee's lineage here.
 */
export const BOOKKEEPING_CLOSE_SQL = (alias: string, liveFeeColumn: string) =>
  `(COALESCE(${alias}.rolled_back_reason, '') = 'superseded'
    OR COALESCE(${alias}.rolled_back_reason, '') LIKE 'refreshed by #%'
    OR (COALESCE(${alias}.rolled_back_reason, '') ~ '^duplicate of #[0-9]+$'
        -- Collapsed onto the live fee this pass moves: fine. Onto another fee still live: that
        -- fee carries the line, and moving this one onto the row would repeat it.
        AND (substring(${alias}.rolled_back_reason from '[0-9]+$')::bigint = ${liveFeeColumn}
             OR NOT EXISTS (SELECT 1 FROM published_fee_records kept
                             WHERE kept.fee_published_id = substring(${alias}.rolled_back_reason from '[0-9]+$')::bigint
                               AND kept.rolled_back_at IS NULL))))`;

/** One check per (live fee, current-copy row) pair. */
export function currentCopyRepointFingerprint(feePublishedId: number | string, feeVerifiedId: number | string): string {
  return `v${CURRENT_COPY_REPOINT_STRATEGY.version}:${feePublishedId}:${feeVerifiedId}`;
}

/** A live fee on a superseded copy, paired with the current-copy row publish skipped as identical to it. */
export interface CurrentCopyRepointCandidate extends RefreshCopyCandidate {
  /** The live fee's own category and name, which stay as they are. */
  prior_canonical_fee_key: string;
  /** How many copies after the live fee's document the current copy is (1: its direct successor). */
  chain_depth?: number | string | null;
  /** The current copy's newest completed stored text (`agent_source_texts.normalized_text`). */
  current_text?: string | null;
  /** When the current copy was crawled (`source_documents.crawled_at`). */
  current_crawled_at?: Date | string | null;
  /** When the copy the live fee cites was crawled. */
  prior_crawled_at?: Date | string | null;
}

export type CurrentCopyRepointSkip =
  | "product_differs"
  | "audience_differs"
  | "category_differs"
  | "value_differs"
  /** v2: the current copy was not crawled strictly after the copy the live fee cites. */
  | "copy_not_newer"
  | "name_unrelated"
  | "category_guard"
  | "name_hold"
  | "publish_rule"
  /** v2: the live fee does not trace to the current copy's stored text (detail: the check's reason). */
  | "source_check_failed"
  | "pair_taken";

export interface CurrentCopyRepointPlan {
  repoint: CurrentCopyRepointCandidate[];
  skipped: Array<{ candidate: CurrentCopyRepointCandidate; reason: CurrentCopyRepointSkip; detail?: string }>;
  /**
   * Pairs whose text checks did not run because the step's deadline passed: neither moved nor
   * skipped, and never recorded, so a later step checks them again.
   */
  notChecked: CurrentCopyRepointCandidate[];
}

/**
 * The shared source checks, each run once per document text, name and amount (or rate). Many pairs
 * share a document, a live fee or a row, so a step traces each of them once; `traces` counts the
 * checks actually run.
 */
export class SourceCheckCache {
  traces = 0;
  private readonly results = new Map<string, Map<string, SourceCheckResult>>();

  private memo(text: string, key: string, run: () => SourceCheckResult): SourceCheckResult {
    let byText = this.results.get(text);
    if (!byText) {
      byText = new Map();
      this.results.set(text, byText);
    }
    const hit = byText.get(key);
    if (hit) return hit;
    this.traces += 1;
    const result = run();
    byText.set(key, result);
    return result;
  }

  fee(text: string | null | undefined, name: string, amount: number, canonicalFeeKey: string | null | undefined): SourceCheckResult {
    if (!text) return checkFeeAgainstSource(text, name, amount, ".", canonicalFeeKey);
    return this.memo(text, JSON.stringify(["fee", name, amount, canonicalFeeKey ?? null]), () => checkFeeAgainstSource(text, name, amount, ".", canonicalFeeKey));
  }

  rate(text: string | null | undefined, name: string, ratePercent: number): SourceCheckResult {
    if (!text) return checkRateAgainstSource(text, name, ratePercent, ".");
    return this.memo(text, JSON.stringify(["rate", name, ratePercent]), () => checkRateAgainstSource(text, name, ratePercent, "."));
  }
}

function words(name: string | null | undefined): Set<string> {
  return new Set(normalizedFeeName(name).split(" ").filter((word) => word.length > 1));
}

/**
 * The row's name names the live fee's line: the same name, or one name's significant words (no
 * filler such as "fee" or "charge", stemmed) all inside the other's ("Overdraft Fee" and "Overdraft
 * charge"; "Copy of Check" and "Share Fees: Copy of Check"). One shared word is not enough: the
 * category's own word is shared by every line of it ("Inactive Savings Account" and "Inactive
 * Checking"). With the current copy's text the plan also requires the same printed line
 * (`rowNameMismatch`); the live name printed elsewhere on the page is never enough.
 */
export function namesRelated(liveName: string | null | undefined, rowName: string | null | undefined): boolean {
  if (normalizedFeeName(liveName) === normalizedFeeName(rowName)) return true;
  const live = significantWords(liveName);
  const row = significantWords(rowName);
  if (live.size === 0 || row.size === 0) return false;
  const [small, large] = live.size <= row.size ? [live, row] : [row, live];
  return [...small].every((word) => large.has(word));
}

const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const plainWords = (text: string | null | undefined) => ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const sameMoney = (figure: string, amount: number) => Math.abs(Number(figure.replace(/,/g, "")) - amount) < 0.005;

function timeOf(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** v2: the current copy was crawled strictly after the copy the live fee cites. Unknown times never pass. */
export function currentCopyIsNewer(candidate: Pick<CurrentCopyRepointCandidate, "current_crawled_at" | "prior_crawled_at">): boolean {
  const current = timeOf(candidate.current_crawled_at);
  const prior = timeOf(candidate.prior_crawled_at);
  return current != null && prior != null && current > prior;
}

/**
 * v2, pure: the row's own line names the live line. The row is traced on the current copy's text by
 * the one shared check (`checkFeeAgainstSource`, its own name and price); that line must print the
 * live name, and the live name must own the price: either the line prints one money figure, this
 * amount, or the live name and every word of the row's name sit in the run of words that ends at a
 * figure of this amount. "ATM Fees: Withdrawals $1.50 Balance Inquiry $1.50" never moves a live
 * "Balance Inquiry" onto "Withdrawals"; "Outgoing Domestic Wire Transfer $35 per wire (Fee shown
 * when charged as Wire Fee Out)" carries the live "(Fee shown when charged as Wire Fee Out)".
 */
export function rowLineNamesLive(
  text: string | null | undefined,
  candidate: Pick<CurrentCopyRepointCandidate, "fee_name" | "amount" | "canonical_fee_key" | "prior_fee_name">,
  checks: SourceCheckCache = new SourceCheckCache(),
): boolean {
  const amount = Number(candidate.amount);
  const live = plainWords(candidate.prior_fee_name);
  if (!text || candidate.amount == null || !Number.isFinite(amount) || live.trim().length === 0) return false;
  const traced = checks.fee(text, candidate.fee_name, amount, candidate.canonical_fee_key);
  if (!traced.ok) return false;
  const line = traced.sourceLine;
  if (!plainWords(line).includes(live)) return false;
  const figures = [...line.matchAll(MONEY)];
  if (figures.length === 1) return sameMoney(figures[0][1], amount);
  const rowWords = significantWords(candidate.fee_name);
  let start = 0;
  for (const figure of figures) {
    const end = figure.index ?? 0;
    const run = line.slice(start, end);
    start = end + figure[0].length;
    if (!sameMoney(figure[1], amount)) continue;
    const runWords = significantWords(run);
    if (plainWords(run).includes(live) && [...rowWords].every((word) => runWords.has(word))) return true;
  }
  return false;
}

const sameSourceLine = (a: string, b: string) => {
  const [x, y] = [plainWords(a), plainWords(b)];
  // The same words, not one line inside the other: "Visa Gift Cards | $3.00 per gift card" is not
  // "Shared Branching - Visa Gift Cards | $3.00 per gift card".
  return x.trim().length > 0 && x === y;
};

/**
 * v2, pure: why the row does not name the live fee's printed line, or null when it does. Both are
 * traced on the current copy's text by the one shared check (`checkFeeAgainstSource`): the live fee
 * by its own name and the row by its own. They must trace to the same printed line: a row whose name
 * shares the live name's words but is printed on another line at the same price ("Cashier Check
 * fee" and "Cashier Check Copy fee", both $2) is another fee (`another_line`). A row whose name is
 * not related to the live name must also print the live name at its price on that line
 * (`rowLineNamesLive`), and the live name must trace nowhere else (`ambiguous`: "per paid overdraft
 * item" under two $20 overdraft lines names neither). When the row does not trace, its related name
 * decides, as before; when the live fee does not trace, the source check skips the pair.
 */
export function rowNameMismatch(
  text: string | null | undefined,
  candidate: Pick<CurrentCopyRepointCandidate, "fee_name" | "amount" | "canonical_fee_key" | "prior_fee_name" | "prior_amount" | "prior_canonical_fee_key">,
  checks: SourceCheckCache = new SourceCheckCache(),
): "unrelated" | "another_line" | "ambiguous" | null {
  const related = namesRelated(candidate.prior_fee_name, candidate.fee_name);
  const amount = Number(candidate.amount);
  const priorAmount = Number(candidate.prior_amount);
  if (!text || candidate.amount == null || candidate.prior_amount == null || !Number.isFinite(amount) || !Number.isFinite(priorAmount)) {
    return related ? null : "unrelated";
  }
  const live = checks.fee(text, candidate.prior_fee_name, priorAmount, candidate.prior_canonical_fee_key);
  // The row is traced only when the live fee traces: otherwise its name alone decides.
  const row = live.ok ? checks.fee(text, candidate.fee_name, amount, candidate.canonical_fee_key) : null;
  if (!live.ok || !row?.ok) return related ? null : "unrelated";
  if (!sameSourceLine(live.sourceLine, row.sourceLine)) return "another_line";
  if (related) return null;
  if (!rowLineNamesLive(text, candidate, checks)) return "unrelated";
  const lines = text.split("\n");
  // The live name traced again without its own row (the first copy of each of that row's lines, so
  // a line the page prints twice, "$20.00 per paid overdraft item", still counts once more).
  const removed = new Set<string>();
  const rest = lines.filter((line) => {
    const piece = plainWords(line);
    if (!piece.trim() || removed.has(piece) || !plainWords(live.sourceLine).includes(piece)) return true;
    removed.add(piece);
    return false;
  });
  if (rest.length < lines.length) {
    const again = checks.fee(rest.join("\n"), candidate.prior_fee_name, priorAmount, candidate.prior_canonical_fee_key);
    if (again.ok) return "ambiguous";
  }
  return null;
}

/**
 * v2, pure: the live fee itself, its own name and amount (or rate), traces to the current copy's
 * stored text by the one shared check. Null when it does; otherwise the check's reason.
 */
export function liveFeeSourceFailure(
  text: string | null | undefined,
  candidate: Pick<CurrentCopyRepointCandidate, "prior_fee_name" | "prior_amount" | "prior_amount_kind" | "prior_rate_percent" | "prior_canonical_fee_key">,
  checks: SourceCheckCache = new SourceCheckCache(),
): SourceCheckFailure | "no_amount" | null {
  const prior = { amount: candidate.prior_amount, amount_kind: candidate.prior_amount_kind ?? null, rate_percent: candidate.prior_rate_percent ?? null } as RateFields;
  if (isPercentFee(prior)) {
    const rate = ratePercentOf(prior);
    if (rate == null) return "no_amount";
    const result = checks.rate(text, candidate.prior_fee_name, rate);
    return result.ok ? null : result.reason;
  }
  const amount = Number(candidate.prior_amount);
  if (candidate.prior_amount == null || !Number.isFinite(amount)) return "no_amount";
  const result = checks.fee(text, candidate.prior_fee_name, amount, candidate.prior_canonical_fee_key);
  return result.ok ? null : result.reason;
}

/** The checks on a pair that need no text, in the plan's order; null when it passes them all. */
function identitySkip(candidate: CurrentCopyRepointCandidate): CurrentCopyRepointSkip | null {
  if (!sameProduct(candidate.product_name, candidate.prior_product_name)) return "product_differs";
  // Missing audience is unknown, as in the publisher; unknown never carries a consumer,
  // business or both-audiences fee (the audience trigger would change the live fee's audience).
  if ((candidate.fee_audience ?? "unknown") !== (candidate.prior_fee_audience ?? "unknown")) return "audience_differs";
  if (candidate.canonical_fee_key !== candidate.prior_canonical_fee_key) return "category_differs";
  const prior = {
    amount: candidate.prior_amount,
    amount_kind: candidate.prior_amount_kind ?? null,
    rate_percent: candidate.prior_rate_percent ?? null,
  };
  if (feeValue(candidate) !== feeValue(prior as Parameters<typeof feeValue>[0])) return "value_differs";
  // v2: a copy crawled before the one the live fee cites is no newer copy of the page.
  if (!currentCopyIsNewer(candidate)) return "copy_not_newer";
  return null;
}

/** How closely the row's name reads as the live fee's: the same name first, then shared words. */
export function nameAffinity(liveName: string | null | undefined, rowName: string | null | undefined): number {
  if (normalizedFeeName(liveName) === normalizedFeeName(rowName)) return Number.MAX_SAFE_INTEGER;
  const live = words(liveName);
  let shared = 0;
  for (const word of words(rowName)) if (live.has(word)) shared += 1;
  return shared;
}

/**
 * Pure: which pairs move. Publish already judged each pair the same line; this re-reads today's
 * identity (a fee or row changed since the skip is left alone) and today's publish rules on the
 * row. One schedule can restate a live fee's price on two lines ("Inactive Checking" and
 * "Inactive Savings" at $15): each live fee takes the row whose name reads most like its own, and
 * each row carries at most one live fee.
 *
 * The text checks run first, document by document, through one `SourceCheckCache`, and stop when
 * `deadlineAt` passes; a pair whose checks did not run is `notChecked`, never moved or skipped.
 */
export function planCurrentCopyRepoints(
  candidates: CurrentCopyRepointCandidate[],
  minConfidence = HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  options: { deadlineAt?: number; now?: () => number; checks?: SourceCheckCache } = {},
): CurrentCopyRepointPlan {
  const plan: CurrentCopyRepointPlan = { repoint: [], skipped: [], notChecked: [] };
  const checks = options.checks ?? new SourceCheckCache();
  const now = options.now ?? Date.now;
  const timeLeft = () => options.deadlineAt == null || now() < options.deadlineAt;
  const ordered = [...candidates].sort((a, b) =>
    Number(a.prior_fee_published_id) - Number(b.prior_fee_published_id) ||
    nameAffinity(b.prior_fee_name, b.fee_name) - nameAffinity(a.prior_fee_name, a.fee_name) ||
    Number(a.fee_verified_id) - Number(b.fee_verified_id));
  // The text checks, grouped by document so each text is read in one run, for the pairs that reach
  // them; the loop below reads their cached results in its own order.
  const prepared = new Set<CurrentCopyRepointCandidate>();
  const byDocument = new Map<string, CurrentCopyRepointCandidate[]>();
  for (const candidate of ordered) {
    if (identitySkip(candidate)) continue;
    const key = String(candidate.source_document_id ?? "");
    const group = byDocument.get(key);
    if (group) group.push(candidate);
    else byDocument.set(key, [candidate]);
  }
  prepare: for (const group of byDocument.values()) {
    for (const candidate of group) {
      if (!timeLeft()) break prepare;
      if (!rowNameMismatch(candidate.current_text, candidate, checks)) liveFeeSourceFailure(candidate.current_text, candidate, checks);
      prepared.add(candidate);
    }
  }
  const usedPrior = new Set<string>();
  const usedVerified = new Set<string>();
  for (const candidate of ordered) {
    const identity = identitySkip(candidate);
    if (identity) {
      plan.skipped.push({ candidate, reason: identity });
      continue;
    }
    if (!prepared.has(candidate)) {
      plan.notChecked.push(candidate);
      continue;
    }
    // Publish's identical decision compares values only; the row itself must also name the live
    // line (v2: its own traced line, not the live name printed anywhere on the page).
    const nameMismatch = rowNameMismatch(candidate.current_text, candidate, checks);
    if (nameMismatch) {
      plan.skipped.push({ candidate, reason: "name_unrelated", detail: nameMismatch });
      continue;
    }
    // The publish step's own guards on the row (it decides identical only for a row that passes).
    const category = checkFeeCategory(candidate.canonical_fee_key, publishedFeeName(candidate.fee_name, candidate.canonical_fee_key), { amount: candidate.amount });
    if (!category.ok) {
      plan.skipped.push({ candidate, reason: "category_guard", detail: category.code });
      continue;
    }
    const nameHold = publishNameHold(candidate.fee_name, candidate.canonical_fee_key, normalizedAmount(candidate.amount));
    if (nameHold) {
      plan.skipped.push({ candidate, reason: "name_hold", detail: nameHold.code });
      continue;
    }
    const rule = publishSkipReason(candidate, minConfidence);
    if (rule) {
      plan.skipped.push({ candidate, reason: "publish_rule", detail: rule });
      continue;
    }
    // v2: a live fee that was already wrong never gets fresh provenance.
    const sourceFailure = liveFeeSourceFailure(candidate.current_text, candidate, checks);
    if (sourceFailure) {
      plan.skipped.push({ candidate, reason: "source_check_failed", detail: sourceFailure });
      continue;
    }
    const priorKey = String(candidate.prior_fee_published_id);
    const verifiedKey = String(candidate.fee_verified_id);
    if (usedPrior.has(priorKey) || usedVerified.has(verifiedKey)) {
      plan.skipped.push({ candidate, reason: "pair_taken" });
      continue;
    }
    usedPrior.add(priorKey);
    usedVerified.add(verifiedKey);
    plan.repoint.push(candidate);
  }
  return plan;
}

export interface CurrentCopyRepointSample {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  priorSourceDocumentId: number;
  currentSourceDocumentId: number | null;
}

export interface CurrentCopyRepointResult {
  /** `PUBLISH_REPOINT_CURRENT_COPY_LIVE` at run time; false is a shadow run. */
  live: boolean;
  checked: number;
  /** Pairs that pass every rule: re-pointed when live, counted when not. */
  eligible: number;
  repointed: number;
  skipped: Partial<Record<CurrentCopyRepointSkip, number>>;
  /** Pairs left unchecked because the step's deadline passed (neither moved nor skipped). */
  notChecked: number;
  samples: CurrentCopyRepointSample[];
}

/**
 * The pairs: a live fee on a superseded copy, and a Darwin-verified row from the current copy at
 * the end of that copy's supersession chain that publish skipped as identical to that live fee,
 * still the same line by today's identity. Read-only: the shadow run and the dry-run count read
 * this same statement.
 */
export async function selectCurrentCopyRepointCandidates(
  db: SqlTag,
  options: { institutionId?: number; stateCode?: string | null; limit?: number; live: boolean },
): Promise<CurrentCopyRepointCandidate[]> {
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode ?? null;
  const rows = await db<CurrentCopyRepointCandidate[]>`
    WITH RECURSIVE stale AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key,
             COALESCE(fp.variant_type, '') AS variant_type, COALESCE(fp.frequency, '') AS frequency,
             fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name,
             COALESCE(fp.fee_audience, 'unknown') AS fee_audience,
             fr.source_document_id, fr.product_name, fp.lineage_ref, sd.superseded_by_id, sd.crawled_at,
             ${db.unsafe(PUBLISHED_IDENTITY_COLUMNS)}
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
        JOIN institution_sources inst ON inst.id = fp.institution_id
       WHERE fp.rolled_back_at IS NULL
         -- An operator's hold (H03 #978) and an admin correction are never moved.
         AND fp.quarantined_at IS NULL
         AND ${db.unsafe(notAdminCorrectedSql("fp"))}
         AND sd.superseded_by_id IS NOT NULL
         AND sd.superseded_by_id <> sd.id
         AND (${institutionId}::bigint IS NULL OR fp.institution_id = ${institutionId}::bigint)
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
    ), chain AS (
      SELECT starts.start_id, starts.doc_id, 1 AS depth
        FROM (SELECT DISTINCT stale.source_document_id AS start_id, stale.superseded_by_id AS doc_id FROM stale) starts
      UNION ALL
      SELECT chain.start_id, next_copy.superseded_by_id, chain.depth + 1
        FROM chain
        JOIN source_documents next_copy ON next_copy.id = chain.doc_id
       WHERE next_copy.superseded_by_id IS NOT NULL
         AND next_copy.superseded_by_id <> next_copy.id
         AND chain.depth < ${CURRENT_COPY_CHAIN_MAX_DEPTH}
    ), current_copy AS (
      SELECT chain.start_id, chain.doc_id, chain.depth
        FROM chain
        JOIN source_documents cur ON cur.id = chain.doc_id
       WHERE cur.superseded_by_id IS NULL
    )
    SELECT nv.fee_verified_id, nv.fee_raw_id, nv.institution_id, nv.source_url, nv.document_r2_key,
           nv.extraction_confidence, nv.canonical_fee_key, nv.variant_type, nv.outlier_flags,
           nv.verified_by_agent_event_id, nv.fee_name, nv.amount, nv.frequency, nv.amount_kind,
           nv.rate_percent, nv.rate_min_amount, nv.rate_max_amount, nv.rate_basis,
           COALESCE(nv.fee_audience, 'unknown') AS fee_audience,
           nr.agent_event_id AS raw_agent_event_id, nr.source_document_id, nr.product_name,
           COALESCE(COALESCE(nr.extraction_note, nr.conditions) LIKE ${`${FREE_READ_PREFIX}%`}, false) AS free_read,
           (SELECT cd.document_url FROM source_documents cd WHERE cd.id = nr.source_document_id) AS document_url,
           cur_doc.crawled_at AS current_crawled_at, stale.crawled_at AS prior_crawled_at,
           stale.fee_published_id AS prior_fee_published_id, stale.fee_name AS prior_fee_name,
           stale.canonical_fee_key AS prior_canonical_fee_key,
           stale.amount AS prior_amount, stale.amount_kind AS prior_amount_kind,
           stale.rate_percent AS prior_rate_percent, stale.source_document_id AS prior_source_document_id,
           stale.fee_audience AS prior_fee_audience, stale.product_name AS prior_product_name,
           stale.lineage_ref AS prior_lineage_ref,
           stale.published_state, stale.identity_raw_id, stale.identity_product,
           current_copy.depth AS chain_depth
      FROM stale
      JOIN current_copy ON current_copy.start_id = stale.source_document_id
      JOIN source_documents cur_doc ON cur_doc.id = current_copy.doc_id
      JOIN raw_fee_observations nr ON nr.source_document_id = current_copy.doc_id
      JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
     WHERE nv.institution_id = stale.institution_id
       AND nv.canonical_fee_key = stale.canonical_fee_key
       AND COALESCE(nv.variant_type, '') = stale.variant_type
       AND COALESCE(nv.frequency, '') = stale.frequency
       AND COALESCE(nv.amount_kind, 'flat') = COALESCE(stale.amount_kind, 'flat')
       AND nv.amount IS NOT DISTINCT FROM stale.amount
       AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
       AND COALESCE(nv.fee_audience, 'unknown') = stale.fee_audience
       AND ${db.unsafe(productKeySql("nr.product_name"))} = ${db.unsafe(productKeySql("stale.product_name"))}
       AND nv.review_status IN ('verified', 'approved')
       AND nv.outlier_flags ? 'agentic_darwin_verified'
       -- Publish's own pairing: its latest decision on this row, at today's rule version, skipped
       -- it as identical to this live fee.
       AND EXISTS (
         SELECT 1 FROM (
           SELECT latest.detail FROM pipeline_attempts latest
            WHERE latest.input_fingerprint = 'verified:' || nv.fee_verified_id::text
              AND latest.strategy = ${HAMILTON_PUBLISH_STRATEGY.strategy}
              AND latest.strategy_version = ${HAMILTON_PUBLISH_STRATEGY.version}
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
         ) skip
          WHERE skip.detail->>'reason' = ${IDENTICAL_FEE_REASON}
            AND skip.detail->>'previous_fee_published_id' = stale.fee_published_id::text
       )
       -- Never a row live elsewhere, nor one a check took down; a bookkeeping close is fine.
       AND NOT EXISTS (
         SELECT 1 FROM published_fee_records other
          WHERE other.lineage_ref = nv.fee_verified_id
            AND (other.rolled_back_at IS NULL OR NOT ${db.unsafe(BOOKKEEPING_CLOSE_SQL("other", "stale.fee_published_id"))})
       )
       AND (NOT ${options.live}::boolean OR NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.input_fingerprint = ${`v${CURRENT_COPY_REPOINT_STRATEGY.version}:`} || stale.fee_published_id::text || ':' || nv.fee_verified_id::text
            AND pa.strategy = ${CURRENT_COPY_REPOINT_STRATEGY.strategy}
            AND pa.strategy_version = ${CURRENT_COPY_REPOINT_STRATEGY.version}
       ))
     ORDER BY stale.fee_published_id, nv.fee_verified_id
     LIMIT ${options.limit ?? CURRENT_COPY_REPOINT_LIMIT}
  `;
  if (rows.length === 0) return rows;
  // Each current copy's newest completed stored text, read once per document (not once per pair).
  const documentIds = [...new Set(rows.map((row) => Number(row.source_document_id)).filter(Number.isFinite))];
  const texts = await db<Array<{ source_document_id: number | string; normalized_text: string | null }>>`
    SELECT DISTINCT ON (ast.source_document_id) ast.source_document_id, ast.normalized_text
      FROM agent_source_texts ast
     WHERE ast.source_document_id = ANY(${documentIds}::bigint[]) AND ast.status = 'completed'
     ORDER BY ast.source_document_id, ast.id DESC
  `;
  const byDocument = new Map<number, { text: string | null; opening: string | null }>();
  for (const text of texts) {
    const normalized = text.normalized_text ?? null;
    // #1944: the document's opening, for publishSkipReason's non-deposit gate (SQL left(), in characters).
    byDocument.set(Number(text.source_document_id), { text: normalized, opening: normalized == null ? null : openingOf(normalized) });
  }
  return rows.map((row) => {
    const found = byDocument.get(Number(row.source_document_id));
    // v2: the live fee and the row's own line are re-checked against this text.
    return { ...row, document_opening: found?.opening ?? null, current_text: found?.text ?? null };
  });
}

/** The first `OPENING_SCAN_CHARS` characters (code points, as SQL `left()` counts them). */
function openingOf(text: string): string {
  if (text.length <= OPENING_SCAN_CHARS) return text;
  let end = 0;
  for (let count = 0; count < OPENING_SCAN_CHARS && end < text.length; count += 1) {
    const code = text.charCodeAt(end);
    end += code >= 0xd800 && code <= 0xdbff && end + 1 < text.length ? 2 : 1;
  }
  return text.slice(0, end);
}

const sampleOf = (candidate: CurrentCopyRepointCandidate): CurrentCopyRepointSample => ({
  feePublishedId: Number(candidate.prior_fee_published_id),
  feeVerifiedId: Number(candidate.fee_verified_id),
  institutionId: Number(candidate.institution_id),
  feeName: candidate.prior_fee_name,
  priorSourceDocumentId: Number(candidate.prior_source_document_id),
  currentSourceDocumentId: candidate.source_document_id == null ? null : Number(candidate.source_document_id),
});

/**
 * Hamilton publish (#1200): live fees that publish skipped a current-copy row as identical to move
 * onto that row in place. Live (`PUBLISH_REPOINT_CURRENT_COPY_LIVE`), each pair is written, recorded
 * once in `pipeline_attempts` (`hamilton.current_copy_repoint` v2) and summed in an
 * `agent_run_events` row. Shadow (switch off), only the event is written, with the count it would
 * re-point. A dry run reads and writes nothing.
 */
export async function repointLiveFeesToCurrentCopy(
  db: SqlTag,
  options: {
    runId: number;
    stepId?: number | null;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    limit?: number;
    minConfidence?: number;
    /** Defaults to `PUBLISH_REPOINT_CURRENT_COPY_LIVE`. */
    live?: boolean;
    /**
     * The publish step's deadline (as `recordPublishLocations` takes it): no read starts after it,
     * and the text checks stop there; the pairs left are counted as not checked, never moved.
     */
    deadlineAt?: number;
    now?: () => number;
  },
): Promise<CurrentCopyRepointResult> {
  const live = options.live ?? PUBLISH_REPOINT_CURRENT_COPY_LIVE;
  const now = options.now ?? Date.now;
  const empty: CurrentCopyRepointResult = { live, checked: 0, eligible: 0, repointed: 0, skipped: {}, notChecked: 0, samples: [] };
  if (options.deadlineAt != null && now() >= options.deadlineAt) return empty;
  let candidates: CurrentCopyRepointCandidate[];
  try {
    candidates = await inSavepoint(db, (scope) => selectCurrentCopyRepointCandidates(scope as SqlTag, {
      institutionId: options.institutionId,
      stateCode: options.stateCode,
      limit: options.limit,
      live,
    }));
  } catch (error) {
    // A failed read must never block publishing.
    console.error("repointLiveFeesToCurrentCopy select failed:", error);
    return empty;
  }
  if (candidates.length === 0) return empty;

  const plan = planCurrentCopyRepoints(candidates, options.minConfidence ?? HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE, {
    deadlineAt: options.deadlineAt,
    now,
  });
  const skipped: CurrentCopyRepointResult["skipped"] = {};
  for (const skip of plan.skipped) skipped[skip.reason] = (skipped[skip.reason] ?? 0) + 1;
  const notChecked = plan.notChecked.length;
  const notCheckedNote = notChecked ? `; ${notChecked} pair(s) not checked, the step's deadline passed` : "";
  const result: CurrentCopyRepointResult = {
    live,
    checked: candidates.length,
    eligible: plan.repoint.length,
    repointed: 0,
    skipped,
    notChecked,
    samples: plan.repoint.slice(0, 20).map(sampleOf),
  };
  if (options.dryRun) return result;

  if (!live) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, 'hamilton.current_copy_repoint', 'completed',
          ${`Shadow: would re-point ${plan.repoint.length} live fee(s) to the current copy of their page (publish skipped that copy's row as identical); ${plan.skipped.length} pair(s) left as they are${notCheckedNote}. PUBLISH_REPOINT_CURRENT_COPY_LIVE is off, nothing changed`},
          ${JSON.stringify({ batch_id: options.batchId, live: false, checked: candidates.length, would_repoint: plan.repoint.length, skipped, not_checked: notChecked, samples: result.samples })}::jsonb
        )
      `);
    } catch (error) {
      console.error("repointLiveFeesToCurrentCopy shadow event failed:", error);
    }
    return result;
  }

  let repointed = 0;
  const samples: CurrentCopyRepointSample[] = [];
  try {
    await inSavepoint(db, async (scope) => {
      for (const candidate of plan.repoint) {
        const priorId = Number(candidate.prior_fee_published_id);
        const feePublishedId = await moveLiveFeeInPlace(scope, candidate).catch((error) => {
          console.error("repointLiveFeesToCurrentCopy pair failed:", error);
          return null;
        });
        if (feePublishedId) {
          repointed += 1;
          if (samples.length < 20) samples.push(sampleOf(candidate));
        }
        await recordAttempt(scope, {
          institutionId: Number(candidate.institution_id),
          sourceDocumentId: Number(candidate.prior_source_document_id),
          stage: "publish",
          strategy: CURRENT_COPY_REPOINT_STRATEGY.strategy,
          version: CURRENT_COPY_REPOINT_STRATEGY.version,
          fingerprint: currentCopyRepointFingerprint(priorId, candidate.fee_verified_id),
          outcome: feePublishedId ? "ok" : "unchanged",
          yieldCount: feePublishedId ? 1 : 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: {
            fee_published_id: priorId,
            fee_verified_id: Number(candidate.fee_verified_id),
            repointed: Boolean(feePublishedId),
            in_place: true,
            prior_lineage_ref: candidate.prior_lineage_ref == null ? null : Number(candidate.prior_lineage_ref),
            prior_source_document_id: Number(candidate.prior_source_document_id),
            current_document_id: candidate.source_document_id == null ? null : Number(candidate.source_document_id),
            chain_depth: candidate.chain_depth == null ? null : Number(candidate.chain_depth),
          },
        });
      }
      for (const skip of plan.skipped) {
        await recordAttempt(scope, {
          institutionId: Number(skip.candidate.institution_id),
          sourceDocumentId: Number(skip.candidate.prior_source_document_id),
          stage: "publish",
          strategy: CURRENT_COPY_REPOINT_STRATEGY.strategy,
          version: CURRENT_COPY_REPOINT_STRATEGY.version,
          fingerprint: currentCopyRepointFingerprint(skip.candidate.prior_fee_published_id, skip.candidate.fee_verified_id),
          outcome: "unchanged",
          yieldCount: 0,
          costMicrousd: 0,
          runId: options.runId,
          stepId: options.stepId ?? null,
          foldIntoPlaybook: false,
          detail: {
            fee_published_id: Number(skip.candidate.prior_fee_published_id),
            fee_verified_id: Number(skip.candidate.fee_verified_id),
            reason: skip.reason,
            reason_detail: skip.detail ?? null,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, 'hamilton.current_copy_repoint', 'completed',
          ${`Re-pointed ${repointed} live fee(s) to the current copy of their page in place (publish skipped that copy's row as identical; name, amount and category unchanged); ${plan.skipped.length} pair(s) left as they are${notCheckedNote}`},
          ${JSON.stringify({ batch_id: options.batchId, live: true, checked: candidates.length, eligible: plan.repoint.length, repointed, skipped, not_checked: notChecked, samples })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("repointLiveFeesToCurrentCopy write failed:", error);
    return { ...result, repointed: 0, samples: [] };
  }
  if (repointed > 0) invalidatePublicReadCache();
  return { ...result, repointed, samples };
}
