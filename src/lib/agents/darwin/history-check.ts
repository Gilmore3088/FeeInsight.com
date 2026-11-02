import type { sql } from "@/lib/data-store/connection";
import { productKey, productKeySql } from "@/lib/fee-product";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { isPercentFee } from "@/lib/percent-fees";
import { feeNameKeySql, judgeFeeChange, sameFeeName, type FeeChangeHold } from "@/lib/report-assemblers/monthly-pulse";

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
 * Otherwise the fee is a `jump`, held as `history_jump` (needs_review) for a re-read or a second
 * look while `DARWIN_HISTORY_CHECK_LIVE` is on, and only reported while it is off. Pure, except the
 * loaders at the end of this file.
 */

/**
 * Default-off switch. Off, verify records each fee's history verdict on its attempt
 * (`detail.history`) and counts the fees it would hold (`historyCheck.wouldHold`); the verified
 * recheck reads a sample of live fees and reports what it would flag (`historyLive`). Nothing is
 * held or taken down. On, verify holds a `jump` as `history_jump` and the recheck's history cohort
 * flags live jumps through the shared 12-hour second look. It turns on by PR once the shadow counts
 * are read and a sample is checked against the stored texts. Roll back by setting it to false: the
 * standing-decision SQL then re-reads every `history_jump` hold.
 */
export const DARWIN_HISTORY_CHECK_LIVE = false;

/**
 * Version of the history rule, recorded on verify (`detail.history_rule_version`) and recheck
 * (`detail.history_rule`) attempts. A `history_jump` hold under an older version is re-read once,
 * and a live fee is read by the recheck's history cohort once per version.
 */
export const HISTORY_RULE_VERSION = 1;

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

export type HistoryOutcome = "no_prior" | "consistent" | "both_stated" | "change_confirmed" | "jump";

export interface HistoryVerdict {
  outcome: HistoryOutcome;
  /** True only for `jump`: the fee would be held (live) or is reported (shadow). */
  hold: boolean;
  /** The prior the fee was compared with: the nearest by amount, a unit match first. */
  prior?: HistoryPrior;
  /** New amount against that prior (`amountRatio`); null when JSON cannot carry Infinity. */
  ratio?: number | null;
  /** Why the move needed support: the amount moved, or the charging unit changed. */
  kind?: "amount" | "unit";
  /** `judgeFeeChange`'s reason when it did not confirm the move. */
  changeHold?: FeeChangeHold;
}

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
 * The first, text-free half of the check: `no_prior`, `consistent`, or the prior a move must be
 * supported against. Callers use it to load only the prior texts the second half needs. Pure.
 */
export function historyCandidate(fee: HistoryFee, priors: readonly HistoryPrior[]):
  | { outcome: "no_prior" | "consistent" }
  | { outcome: "needs_support"; prior: HistoryPrior; ratio: number; kind: "amount" | "unit" } {
  if (fee.amount == null || !Number.isFinite(fee.amount)) return { outcome: "no_prior" };
  const amount = fee.amount;
  const comparable = comparablePriors(fee, priors);
  if (comparable.length === 0) return { outcome: "no_prior" };
  const withAmount = { ...fee, amount };
  if (comparable.some((prior) => consistentWith(withAmount, prior))) return { outcome: "consistent" };
  const nearest = [...comparable].sort((a, b) =>
    Number(unitsDiffer(fee.frequency, a.frequency)) - Number(unitsDiffer(fee.frequency, b.frequency))
    || amountRatio(amount, a.amount) - amountRatio(amount, b.amount)
    || b.feePublishedId - a.feePublishedId)[0];
  const ratio = amountRatio(amount, nearest.amount);
  return { outcome: "needs_support", prior: nearest, ratio, kind: ratio >= HISTORY_JUMP_RATIO ? "amount" : "unit" };
}

/**
 * The history verdict for one fee against its priors (`priorTexts`: stored text by document id,
 * for the prior the move is supported against). Pure.
 */
export function historyVerdict(fee: HistoryFee, priors: readonly HistoryPrior[], priorTexts: ReadonlyMap<number, string>): HistoryVerdict {
  const candidate = historyCandidate(fee, priors);
  if (candidate.outcome !== "needs_support") return { outcome: candidate.outcome, hold: false };
  const { prior, ratio, kind } = candidate;
  const base = { prior, ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, kind };
  // The current copy still prints the prior fee at its prior price: two lines of one schedule.
  if (fee.text && checkFeeAgainstSource(fee.text, prior.feeName, prior.amount, ".").ok) {
    return { ...base, outcome: "both_stated", hold: false };
  }
  const priorText = prior.sourceDocumentId == null ? null : priorTexts.get(Number(prior.sourceDocumentId)) ?? null;
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
  });
  if (judged.change) return { ...base, outcome: "change_confirmed", hold: false };
  return { ...base, outcome: "jump", hold: true, changeHold: judged.hold };
}

/** The attempt-log form of a verdict: small, ids and numbers only, never fee text. Pure. */
export function historyDetail(verdict: HistoryVerdict, live: boolean): Record<string, unknown> {
  return {
    outcome: verdict.outcome,
    would_hold: verdict.hold,
    held: verdict.hold && live,
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
}

/** The keys a fee is matched to its priors on. */
export interface HistoryKey {
  institutionId: number;
  canonicalFeeKey: string;
  feeAudience: string | null | undefined;
  productName: string | null | undefined;
}

/** The candidate rows that are this fee's priors: same institution, category, audience and product. Pure. */
export function priorsFor(key: HistoryKey, candidates: readonly PriorCandidateRow[]): HistoryPrior[] {
  const audience = key.feeAudience ?? "unknown";
  const product = productKey(key.productName);
  return candidates.flatMap((row) => {
    if (Number(row.institution_id) !== key.institutionId || row.canonical_fee_key !== key.canonicalFeeKey) return [];
    if ((row.fee_audience ?? "unknown") !== audience || productKey(row.product_name) !== product) return [];
    if (isPercentFee(row) || row.amount == null || row.fee_name == null) return [];
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
 */
export async function loadLivePriors(db: SqlTag, institutionIds: readonly number[]): Promise<PriorCandidateRow[]> {
  const ids = [...new Set(institutionIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  return db<PriorCandidateRow[]>`
    SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount, fp.frequency,
           fp.fee_audience, fp.amount_kind, fp.source_url, sd.document_url, fr.source_document_id, fr.product_name,
           fp.published_at, fp.rolled_back_reason
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
           q.fee_published_id, q.institution_id, q.canonical_fee_key, q.fee_name, q.amount, q.frequency,
           q.fee_audience, q.amount_kind, q.source_url, sd.document_url, qr.source_document_id, qr.product_name,
           q.published_at, q.rolled_back_reason
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
 * `loadPriorsAtPublish` reads it, same audience and product, another document, the same fee name
 * by `sameFeeName`'s normalisation) and none of its priors agrees with it (`consistentWith`). The recheck's history cohort selects on it; the texts
 * then decide. Constants inlined; no user text.
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
            AND ${feeNameKeySql("q.fee_name")} = ${feeNameKeySql("p.fee_name")}`;
  return `(COALESCE(p.amount_kind, '') <> 'percent' AND p.amount IS NOT NULL
         AND EXISTS (SELECT 1 ${priorJoin})
         AND NOT EXISTS (SELECT 1 ${priorJoin}
            AND (q.amount = p.amount
                 OR (q.amount > 0 AND p.amount > 0 AND greatest(q.amount / p.amount, p.amount / q.amount) < ${HISTORY_JUMP_RATIO}
                     AND NOT (${unitSql("q.frequency")} IS NOT NULL AND ${unitSql("p.frequency")} IS NOT NULL AND ${unitSql("q.frequency")} <> ${unitSql("p.frequency")})))))`;
}
