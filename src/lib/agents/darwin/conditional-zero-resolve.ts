import type { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { isProductPageUrl } from "@/lib/agents/learning/fee-page";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { DARWIN_VERIFY_STRATEGY, insertVerifiedFee, rawFeeFingerprint, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * The way out for Darwin's `conditional_zero` holds (#1115 step 2b; James approved rules a, b and
 * c on #1026, 2026-10-13). A $0 row held because its line also prices something is one of three
 * things, and each gets its own exit:
 * - (a) The same document already has a priced verified fee in the category ("Monthly Service Fee |
 *   $0 | $5 | $10" beside the verified $5): the $0 row is a duplicate of it.
 * - (c) The bank's own schedule (not a checking or savings product page, `isProductPageUrl`) prices
 *   the fee itself as free on its own line, with no other dollar figure on it ("Bill Pay: | Free",
 *   "Wire Transfers: Incoming | No Charge"): it is verified at $0 (flag
 *   CONDITIONAL_ZERO_RELEASED_FLAG). James: a $0 or free fee only when the bank's own schedule
 *   states it. Not for categories whose $0 is one account's feature (overdraft, NSF, monthly
 *   maintenance, minimum balance), nor a name the category guard refuses.
 * - (b) Anything else is rejected, logged with its reason, and read again by Knox when its rules
 *   change (a newer read takes over the row, #1147): a $0 a product page states, or a line the
 *   rules misread ("Gift Cards | $ 0.00 | value only", "Online copies are FREE").
 * Each verdict is a `verify.rules` attempt, so the row leaves the held pile and is judged once.
 */
export const CONDITIONAL_ZERO_RESOLVE_LIMIT = 200;
export const CONDITIONAL_ZERO_RELEASED_FLAG = "darwin_conditional_zero_released";
/** Categories whose $0 is one account's feature, never the bank's price for the fee. */
const ACCOUNT_FEATURE_KEYS: ReadonlySet<string> = new Set(["overdraft", "nsf", "monthly_maintenance", "minimum_balance"]);
/** The fee's own price is a free word at the end of its line ("| FREE", ": No Charge", "…… N/C"). */
const FREE_PRICE = /(?:^|[\s|:/.…•–-])(?:free|no charge|none|n\/c)\s*[*†‡]?\s*$/i;
/** A sentence about the fee ("Online copies are FREE", "Bill Pay Service is FREE"), not its price cell. */
const FREE_IN_A_SENTENCE = /\b(?:is|are|be|been|always|never)\s+(?:free|no charge|none)\s*[*]?\s*$/i;
const ANY_DOLLAR = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;

export type ConditionalZeroVerdict =
  | { decision: "duplicate"; reason: "conditional_zero_priced_twin" }
  | { decision: "verified"; reason: "conditional_zero_free_on_schedule" }
  | { decision: "rejected"; reason: "conditional_zero_product_page" | "conditional_zero_reread" };

export interface HeldZeroRow extends RawFeeRow {
  canonical_fee_key: string;
  document_url: string | null;
  priced_twin: boolean;
}

/** True when the line prices the fee itself as free and prints no other dollar figure. Pure. */
export function freeOnItsOwnLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const text = line.trim();
  if ([...text.matchAll(ANY_DOLLAR)].some((match) => Number(match[1].replace(/,/g, "")) > 0)) return false;
  return FREE_PRICE.test(text) && !FREE_IN_A_SENTENCE.test(text);
}

/** Rules a, c and b in that order. Pure. */
export function conditionalZeroVerdict(row: Pick<HeldZeroRow, "canonical_fee_key" | "fee_name" | "conditions" | "document_url" | "priced_twin">): ConditionalZeroVerdict {
  if (row.priced_twin) return { decision: "duplicate", reason: "conditional_zero_priced_twin" };
  if (isProductPageUrl(row.document_url)) return { decision: "rejected", reason: "conditional_zero_product_page" };
  const free = freeOnItsOwnLine(excerptOf(row.conditions))
    && !ACCOUNT_FEATURE_KEYS.has(row.canonical_fee_key)
    && checkFeeCategory(row.canonical_fee_key, row.fee_name).ok;
  return free
    ? { decision: "verified", reason: "conditional_zero_free_on_schedule" }
    : { decision: "rejected", reason: "conditional_zero_reread" };
}

export interface ConditionalZeroResolveResult {
  selected: number;
  verdicts: Record<string, number>;
  verified: number;
  dryRun: boolean;
}

export async function runDarwinConditionalZeroResolve(options: {
  runId: number;
  stepId?: number | null;
  db: SqlTag;
  dryRun?: boolean;
  institutionId?: number;
  limit?: number;
}): Promise<ConditionalZeroResolveResult> {
  const dryRun = Boolean(options.dryRun);
  const result: ConditionalZeroResolveResult = { selected: 0, verdicts: {}, verified: 0, dryRun };
  const limit = Math.max(1, Math.min(options.limit ?? CONDITIONAL_ZERO_RESOLVE_LIMIT, 1_000));
  if (!(await learningSchemaReady(options.db).catch(() => false))) return result;
  let rows: HeldZeroRow[];
  try {
    rows = await options.db.unsafe<HeldZeroRow[]>(
      `SELECT fr.fee_raw_id, fr.institution_id, fr.source_url, fr.document_r2_key, fr.extraction_confidence,
              fr.fee_name, fr.amount, fr.frequency, fr.outlier_flags, fr.conditions, fr.fee_audience,
              fr.amount_kind, fr.rate_percent, fr.rate_min_amount, fr.rate_max_amount, fr.rate_basis,
              fr.source_document_id, sd.document_url, last.canonical_fee_key,
              EXISTS (
                SELECT 1 FROM verified_fee_observations twin
                  JOIN raw_fee_observations twin_raw ON twin_raw.fee_raw_id = twin.fee_raw_id
                 WHERE twin_raw.source_document_id = fr.source_document_id
                   AND twin.canonical_fee_key = last.canonical_fee_key
                   AND twin.amount > 0
                   AND twin.review_status IN ('verified', 'approved')
              ) AS priced_twin
         FROM raw_fee_observations fr
         LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
         JOIN LATERAL (
           SELECT pa.detail->>'decision' AS decision, pa.detail->>'reason_code' AS reason_code,
                  pa.detail->>'canonical_fee_key' AS canonical_fee_key
             FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
              AND pa.strategy = $1
              AND pa.strategy_version = $2
            ORDER BY pa.created_at DESC
            LIMIT 1
         ) last ON true
        WHERE fr.source = 'knox'
          AND fr.outlier_flags ? 'needs_darwin_verification'
          AND fr.amount = 0
          AND last.decision = 'needs_review'
          AND last.reason_code = 'conditional_zero'
          AND last.canonical_fee_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
          ${options.institutionId ? "AND fr.institution_id = $4" : ""}
        ORDER BY fr.fee_raw_id
        LIMIT $3`,
      [DARWIN_VERIFY_STRATEGY.strategy, DARWIN_VERIFY_STRATEGY.version, limit, ...(options.institutionId ? [options.institutionId] : [])],
    );
  } catch (error) {
    console.error("runDarwinConditionalZeroResolve read failed:", error);
    return result;
  }
  result.selected = rows.length;
  for (const row of rows) {
    const verdict = conditionalZeroVerdict(row);
    result.verdicts[verdict.reason] = (result.verdicts[verdict.reason] ?? 0) + 1;
    if (dryRun) continue;
    let feeVerifiedId: number | null = null;
    if (verdict.decision === "verified") {
      feeVerifiedId = await insertVerifiedFee(options.db, {
        runId: options.runId,
        row,
        canonicalFeeKey: row.canonical_fee_key,
        extraFlags: [CONDITIONAL_ZERO_RELEASED_FLAG],
      });
      if (feeVerifiedId != null) result.verified += 1;
    }
    await recordAttempt(options.db, {
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      stage: "verify",
      strategy: DARWIN_VERIFY_STRATEGY.strategy,
      version: DARWIN_VERIFY_STRATEGY.version,
      fingerprint: rawFeeFingerprint(row.fee_raw_id),
      outcome: verdict.decision === "verified" ? "ok" : verdict.decision === "duplicate" ? "unchanged" : "rejected",
      yieldCount: feeVerifiedId != null ? 1 : 0,
      costMicrousd: 0,
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
      detail: {
        fee_raw_id: Number(row.fee_raw_id),
        fee_verified_id: feeVerifiedId,
        canonical_fee_key: row.canonical_fee_key,
        amount: 0,
        decision: verdict.decision === "verified" && feeVerifiedId == null ? "duplicate" : verdict.decision,
        reason_code: verdict.reason,
        reason: `#1115: ${verdict.reason}`,
        source_line: excerptOf(row.conditions)?.slice(0, 300),
      },
    });
  }
  return result;
}
