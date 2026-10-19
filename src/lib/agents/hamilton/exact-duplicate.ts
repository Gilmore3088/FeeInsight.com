import { productKey, productKeySql, sameProduct } from "@/lib/fee-product";
import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { splitLiveCategory } from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * #1069 step 1: the publish step checks each row it is about to publish against the exact
 * duplicate collapse (`collapsePublishedDuplicates`), the sweep that closes it hours later
 * (6,519 such takedowns in the 7 days to Oct 15). On (James's OK, 2026-10-17): the step refuses
 * those rows. Set it to false to only count what it would refuse.
 */
export const PUBLISH_REFUSE_DUPLICATES_LIVE = true;
export const PUBLISH_DUPLICATE_REFUSE_REASON_PREFIX = "Exact duplicate of live fee #";

/**
 * Frequencies that name the same thing count as one (the collapse's `FREQUENCY_CLASS`): per item,
 * per occurrence, per transaction and one-time all mean "each time it happens", and an unstated
 * (or "other") frequency matches any stated one.
 */
export function frequencyClass(frequency: string | null | undefined): string | null {
  if (frequency == null || frequency === "other") return null;
  return ["per_item", "per_occurrence", "per_transaction", "one_time"].includes(frequency) ? "each" : frequency;
}

/** A live copy of the line a row is about to publish: same institution, category, variant, value and name. */
export interface ExactCopyRow {
  product_name?: string | null;
  fee_published_id: number | string;
  frequency: string | null;
  fee_audience: string | null;
  published_at: string | Date | null;
  quarantined_at?: string | Date | null;
  /** Published earlier in this same publish step (or, in a dry run, would have been). */
  in_step?: boolean;
}

export type ExactDuplicateDecision =
  | { kind: "none" }
  /** The collapse would close the new row and keep this live one: publish would refuse it. */
  | { kind: "refuse"; keptFeePublishedId: number }
  /** Within the same applicability, the collapse would keep the newer/better-frequency row. */
  | { kind: "replace"; closedFeePublishedIds: number[] };

/** Unknown applicability is its own identity, never a wildcard or a reason to prefer another audience. */
function audienceKey(audience: string | null | undefined): string {
  return audience ?? "unknown";
}

/** Within one audience's line, a copy that states its frequency wins. Lower is better. */
function copyRank(entry: { frequency?: string | null }): number {
  return entry.frequency == null ? 1 : 0;
}

/**
 * Pure: what the exact duplicate collapse would do once this row is live beside its live copies.
 * The same test as the collapse: copies whose stated frequency classes disagree are separate fee
 * lines and nothing closes. Different audiences (including both and unknown) never close one
 * another. Within one audience, keep the stated frequency, then the newest copy. Against an
 * earlier step's copy the new row is newest, so it loses only to a better stated frequency.
 *
 * A copy published earlier in this same step (`in_step`) is kept whenever it ranks as well as the
 * row: the step orders each line's rows so the copy the collapse would keep goes first
 * (`collapseKeepOrder`), and a later twin would otherwise go live only for the collapse to close
 * one of the two (13 rows of step 42289 on Oct 17).
 */
export function exactDuplicateDecision(
  row: { frequency?: string | null; fee_audience?: string | null; product_name?: string | null },
  copies: ExactCopyRow[],
): ExactDuplicateDecision {
  const matching = copies.filter((copy) => copy.quarantined_at == null && audienceKey(copy.fee_audience) === audienceKey(row.fee_audience)
    && sameProduct(copy.product_name, row.product_name));
  if (matching.length === 0) return { kind: "none" };
  const classes = new Set(
    [row.frequency, ...matching.map((copy) => copy.frequency)].map(frequencyClass).filter((value): value is string => value != null),
  );
  if (classes.size > 1) return { kind: "none" };
  const ordered = [...matching].sort(
    (a, b) =>
      copyRank(a) - copyRank(b) ||
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime() ||
      Number(b.fee_published_id) - Number(a.fee_published_id),
  );
  const best = ordered[0];
  if (copyRank(best) < copyRank(row)) return { kind: "refuse", keptFeePublishedId: Number(best.fee_published_id) };
  const stepCopy = ordered.find((copy) => copy.in_step && copyRank(copy) <= copyRank(row));
  if (stepCopy) return { kind: "refuse", keptFeePublishedId: Number(stepCopy.fee_published_id) };
  return { kind: "replace", closedFeePublishedIds: matching.map((copy) => Number(copy.fee_published_id)) };
}

/**
 * The categories a row's live copies can sit under when the collapse runs: its own, and the one
 * the live split (`splitLiveCategory`, run by the taxonomy fold in the same publish step) moves it
 * to. 152013 published as account research on Oct 17 08:43, was re-filed to excess withdrawal
 * beside live 86530 under the same name and price, and was closed as its duplicate at 08:50. Pure.
 */
export function collapseCategories(canonicalFeeKey: string, feeName: string | null | undefined): string[] {
  const to = splitLiveCategory(canonicalFeeKey, feeName)?.to;
  return to && to !== canonicalFeeKey ? [canonicalFeeKey, to] : [canonicalFeeKey];
}

export interface CollapseLine {
  productName?: string | null;
  institutionId: number;
  canonicalFeeKey: string;
  variantType: string | null | undefined;
  amount: number | null;
  ratePercent: number | null;
  amountKind: "flat" | "percent";
  rateMinAmount: number | null;
  rateMaxAmount: number | null;
  rateBasis: string | null | undefined;
  feeAudience: string | null | undefined;
  feeName: string;
}

/** The collapse partition: institution, split category, audience, variant, value/basis/bounds and name. Pure. */
export function collapseLineKey(line: CollapseLine): string {
  const category = collapseCategories(line.canonicalFeeKey, line.feeName).at(-1);
  return [line.institutionId, category, line.variantType ?? "", line.amountKind, line.amount ?? "",
    line.ratePercent ?? "", line.rateMinAmount ?? "", line.rateMaxAmount ?? "", line.rateBasis ?? "",
    audienceKey(line.feeAudience), productKey(line.productName), line.feeName.trim().toLowerCase()].join("|");
}

/**
 * Pure: the order a publish step takes its rows in, so that of the rows on one collapse line the
 * copy the collapse would keep is decided first. A line's rows keep the positions the line held,
 * best first: stated frequency, then the row the step would have reached
 * last (it would be inserted last, and the collapse keeps the highest id of equal copies). Rows on
 * no shared line keep their place.
 */
export function collapseKeepOrder<T extends { frequency?: string | null; fee_audience?: string | null }>(
  rows: T[],
  lineKey: (row: T) => string,
): T[] {
  const positions = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = lineKey(row);
    positions.set(key, [...(positions.get(key) ?? []), index]);
  });
  const ordered = [...rows];
  for (const indexes of positions.values()) {
    if (indexes.length < 2) continue;
    const best = [...indexes].sort((a, b) => copyRank(rows[a]) - copyRank(rows[b]) || b - a);
    indexes.forEach((slot, i) => {
      ordered[slot] = rows[best[i]];
    });
  }
  return ordered;
}

/**
 * The live copies of the line a row would publish, keyed as the collapse partitions: institution,
 * category (its own, or the one the live split moves it to: `collapseCategories`), variant,
 * amount kind/rate/basis/bounds, audience and published name (case and outer spaces ignored).
 * Frequency classes are weighed by the decision above; a held copy is never a witness.
 */
export async function selectExactCopies(
  db: SqlTag,
  line: CollapseLine,
): Promise<ExactCopyRow[]> {
  try {
    return await inSavepoint(db, (scope) => scope<ExactCopyRow[]>`
      SELECT fp.fee_published_id, fp.frequency, fp.fee_audience, fp.published_at, fp.quarantined_at, fr.product_name
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.institution_id = ${line.institutionId}
         AND fp.canonical_fee_key = ANY(${collapseCategories(line.canonicalFeeKey, line.feeName)}::text[])
         AND COALESCE(fp.variant_type, '') = COALESCE(${line.variantType ?? null}, '')
         AND COALESCE(fp.fee_audience, 'unknown') = ${audienceKey(line.feeAudience)}
         AND COALESCE(fp.amount_kind, 'flat') = ${line.amountKind}
         AND fp.amount IS NOT DISTINCT FROM ${line.amount}::numeric
         AND fp.rate_percent IS NOT DISTINCT FROM ${line.ratePercent}::numeric
         AND fp.rate_min_amount IS NOT DISTINCT FROM ${line.rateMinAmount}::numeric
         AND fp.rate_max_amount IS NOT DISTINCT FROM ${line.rateMaxAmount}::numeric
         AND COALESCE(fp.rate_basis, '') = COALESCE(${line.rateBasis ?? null}, '')
         AND lower(btrim(fp.fee_name)) = lower(btrim(${line.feeName}))
         AND fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND ${scope.unsafe(productKeySql("fr.product_name"))} = ${productKey(line.productName)}
    `);
  } catch (error) {
    // A failed shadow check never blocks a publish.
    console.error("selectExactCopies failed:", error);
    return [];
  }
}

export interface PublishDuplicateCheck {
  /** True when the step refuses the rows the collapse would close. */
  live: boolean;
  /** Rows about to publish whose line already had a live copy. */
  withLiveCopy: number;
  /** Rows the collapse would close behind a live copy (refused when live). */
  wouldRefuse: number;
  refused: number;
  /** Rows the collapse would keep, closing the older live copies instead. */
  wouldReplace: number;
  samples: Array<{ fee_verified_id: number; fee_published_id: number | null; kept_fee_published_id: number; fee_name: string; amount: number | null }>;
}
