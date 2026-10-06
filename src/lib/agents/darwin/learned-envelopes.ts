import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

import { CATEGORY_AMOUNT_ENVELOPES, DEFAULT_AMOUNT_ENVELOPE, type AmountEnvelope } from "./envelopes";

type SqlTag = typeof sql;

/**
 * Learned upper bounds for the categories with no hand-set range, so they stop falling
 * through to the $0.01-$2,500 catch-all (the 2026-10-06 audit found 23% of approvals
 * there).
 *
 * The bound is three times the 95th percentile of what banks charge for the fee today
 * (one vote per bank: its median live amount), and only categories priced by at least
 * 30 banks get one. Only the top is learned. Per-page and per-item prices of a few cents
 * (photocopies at $0.25, ACH items at $0.12) are real and common, so the floor stays the
 * default's $0.01. A sample of the 24 hours before this change found the amounts above
 * the learned bound were mostly limits, thresholds and examples read as the fee
 * ("Maximum card load $500", "Bill Payment Limits $1,000", "Cash Advance limit $500").
 *
 * Lending categories are left out: loan, appraisal and mortgage fees legitimately run
 * from $5 to four figures and the sample's real prices there sat above any bound.
 *
 * Darwin alone uses these. Hamilton's publish gate and outlier rollback keep the
 * hand-set ranges, so a learned bound never takes a live fee down.
 */
export const LEARNED_ENVELOPE_MIN_INSTITUTIONS = 30;
export const LEARNED_ENVELOPE_FACTOR = 3;
export const LEARNED_ENVELOPE_PERCENTILE = 0.95;
export const LEARNED_ENVELOPE_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "other_lending_fee",
  "loan_origination",
  "mortgage_lien_release",
  "mortgage_modification",
  "appraisal_fee",
]);

/** Learned ranges are recomputed at most this often per server instance. */
const LEARNED_ENVELOPE_TTL_MS = 60 * 60 * 1000;

export interface LearnedEnvelope extends AmountEnvelope {
  /** The percentile the bound came from, and how many banks it covers. */
  p95: number;
  institutions: number;
}

export type EnvelopeSource = "hand" | "learned" | "default";

/** Pure: the envelope Darwin applies to a category, and where it came from. */
export function darwinEnvelopeFor(
  canonicalFeeKey: string,
  learned: ReadonlyMap<string, LearnedEnvelope>,
): AmountEnvelope & { source: EnvelopeSource } {
  const hand = CATEGORY_AMOUNT_ENVELOPES[canonicalFeeKey];
  if (hand) return { ...hand, source: "hand" };
  const fromData = learned.get(canonicalFeeKey);
  if (fromData) return { min: fromData.min, max: fromData.max, source: "learned" };
  return { ...DEFAULT_AMOUNT_ENVELOPE, source: "default" };
}

/** Pure: the learned envelope for one category's per-bank p95, or null when it does not qualify. */
export function learnedEnvelope(canonicalFeeKey: string, p95: number, institutions: number): LearnedEnvelope | null {
  if (CATEGORY_AMOUNT_ENVELOPES[canonicalFeeKey] || LEARNED_ENVELOPE_EXCLUDED_KEYS.has(canonicalFeeKey)) return null;
  if (!(institutions >= LEARNED_ENVELOPE_MIN_INSTITUTIONS) || !(p95 > 0)) return null;
  const max = Math.min(DEFAULT_AMOUNT_ENVELOPE.max, Math.round(p95 * LEARNED_ENVELOPE_FACTOR * 100) / 100);
  return { min: DEFAULT_AMOUNT_ENVELOPE.min, max, p95, institutions };
}

let cached: { at: number; envelopes: Map<string, LearnedEnvelope> } | null = null;

/** Test hook: forget the cached ranges. */
export function resetLearnedEnvelopeCache(): void {
  cached = null;
}

/**
 * Learned envelopes from the live catalog, cached for an hour. A failed read returns the
 * last good ranges, or none (every category then keeps its hand-set or default range).
 */
export async function loadLearnedEnvelopes(db: SqlTag, now = Date.now()): Promise<Map<string, LearnedEnvelope>> {
  if (cached && now - cached.at < LEARNED_ENVELOPE_TTL_MS) return cached.envelopes;
  try {
    const rows = await inSavepoint(db, (scope) => scope.unsafe<Array<{ canonical_fee_key: string; p95: string | number; institutions: string | number }>>(
      `
        WITH per_institution AS (
          SELECT canonical_fee_key, institution_id,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS amount
            FROM published_fee_catalog
           WHERE amount > 0
           GROUP BY 1, 2
        )
        SELECT canonical_fee_key,
               percentile_cont($1::float8) WITHIN GROUP (ORDER BY amount) AS p95,
               COUNT(*) AS institutions
          FROM per_institution
         GROUP BY 1
        HAVING COUNT(*) >= $2
      `,
      [LEARNED_ENVELOPE_PERCENTILE, LEARNED_ENVELOPE_MIN_INSTITUTIONS],
    ));
    const envelopes = new Map<string, LearnedEnvelope>();
    for (const row of rows ?? []) {
      const envelope = learnedEnvelope(String(row.canonical_fee_key), Number(row.p95), Number(row.institutions));
      if (envelope) envelopes.set(String(row.canonical_fee_key), envelope);
    }
    cached = { at: now, envelopes };
    return envelopes;
  } catch (error) {
    console.error("loadLearnedEnvelopes failed:", error instanceof Error ? error.message : error);
    return cached?.envelopes ?? new Map();
  }
}
