import type { sql } from "@/lib/data-store/connection";
import { productKeySql } from "@/lib/fee-product";
import { inSavepoint } from "@/lib/agents/savepoint";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { readPublicationEvidence, type PublicationEvidence } from "./publication-evidence";

type SqlTag = typeof sql;

/**
 * One printed line read twice (#1876). Access FCU (7235) showed two live $30 overdraft fees from
 * one line of doc 28555, "- $30.00 charge for each one-time debit overdraft.": 132908 "charge for
 * each one-time debit overdraft" (Knox's deterministic read, no frequency) and 137315 "One-time
 * debit overdraft charge" (Knox's paid read of the same artifact, per item). Knox keeps every read
 * as its own raw observation by design; the identity checks after it let the second one through:
 * - Darwin's in-batch key (`batchKey`) and Hamilton's live-line read (`selectLivePublishedFees`)
 *   both compare the frequency exactly, so "per_item" never met the read with none;
 * - the exact duplicate collapse needs the same name, and the near-name collapse a one-word
 *   difference; the two names differ by word order and "for each".
 * On Oct 26 (prod, read-only) 87 groups of live fees, 174 rows at 44 institutions, shared an
 * institution, document, category, variant, amount, audience, product and stored source line.
 * 29 pair a deterministic and a paid read; most of the rest are Knox v99's box names ("Safe
 * Deposit Box 3x5") live beside the older read of the same row ("3x5", annual).
 *
 * Two fees are one printed line read twice only when all of these hold:
 * - same institution, document, category, variant, dollar amount, audience and product;
 * - the same stored source line (`excerpt=` in Knox's note, spacing and case folded), printed
 *   exactly once in the document's current completed text (`line_prints = 1`): a line a
 *   schedule repeats for several accounts may be several fees;
 * - that line prints the amount once (`pricePrints`): "$2 | $2 | $2 | $2" is four accounts'
 *   columns, and a window of two lines at one price may be two fees;
 * - their frequencies do not differ (an unknown frequency never differs, `frequencyClass`);
 * - one name's words are all in the other's (`namesShareReading` in publish.ts, passed in as
 *   `sharesReading`): "ACH Overdraft Fee" and "Courtesy Pay Fee" in one window stay two fees.
 *
 * Hamilton's publish step refuses a row that is such a read of a live fee (`selectSameLineReadOf`,
 * `PUBLISH_REFUSE_SAME_LINE_READS_LIVE`). This takes no live fee down; Darwin's live re-check
 * (`darwin/same-line-read-check.ts`) reads the ones already live.
 */
export const PUBLISH_REFUSE_SAME_LINE_READS_LIVE = true;
export const PUBLISH_SAME_LINE_READ_REFUSE_REASON_PREFIX = "Same printed line as live fee #";

/** SQL: the stored source line of raw alias `alias`, spacing and case folded; '' when none. */
export function sameLineExcerptSql(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid internal alias");
  return `lower(btrim(regexp_replace(COALESCE(substring(COALESCE(${alias}.extraction_note, ${alias}.conditions) from 'excerpt="?(.*?)"?$'), ''), '\\s+', ' ', 'g')))`;
}

/**
 * SQL (scalar): how many times the folded line `excerpt` is printed in the current completed text
 * of document `documentId`; NULL when the document has no text.
 */
export function linePrintsSql(documentId: string, excerpt: string): string {
  return `(SELECT (length(slr_text.folded) - length(replace(slr_text.folded, ${excerpt}, ''))) / GREATEST(length(${excerpt}), 1)
     FROM (SELECT lower(regexp_replace(slr_ast.normalized_text, '\\s+', ' ', 'g')) AS folded
             FROM agent_source_texts slr_ast
            WHERE slr_ast.source_document_id = ${documentId}
              AND slr_ast.status = 'completed'
              AND slr_ast.normalized_text IS NOT NULL
            ORDER BY slr_ast.id DESC
            LIMIT 1) slr_text)`;
}

const DOLLAR = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const BARE_CENTS = /(?<![\d.,$])(\d[\d,]*\.\d{2})(?!\d)/g;
const FREE = /\b(?:free|no charge|n\/c)\b/gi;

function cents(text: string): number {
  return Math.round(Number(text.replace(/,/g, "")) * 100);
}

/**
 * Pure: how many times a line prints this amount. Dollar-marked prices count when the line has
 * any; otherwise prices with cents ("30.00" after dot leaders). A $0 fee also counts "free",
 * "no charge" and "n/c".
 */
export function pricePrints(line: string, amount: number | string | null): number {
  const value = amount == null || amount === "" ? NaN : Number(amount);
  if (!Number.isFinite(value)) return 0;
  const target = Math.round(value * 100);
  const free = target === 0 ? (line.match(FREE)?.length ?? 0) : 0;
  const dollars = [...line.matchAll(DOLLAR)].map((match) => cents(match[1]));
  if (dollars.length > 0) return dollars.filter((price) => price === target).length + free;
  const bare = [...line.matchAll(BARE_CENTS)].map((match) => cents(match[1]));
  return bare.filter((price) => price === target).length + free;
}

export interface SameLineReadFee {
  fee_name: string | null;
  frequency: string | null;
}

/**
 * Pure: is `fee` the same printed line as `kept`, given the line they share? Both must already
 * share the institution, document, category, variant, amount, audience, product and line (the
 * readers' SQL). `sharesReading` is `namesShareReading(fee, kept)`.
 */
export function readsSameLine(
  fee: SameLineReadFee,
  kept: SameLineReadFee,
  line: { excerpt: string | null; linePrints: number | string | null; amount: number | string | null },
  sharesReading: boolean,
): boolean {
  const excerpt = (line.excerpt ?? "").trim();
  if (!excerpt || Number(line.linePrints) !== 1) return false;
  if (pricePrints(excerpt, line.amount) !== 1) return false;
  const [one, two] = [frequencyClass(fee.frequency), frequencyClass(kept.frequency)];
  if (one != null && two != null && one !== two) return false;
  return sharesReading;
}

export interface SameLineReadCandidate {
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  variantType: string | null | undefined;
  amount: number;
  feeAudience: string | null | undefined;
  feeName: string | null;
  frequency: string | null | undefined;
}

interface LiveLineRow {
  fee_published_id: number | string;
  fee_name: string | null;
  frequency: string | null;
  excerpt: string | null;
  line_prints: number | string | null;
}

/**
 * The live fee this row about to publish would repeat as a second read of its printed line, or
 * null. One read, by the row's raw id: the live rows of its institution, document, category,
 * variant, amount, audience and product whose stored line is the row's own, with how many times
 * the current text prints that line. An unavailable read stays unavailable, so an enabled publish
 * gate leaves the row pending.
 */
export async function selectSameLineReadOf(
  db: SqlTag,
  row: SameLineReadCandidate,
  sharesReading: (one: string | null, two: string | null) => boolean,
): Promise<PublicationEvidence<number | null>> {
  const read = await readPublicationEvidence("same_line_read", () => inSavepoint(db, (scope) => scope.unsafe<LiveLineRow[]>(
    `WITH slr_candidate AS (
       SELECT cand.institution_id, cand.source_document_id,
              ${productKeySql("cand.product_name")} AS product_key,
              ${sameLineExcerptSql("cand")} AS excerpt
         FROM raw_fee_observations cand
        WHERE cand.fee_raw_id = $1::bigint
          AND cand.source_document_id IS NOT NULL
     )
     SELECT fp.fee_published_id, fp.fee_name, fp.frequency, c.excerpt,
            ${linePrintsSql("c.source_document_id", "c.excerpt")} AS line_prints
       FROM slr_candidate c
       JOIN published_fee_records fp
         ON fp.institution_id = c.institution_id
        AND fp.canonical_fee_key = $2
        AND COALESCE(fp.variant_type, '') = COALESCE($3::text, '')
        AND fp.amount = $4::numeric
        AND fp.rate_percent IS NULL
        AND COALESCE(fp.fee_audience, 'unknown') = $5
        AND fp.rolled_back_at IS NULL
        AND fp.quarantined_at IS NULL
       JOIN verified_fee_observations slr_fv ON slr_fv.fee_verified_id = fp.lineage_ref
       JOIN raw_fee_observations live_raw ON live_raw.fee_raw_id = slr_fv.fee_raw_id
      WHERE c.excerpt <> ''
        AND live_raw.fee_raw_id <> $1::bigint
        AND live_raw.source_document_id = c.source_document_id
        AND ${productKeySql("live_raw.product_name")} = c.product_key
        AND ${sameLineExcerptSql("live_raw")} = c.excerpt
      ORDER BY fp.fee_published_id`,
    [row.feeRawId, row.canonicalFeeKey, row.variantType ?? null, row.amount, row.feeAudience ?? "unknown"],
  )));
  if (read.state === "unavailable") return read;
  const fee = { fee_name: row.feeName, frequency: row.frequency ?? null };
  const kept = read.value.find((live) => readsSameLine(
    fee, live, { excerpt: live.excerpt, linePrints: live.line_prints, amount: row.amount }, sharesReading(row.feeName, live.fee_name),
  ));
  return { state: "available", value: kept ? Number(kept.fee_published_id) : null };
}
