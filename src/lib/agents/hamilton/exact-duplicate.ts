import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * #1069 step 1: the publish step checks each row it is about to publish against the exact
 * duplicate collapse (`collapsePublishedDuplicates`), the sweep that closes it hours later
 * (6,519 such takedowns in the 7 days to Oct 15). While this is false the step only counts what
 * it would refuse; turning it on (refusing those rows) needs James's OK.
 */
export const PUBLISH_REFUSE_DUPLICATES_LIVE = false;
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
  fee_published_id: number | string;
  frequency: string | null;
  fee_audience: string | null;
  published_at: string | Date | null;
}

export type ExactDuplicateDecision =
  | { kind: "none" }
  /** The collapse would close the new row and keep this live one: publish would refuse it. */
  | { kind: "refuse"; keptFeePublishedId: number }
  /** The collapse would keep the new row (it states its audience or frequency) and close these. */
  | { kind: "replace"; closedFeePublishedIds: number[] };

/**
 * Pure: what the exact duplicate collapse would do once this row is live beside its live copies.
 * The same test as the collapse: copies whose stated frequency classes disagree are separate fee
 * lines and nothing closes. Otherwise one copy is kept: the one that states its audience, then its
 * frequency, then the newest. The new row is the newest, so it loses only to a copy that states
 * an audience or a frequency it does not.
 */
export function exactDuplicateDecision(
  row: { frequency?: string | null; fee_audience?: string | null },
  copies: ExactCopyRow[],
): ExactDuplicateDecision {
  if (copies.length === 0) return { kind: "none" };
  const classes = new Set(
    [row.frequency, ...copies.map((copy) => copy.frequency)].map(frequencyClass).filter((value): value is string => value != null),
  );
  if (classes.size > 1) return { kind: "none" };
  const rank = (entry: { frequency?: string | null; fee_audience?: string | null }) =>
    ((entry.fee_audience ?? "unknown") === "unknown" ? 2 : 0) + (entry.frequency == null ? 1 : 0);
  const ordered = [...copies].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime() ||
      Number(b.fee_published_id) - Number(a.fee_published_id),
  );
  const best = ordered[0];
  if (rank(best) < rank(row)) return { kind: "refuse", keptFeePublishedId: Number(best.fee_published_id) };
  return { kind: "replace", closedFeePublishedIds: copies.map((copy) => Number(copy.fee_published_id)) };
}

/**
 * The live copies of the line a row would publish, keyed as the collapse partitions: institution,
 * category, variant, amount, rate and the published name (case and outer spaces ignored). Any
 * audience and frequency; the decision above weighs those.
 */
export async function selectExactCopies(
  db: SqlTag,
  line: {
    institutionId: number;
    canonicalFeeKey: string;
    variantType: string | null | undefined;
    amount: number | null;
    ratePercent: number | null;
    feeName: string;
  },
): Promise<ExactCopyRow[]> {
  try {
    return await inSavepoint(db, (scope) => scope<ExactCopyRow[]>`
      SELECT fp.fee_published_id, fp.frequency, fp.fee_audience, fp.published_at
        FROM published_fee_records fp
       WHERE fp.institution_id = ${line.institutionId}
         AND fp.canonical_fee_key = ${line.canonicalFeeKey}
         AND COALESCE(fp.variant_type, '') = COALESCE(${line.variantType ?? null}, '')
         AND fp.amount IS NOT DISTINCT FROM ${line.amount}::numeric
         AND fp.rate_percent IS NOT DISTINCT FROM ${line.ratePercent}::numeric
         AND lower(btrim(fp.fee_name)) = lower(btrim(${line.feeName}))
         AND fp.rolled_back_at IS NULL
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
