import type { VerifiedFeeRow } from "@/lib/agents/hamilton/publish";
import { isRetiredCategory } from "@/lib/fee-fold";
import { isExplicitZeroFee, withinAmountEnvelope, ZERO_FEE_VERIFIED_FLAG } from "@/lib/agents/darwin/envelopes";
import { limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { PERCENT_FEE_RANGES, isPercentFee, percentFeeAllowed, ratePercentOf } from "@/lib/percent-fees";
import { isArticlePage } from "@/lib/agents/hamilton/article-page";
import { isProductPage, productPageTakedownEnabled } from "@/lib/agents/hamilton/product-page";

// Eligibility and normalization only. Selection, transactions, write order,
// publication rollbacks and monitor signals remain in publish.ts.
const VALID_CANONICAL_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));
const BLOCKING_FLAGS = new Set([
  "ambiguous",
  "challenge",
  "challenged",
  "lineage_missing",
  "needs_human",
  "needs_manual_review",
  "outlier",
  "rejected",
]);

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseFlags(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export function normalizedConfidence(value: number | string | null): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

export function publishSkipReason(row: VerifiedFeeRow, minConfidence: number, productPageOn: boolean = productPageTakedownEnabled()): string | null {
  const flags = parseFlags(row.outlier_flags);
  if (!flags.includes("agentic_darwin_verified")) return "Not verified by the agentic Darwin path";
  const blockingFlag = flags.find((flag) => BLOCKING_FLAGS.has(flag));
  if (blockingFlag) return `Blocking flag: ${blockingFlag}`;
  if (!VALID_CANONICAL_KEYS.has(row.canonical_fee_key)) return "Invalid canonical fee key";
  // A fee whose wording found no home among the top 50 (fee-fold.ts) is not published.
  if (isRetiredCategory(row.canonical_fee_key)) return "Category folded into the top 50 with no home for this fee";
  if (!row.fee_name?.trim()) return "Missing fee name";
  if (!row.source_url?.trim() && !row.document_r2_key?.trim()) return "Missing source lineage";
  if (!row.verified_by_agent_event_id?.trim()) return "Missing Darwin verification event";
  // A blog post or story quotes national averages, not this bank's price (article-page.ts).
  if (isArticlePage(row.source_url)) return "Read from an article page, not a fee schedule";
  // A $0 benefit bullet on a product page, once James turns the check on (product-page.ts).
  if (row.free_read && normalizedAmount(row.amount) === 0 && isProductPage(row.document_url) && productPageOn) {
    return "Read from a product page's benefits, not a fee schedule";
  }
  const amount = normalizedAmount(row.amount);
  if (isPercentFee(row)) {
    // A rate publishes only in a category that publishes rates, inside its range.
    const rate = ratePercentOf(row);
    if (!percentFeeAllowed(row.canonical_fee_key)) return "Rate in a category that does not publish rates";
    if (rate == null || amount != null) return "Missing or invalid rate";
    const range = PERCENT_FEE_RANGES[row.canonical_fee_key];
    if (rate < range.min || rate > range.max) return "Rate outside the category's plausible range";
  } else if (amount == null || amount < 0) return "Missing or invalid amount";
  else if (amount === 0) {
    // $0 is a real price (a free fee) only when Darwin verified it as one.
    if (!isExplicitZeroFee(amount, flags, ZERO_FEE_VERIFIED_FLAG)) return "Missing or invalid amount";
  } else if (!withinAmountEnvelope(row.canonical_fee_key, amount)) {
    return "Amount outside the category's plausible range";
  }
  // A transfer or deposit limit read as a price; Knox's excerpt is checked by the sweep.
  const limit = isPercentFee(row) ? null : limitGuardVerdict(row);
  if (limit) return `Transaction limit, not a price: ${limit.detail}`;
  if (normalizedConfidence(row.extraction_confidence) < minConfidence) {
    return "Below publish confidence threshold";
  }
  return null;
}

