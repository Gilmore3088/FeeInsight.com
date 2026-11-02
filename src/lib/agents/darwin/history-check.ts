import type { sql } from "@/lib/data-store/connection";
import { productKey, productKeySql } from "@/lib/fee-product";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { isPercentFee } from "@/lib/percent-fees";
import { feeNameKeySql, judgeFeeChange, sameFeeName, type FeeChangeHold } from "@/lib/report-assemblers/monthly-pulse";
import { editionStarts, sameSchedule } from "@/lib/agents/hamilton/schedule-edition";
import { feePageKey } from "@/lib/agents/hamilton/page-key";

type SqlTag = typeof sql;

/**
 * Darwin's history check (Pipeline wiring audit, Nov 2, Gap 9). Before a new fee is verified,
 * nothing compared it with the same bank's earlier value: prior-value logic lived only in the
 * competitor alerts and the Monthly Pulse (`judgeFeeChange`). A fee read at $3.50 where the bank's
 * live price for that fee has been $35, or $0 where it has been $30, went straight to publish
 * because its own text printed the number somewhere the source check accepted.
 *
 * The check compares a fee with the bank's live published values for the same institution,
 * category, customer audience, product (`productKey`) and fee name (`sameFeeName`), read from
 * another stored document (a price on the same document is a sibling line the source check
 * already judged; a price under another name is another fee). When no prior is
 * within `HISTORY_JUMP_RATIO` of the new amount at a compatible unit, the move must be supported by
 * the bank's current copy:
 *   - `both_stated`: the new fee's own text still prints the prior fee at its prior price, so the
 *     new row is another line of the same schedule (an incoming and an outgoing wire), not a move;
 *   - `change_confirmed`: `judgeFeeChange` (the rule the Monthly Pulse and competitor alerts use)
 *     confirms a change the bank made: same schedule, the old copy prints the old price, the new
 *     copy prints the new price and no longer the old one, and it is not an older edition.
 * v2 (Nov 2): only priors whose own text prints them, on the fee's own page or schedule, count;
 * another page only retires a stale edition. What the support test cannot explain is
 * `older_edition` (held at verify, taken down live), a same-page `jump` (held at verify, review
 * live) or a same-schedule `review` (reported only). See `historyVerdict`. Holds and takedowns act
 * only while `DARWIN_HISTORY_CHECK_LIVE` is on. Pure, except the loaders at the end of this file.
 */

/**
 * Default-off switch. Off, verify records each fee's history verdict on its attempt
 * (`detail.history`) and counts the fees it would hold (`historyCheck.wouldHold`); the verified
 * recheck reads a sample of live fees and reports what it would flag (`historyLive`). Nothing is
 * held or taken down. On, verify holds an `older_edition` or a same-page `jump` as `history_jump`
 * and the recheck's history cohort flags a live `older_edition` through the shared 12-hour second
 * look (a live `jump` or `review` is reported for review, never taken down). It turns on by PR once the shadow counts
 * are read and a sample is checked against the stored texts. Roll back by setting it to false: the
 * standing-decision SQL then re-reads every `history_jump` hold.
 */
export const DARWIN_HISTORY_CHECK_LIVE = false;

/**
 * Version of the history rule, recorded on verify (`detail.history_rule_version`) and recheck
 * (`detail.history_rule`) attempts. A `history_jump` hold under an older version is re-read once,
 * and a live fee is read by the recheck's history cohort once per version.
 *
 * v2 (Nov 2): a fresh sample of 20 live fees would have taken down 13, 8 of them wrongly (6 a
 * generic name on two accounts' or products' pages, 1 a prior that was itself a misread, 1 a real
 * price cut the change rule missed). Priors now count only on the fee's own page or schedule and
 * only when their own text prints them, held priors are skipped, one fee-name source (Knox's raw
 * name) is used everywhere, and the live twin takes down only an `older_edition`.
 */
export const HISTORY_RULE_VERSION = 2;

/**
 * A move of at least this ratio, either way (+50%, or down to two thirds), needs support. Calibrated
 * on prod (read-only, 2026-11-02, `docs/project/findings/2026-11-02-darwin-history-check.md`): of
 * 9,006 fees verified in 14 days with a live prior from another document, 7,550 matched a prior
 * exactly; the moves spread 195 under 1.25x, 164 at 1.25-1.5x, 235 at 1.5-2x, 300 at 2-3x and 420
 * at 3x or more (plus 142 $0 against a charge). Ordinary price changes sit under 1.5x ($30 to $35 is
 * 1.17x); below it the band is mostly real repricing, above it mostly sibling lines and misreads.
 */
export const HISTORY_JUMP_RATIO = 1.5;

/** Live fees the recheck's history cohort reads per step. */
export const HISTORY_RULE_LIMIT = 100;

export type HistoryUnit = "item" | "month" | "hour" | "annual" | "daily" | "quarterly" | "one_time";

/** The charging unit a frequency names, or null when it names none Darwin compares. Pure. */
export function unitOf(frequency: string | null | undefined): HistoryUnit | null {
  switch ((frequency ?? "").trim().toLowerCase()) {
    case "per_item": case "per_occurrence": case "per_transaction": return "item";
    case "monthly": case "per_statement": return "month";
    case "hourly": case "per_half_hour": return "hour";
    case "annual": return "annual";
    case "daily": return "daily";
    case "quarterly": return "quarterly";
    case "one_time": return "one_time";
    default: return null;
  }
}

/** The same unit mapping as `unitOf`, as SQL over a frequency column. Internal column names only. */
export function unitSql(column: string): string {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal frequency column");
  return `CASE lower(btrim(COALESCE(${column}, '')))
    WHEN 'per_item' THEN 'item' WHEN 'per_occurrence' THEN 'item' WHEN 'per_transaction' THEN 'item'
    WHEN 'monthly' THEN 'month' WHEN 'per_statement' THEN 'month'
    WHEN 'hourly' THEN 'hour' WHEN 'per_half_hour' THEN 'hour'
    WHEN 'annual' THEN 'annual' WHEN 'daily' THEN 'daily' WHEN 'quarterly' THEN 'quarterly' WHEN 'one_time' THEN 'one_time'
    ELSE NULL END`;
}

/** Both units are stated and differ ("monthly" against "per item"). Pure. */
export function unitsDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = unitOf(a);
  const y = unitOf(b);
  return x != null && y != null && x !== y;
}

/** The larger amount over the smaller: 1 when equal, Infinity for $0 against a charge. Pure. */
export function amountRatio(a: number, b: number): number {
  if (a === b) return 1;
  if (a <= 0 || b <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(a / b, b / a);
}

export interface HistoryFee {
  feeName: string;
  amount: number | null;
  frequency: string | null;
  sourceDocumentId: number | null;
  /** The document's own URL when known, else the fee's source URL. */
  sourceUrl: string | null;
  /** The new fee's stored text (its own document). */
  text: string | null;
}

export interface HistoryPrior {
  feePublishedId: number;
  feeName: string;
  amount: number;
  frequency: string | null;
  sourceDocumentId: number | null;
  sourceUrl: string | null;
}

/**
 * v2 outcomes. `no_prior`, `consistent`, `both_stated` and `change_confirmed` pass. A prior with
 * nothing to compare (on another page that is not the same schedule and not a stale edition of it,
 * or one whose own text does not print it) is `not_comparable` and passes. The rest:
 *   - `older_edition`: the fee's own copy is an earlier edition than the prior's. Verify holds it;
 *     the live twin flags it for takedown (the only outcome it takes down);
 *   - `jump`: the same page, an unexplained move. Verify holds it; the live twin sends it to review;
 *   - `review`: the same schedule on another page (a newer dated edition), an unexplained move.
 *     Nothing holds it; both report it for a person to look at.
 */
export type HistoryOutcome =
  | "no_prior" | "consistent" | "not_comparable" | "both_stated" | "change_confirmed" | "older_edition" | "jump" | "review";

/** How a prior relates to the fee's page: the same page, the same schedule elsewhere, or another page. */
export type HistoryScope = "same_page" | "same_schedule" | "other_page";

export interface HistoryVerdict {
  outcome: HistoryOutcome;
  /** Verify holds the fee as `history_jump` (while live): `older_edition`, or a same-page `jump`. */
  hold: boolean;
  /** The live twin flags the fee for takedown: `older_edition` only. */
  takedown?: boolean;
  /** The prior the fee was compared with: the nearest by amount, a unit match first. */
  prior?: HistoryPrior;
  /** Where that prior sits against the fee's own page. */
  scope?: HistoryScope;
  /** New amount against that prior (`amountRatio`); null when JSON cannot carry Infinity. */
  ratio?: number | null;
  /** Why the move needed support: the amount moved, or the charging unit changed. */
  kind?: "amount" | "unit";
  /** `judgeFeeChange`'s reason when it did not confirm the move. */
  changeHold?: FeeChangeHold;
}

/**
 * Off its own page, a fee is an `older_edition` only when its copy is at least this many days older
 * than the prior's. Two current pages of one bank (a product page and the schedule, each dated) can
 * carry dates months apart; a 2018 schedule beside a 2026 disclosure is a stale copy. On one page,
 * any earlier edition is.
 */
export const OTHER_PAGE_STALE_DAYS = 365;

/** A prior that agrees with the new fee: within the ratio, at the same or an unstated unit. Pure. */
function consistentWith(fee: HistoryFee & { amount: number }, prior: HistoryPrior): boolean {
  // The same amount agrees whatever unit each read stated: a frequency read differently is the
  // frequency checks' business, not a move in price.
  if (fee.amount === prior.amount) return true;
  return amountRatio(fee.amount, prior.amount) < HISTORY_JUMP_RATIO && !unitsDiffer(fee.frequency, prior.frequency);
}

/**
 * The priors a fee is compared with: dollar amounts for the same fee name (`sameFeeName`, the
 * normalisation `judgeFeeChange` uses) from another stored document. A prior under another name is
 * another fee of the category (statement copy against per-page copies, a bank draft against a
 * mailed draft), not an earlier value of this one: in the 2026-11-02 sample, both wrong holds were
 * such pairs. Pure.
 */
export function comparablePriors(fee: Pick<HistoryFee, "sourceDocumentId" | "feeName">, priors: readonly HistoryPrior[]): HistoryPrior[] {
  return priors.filter((prior) =>
    Number.isFinite(prior.amount)
    && sameFeeName(prior.feeName, fee.feeName)
    && !(fee.sourceDocumentId != null && prior.sourceDocumentId != null && Number(fee.sourceDocumentId) === Number(prior.sourceDocumentId)));
}

/**
 * The first, text-free half of the check: `no_prior`, `consistent`, or the priors a move must be
 * supported against (`priors`, nearest first; `prior` is the nearest). Callers load the stored texts
 * of `priors` for the second half. Pure.
 */
export function historyCandidate(fee: HistoryFee, priors: readonly HistoryPrior[]):
  | { outcome: "no_prior" | "consistent" }
  | { outcome: "needs_support"; prior: HistoryPrior; priors: HistoryPrior[]; ratio: number; kind: "amount" | "unit" } {
  if (fee.amount == null || !Number.isFinite(fee.amount)) return { outcome: "no_prior" };
  const amount = fee.amount;
  const comparable = comparablePriors(fee, priors);
  if (comparable.length === 0) return { outcome: "no_prior" };
  const withAmount = { ...fee, amount };
  if (comparable.some((prior) => consistentWith(withAmount, prior))) return { outcome: "consistent" };
  const nearest = [...comparable].sort((a, b) =>
    Number(unitsDiffer(fee.frequency, a.frequency)) - Number(unitsDiffer(fee.frequency, b.frequency))
    || amountRatio(amount, a.amount) - amountRatio(amount, b.amount)
    || b.feePublishedId - a.feePublishedId);
  const ratio = amountRatio(amount, nearest[0].amount);
  return { outcome: "needs_support", prior: nearest[0], priors: nearest, ratio, kind: ratio >= HISTORY_JUMP_RATIO ? "amount" : "unit" };
}

/**
 * Where a prior sits against the fee's page (v2). `same_page`: one page (`feePageKey`). `same_schedule`:
 * a newer dated edition of the same audience's schedule either way (`sameSchedule`, with the change
 * rule's `undatedOld`). Otherwise `other_page`: a generic name on two accounts' or products' pages
 * ("Monthly service fee" on a Student Checking page and in a savings disclosure) is two fees, not a
 * move, so another page only ever retires a stale edition. Pure.
 */
export function priorScope(fee: Pick<HistoryFee, "sourceUrl" | "text">, prior: Pick<HistoryPrior, "sourceUrl">, priorText: string | null): HistoryScope {
  const page = feePageKey(fee.sourceUrl);
  if (page != null && page === feePageKey(prior.sourceUrl)) return "same_page";
  const forward = sameSchedule({ oldUrl: prior.sourceUrl, newUrl: fee.sourceUrl, oldText: priorText, newText: fee.text }, { undatedOld: true });
  const backward = sameSchedule({ oldUrl: fee.sourceUrl, newUrl: prior.sourceUrl, oldText: fee.text, newText: priorText }, { undatedOld: true });
  return forward || backward ? "same_schedule" : "other_page";
}

const SCOPE_RANK: Record<HistoryScope, number> = { same_page: 0, same_schedule: 1, other_page: 2 };

/** Days from `a` to `b` (YYYY-MM-DD). Pure. */
function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** The edition a stored text states, its "Reviewed:" / "Updated:" line included (`reviewedEdition`). Pure. */
export function historyEdition(text: string | null | undefined): string | null {
  return editionStarts(text, undefined, true);
}

/**
 * The history verdict for one fee against its priors (`priorTexts`: stored text by document id, for
 * the priors `historyCandidate` returned). v2 (Nov 2 sample: 8 of 13 would-be takedowns wrong):
 *   1. a prior counts only when its own stored text prints its name at its amount (the shared source
 *      check): a live prior that is itself a misread (Maui County's $1 "Account Closure", a column
 *      slip) proves nothing (held priors are dropped by the loaders);
 *   2. it counts only on the fee's own page or schedule (`priorScope`); another page only retires
 *      a stale edition;
 *   3. `both_stated` passes as in v1; then `older_edition`: the fee's copy (`historyEdition`) is an
 *      earlier edition than the prior's, on the same page, or `OTHER_PAGE_STALE_DAYS` or more
 *      earlier elsewhere;
 *   4. on the same page or schedule, `judgeFeeChange` then confirms a change, and what it cannot
 *      explain is a same-page `jump` or a same-schedule `review`. Pure.
 */
export function historyVerdict(fee: HistoryFee, priors: readonly HistoryPrior[], priorTexts: ReadonlyMap<number, string>): HistoryVerdict {
  const candidate = historyCandidate(fee, priors);
  if (candidate.outcome !== "needs_support") return { outcome: candidate.outcome, hold: false };
  const scoped = candidate.priors.flatMap((prior) => {
    const text = prior.sourceDocumentId == null ? null : priorTexts.get(Number(prior.sourceDocumentId)) ?? null;
    if (!text || !checkFeeAgainstSource(text, prior.feeName, prior.amount, ".").ok) return [];
    return [{ prior, text, scope: priorScope(fee, prior, text) }];
  });
  const roundRatio = (ratio: number) => (Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null);
  if (scoped.length === 0) {
    return { outcome: "not_comparable", hold: false, prior: candidate.prior, ratio: roundRatio(candidate.ratio), kind: candidate.kind };
  }
  // Stable: within a scope, `historyCandidate`'s nearest-first order holds.
  const { prior, text: priorText, scope } = [...scoped].sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope])[0];
  const ratio = amountRatio(fee.amount!, prior.amount);
  const base = { prior, scope, ratio: roundRatio(ratio), kind: (ratio >= HISTORY_JUMP_RATIO ? "amount" : "unit") as "amount" | "unit" };
  // The current copy still prints the prior fee at its prior price: two lines of one schedule.
  if (fee.text && checkFeeAgainstSource(fee.text, prior.feeName, prior.amount, ".").ok) {
    return { ...base, outcome: "both_stated", hold: false };
  }
  const feeEdition = historyEdition(fee.text);
  const priorEdition = historyEdition(priorText);
  if (feeEdition && priorEdition && feeEdition < priorEdition
    && (scope === "same_page" || daysBetween(feeEdition, priorEdition) >= OTHER_PAGE_STALE_DAYS)) {
    return { ...base, outcome: "older_edition", hold: true, takedown: true, changeHold: "older_edition" };
  }
  if (scope === "other_page") return { ...base, outcome: "not_comparable", hold: false };
  const judged = judgeFeeChange({
    institution_name: "",
    state_code: null,
    charter_type: null,
    fee_key: "",
    fee_name: fee.feeName,
    old_fee_name: prior.feeName,
    old_amount: prior.amount,
    new_amount: fee.amount,
    changed_at: "",
    source_url: fee.sourceUrl,
    old_source_url: prior.sourceUrl,
    new_document_text: fee.text,
    old_document_text: priorText,
    old_document_id: prior.sourceDocumentId,
    new_document_id: fee.sourceDocumentId,
  }, { reviewedEdition: true });
  if (judged.change) return { ...base, outcome: "change_confirmed", hold: false };
  if (scope === "same_page") return { ...base, outcome: "jump", hold: true, takedown: false, changeHold: judged.hold };
  return { ...base, outcome: "review", hold: false, takedown: false, changeHold: judged.hold };
}

/** The attempt-log form of a verdict: small, ids and numbers only, never fee text. Pure. */
export function historyDetail(verdict: HistoryVerdict, live: boolean): Record<string, unknown> {
  return {
    outcome: verdict.outcome,
    would_hold: verdict.hold,
    held: verdict.hold && live,
    would_take_down: verdict.takedown === true,
    review: verdict.outcome === "jump" || verdict.outcome === "review",
    ...(verdict.scope ? { scope: verdict.scope } : {}),
    ...(verdict.prior ? {
      prior_fee_published_id: verdict.prior.feePublishedId,
      prior_amount: verdict.prior.amount,
      prior_source_document_id: verdict.prior.sourceDocumentId,
    } : {}),
    ...(verdict.ratio !== undefined ? { ratio: verdict.ratio } : {}),
    ...(verdict.kind ? { kind: verdict.kind } : {}),
    ...(verdict.changeHold ? { change_hold: verdict.changeHold } : {}),
  };
}

/** A live published fee read as a possible prior, with the keys it is matched on. */
export interface PriorCandidateRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
  frequency: string | null;
  fee_audience: string | null;
  amount_kind: string | null;
  source_url: string | null;
  document_url: string | null;
  source_document_id: number | string | null;
  product_name: string | null;
  published_at: string | Date | null;
  rolled_back_reason: string | null;
  /**
   * The prior is itself held (v2): its verified row is no longer verified or approved, or a check has
   * a takedown pending on it (`takedown_pending`). A held prior is no evidence of the bank's price.
   */
  held?: boolean | null;
}

/** The keys a fee is matched to its priors on. */
export interface HistoryKey {
  institutionId: number;
  canonicalFeeKey: string;
  feeAudience: string | null | undefined;
  productName: string | null | undefined;
}

/**
 * The candidate rows that are this fee's priors: same institution, category, audience and product,
 * not held. Pure.
 */
export function priorsFor(key: HistoryKey, candidates: readonly PriorCandidateRow[]): HistoryPrior[] {
  const audience = key.feeAudience ?? "unknown";
  const product = productKey(key.productName);
  return candidates.flatMap((row) => {
    if (Number(row.institution_id) !== key.institutionId || row.canonical_fee_key !== key.canonicalFeeKey) return [];
    if ((row.fee_audience ?? "unknown") !== audience || productKey(row.product_name) !== product) return [];
    if (isPercentFee(row) || row.amount == null || row.fee_name == null || row.held === true) return [];
    const amount = Math.round(Number(row.amount) * 100) / 100;
    if (!Number.isFinite(amount)) return [];
    return [{
      feePublishedId: Number(row.fee_published_id),
      feeName: row.fee_name,
      amount,
      frequency: row.frequency,
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      sourceUrl: row.document_url ?? row.source_url,
    }];
  });
}

/**
 * Read-only: the live dollar fees of these institutions, the priors a new fee is compared with at
 * verify. A new value supersedes its prior only at publish, so at verify the prior is still live.
 * The name is Knox's raw `fee_name` (v2), the name verify has for the new fee: Hamilton's published
 * name can differ (an account heading added later), and one source keeps verify, the live verdict
 * and `historyCohortSql` on the same match.
 */
export async function loadLivePriors(db: SqlTag, institutionIds: readonly number[]): Promise<PriorCandidateRow[]> {
  const ids = [...new Set(institutionIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  return db<PriorCandidateRow[]>`
    SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fr.fee_name, fp.amount, fp.frequency,
           fp.fee_audience, fp.amount_kind, fp.source_url, sd.document_url, fr.source_document_id, fr.product_name,
           fp.published_at, fp.rolled_back_reason,
           (fv.review_status NOT IN ('verified', 'approved')
             OR EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = fp.fee_published_id AND pf.kind = 'takedown_pending')) AS held
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
     WHERE fp.institution_id = ANY(${ids}::int[])
       AND fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount IS NOT NULL
  `;
}

/**
 * Read-only: for each of these live published fees, the fees that were its priors when it was
 * published (published earlier, not quarantined, and still live or closed as superseded by it),
 * matched on its audience and product (`priorsFor`). Keyed by the live fee's published id.
 */
export async function loadPriorsAtPublish(db: SqlTag, publishedIds: readonly number[]): Promise<Map<number, HistoryPrior[]>> {
  const ids = [...new Set(publishedIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const byLive = new Map<number, HistoryPrior[]>();
  if (ids.length === 0) return byLive;
  const rows = await db<Array<PriorCandidateRow & { live_fee_published_id: number | string; live_fee_audience: string | null; live_product_name: string | null }>>`
    SELECT p.fee_published_id AS live_fee_published_id, p.fee_audience AS live_fee_audience, pr.product_name AS live_product_name,
           q.fee_published_id, q.institution_id, q.canonical_fee_key, qr.fee_name, q.amount, q.frequency,
           q.fee_audience, q.amount_kind, q.source_url, sd.document_url, qr.source_document_id, qr.product_name,
           q.published_at, q.rolled_back_reason,
           (qv.review_status NOT IN ('verified', 'approved')
             OR EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = q.fee_published_id AND pf.kind = 'takedown_pending')) AS held
      FROM published_fee_records p
      JOIN verified_fee_observations pv ON pv.fee_verified_id = p.lineage_ref
      JOIN raw_fee_observations pr ON pr.fee_raw_id = pv.fee_raw_id
      JOIN published_fee_records q
        ON q.institution_id = p.institution_id
       AND q.canonical_fee_key = p.canonical_fee_key
       AND q.fee_published_id <> p.fee_published_id
       AND q.published_at < p.published_at
       AND q.quarantined_at IS NULL
       AND q.amount IS NOT NULL
       AND (q.rolled_back_at IS NULL OR q.rolled_back_reason = 'superseded by #' || p.fee_published_id::text)
      JOIN verified_fee_observations qv ON qv.fee_verified_id = q.lineage_ref
      JOIN raw_fee_observations qr ON qr.fee_raw_id = qv.fee_raw_id
      LEFT JOIN source_documents sd ON sd.id = qr.source_document_id
     WHERE p.fee_published_id = ANY(${ids}::bigint[])
  `;
  for (const row of rows) {
    const live = Number(row.live_fee_published_id);
    const priors = priorsFor({
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeAudience: row.live_fee_audience,
      productName: row.live_product_name,
    }, [row]);
    byLive.set(live, [...(byLive.get(live) ?? []), ...priors]);
  }
  return byLive;
}

/**
 * SQL (live published alias `p`, its raw row `r`): the live fee has a prior at publish (as
 * `loadPriorsAtPublish` reads it, same audience and product, another document, not held, the same
 * raw fee name by `sameFeeName`'s normalisation) and none of its priors agrees with it
 * (`consistentWith`). The recheck's history cohort selects on it; the page and the texts then
 * decide (`historyVerdict`). Constants inlined; no user text.
 */
export function historyCohortSql(): string {
  const priorJoin = `
           FROM published_fee_records q
           JOIN verified_fee_observations qv ON qv.fee_verified_id = q.lineage_ref
           JOIN raw_fee_observations qr ON qr.fee_raw_id = qv.fee_raw_id
          WHERE q.institution_id = p.institution_id
            AND q.canonical_fee_key = p.canonical_fee_key
            AND q.fee_published_id <> p.fee_published_id
            AND q.published_at < p.published_at
            AND q.quarantined_at IS NULL
            AND q.amount IS NOT NULL
            AND COALESCE(q.amount_kind, '') <> 'percent'
            AND (q.rolled_back_at IS NULL OR q.rolled_back_reason = 'superseded by #' || p.fee_published_id::text)
            AND COALESCE(q.fee_audience, 'unknown') = COALESCE(p.fee_audience, 'unknown')
            AND ${productKeySql("qr.product_name")} = ${productKeySql("r.product_name")}
            AND qr.source_document_id IS DISTINCT FROM r.source_document_id
            AND ${feeNameKeySql("qr.fee_name")} = ${feeNameKeySql("r.fee_name")}
            AND qv.review_status IN ('verified', 'approved')
            AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = q.fee_published_id AND pf.kind = 'takedown_pending')`;
  return `(COALESCE(p.amount_kind, '') <> 'percent' AND p.amount IS NOT NULL
         AND EXISTS (SELECT 1 ${priorJoin})
         AND NOT EXISTS (SELECT 1 ${priorJoin}
            AND (q.amount = p.amount
                 OR (q.amount > 0 AND p.amount > 0 AND greatest(q.amount / p.amount, p.amount / q.amount) < ${HISTORY_JUMP_RATIO}
                     AND NOT (${unitSql("q.frequency")} IS NOT NULL AND ${unitSql("p.frequency")} IS NOT NULL AND ${unitSql("q.frequency")} <> ${unitSql("p.frequency")})))))`;
}
