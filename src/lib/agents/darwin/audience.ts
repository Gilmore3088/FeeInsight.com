import { nameAudience, suggestAudience } from "@/lib/agents/knox/audience-context";
import type { FeeAudience } from "@/lib/fee-audience";
import { ownPriceAudience } from "./own-price-audience";

/**
 * Darwin's audience decision for a fee it verifies (#1059; James, Oct 13: Darwin's audience is the
 * one published, Knox only suggests). A label Knox read on the fee's own line stands. A fee Knox
 * left unknown takes the context suggestion (the schedule's address or title, the section heading
 * above its line, a schedule with no business fees, or a mixed schedule that does not limit it).
 * The evidence starts with DARWIN_AUDIENCE_PREFIX so the audience trigger keeps Darwin's decision
 * on the verified row instead of copying the raw row's (migration 20270110000047). Pure.
 */
export const DARWIN_AUDIENCE_PREFIX = "darwin:";
const MAX_EVIDENCE_CHARS = 500;

export interface DarwinAudience {
  feeAudience: Exclude<FeeAudience, "unknown">;
  audienceEvidence: string;
}

export function darwinAudience(
  row: { fee_audience?: FeeAudience | null; source_url: string | null; fee_name: string },
  amount: number | null,
  sourceText: string | null | undefined,
  options: { ownPriceClause?: true } = {},
): DarwinAudience | null {
  if (row.fee_audience && row.fee_audience !== "unknown") return null;
  // Prospective verification may opt in after source/price admission. Historical relabel v4
  // keeps its existing call/default semantics, including its cursor and title-only rejudges.
  // Existing name/product/exception semantics stand; a contradictory own exclusive clause
  // does not turn one definite audience into the other, or allow a broader default.
  if (options.ownPriceClause) {
    const fromName = nameAudience(row.fee_name);
    const own = ownPriceAudience(sourceText ?? "", row.fee_name, amount);
    if (own.kind === "ambiguous") return null;
    if (own.kind === "qualified" && fromName != null && fromName !== own.audience) return null;
    if (own.kind === "qualified" && fromName == null) return {
      feeAudience: own.audience,
      audienceEvidence: `${DARWIN_AUDIENCE_PREFIX}fee_exclusive_price_clause: ${own.evidence}`.slice(0, MAX_EVIDENCE_CHARS),
    };
  }
  const suggestion = suggestAudience({ documentUrl: row.source_url, text: sourceText ?? null, feeName: row.fee_name, amount });
  if (!suggestion) return null;
  return {
    feeAudience: suggestion.audience,
    audienceEvidence: `${DARWIN_AUDIENCE_PREFIX}${suggestion.source}: ${suggestion.evidence}`.slice(0, MAX_EVIDENCE_CHARS),
  };
}
