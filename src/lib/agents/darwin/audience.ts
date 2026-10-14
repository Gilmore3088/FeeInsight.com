import { suggestAudience } from "@/lib/agents/knox/audience-context";
import type { FeeAudience } from "@/lib/fee-audience";

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
): DarwinAudience | null {
  if (row.fee_audience && row.fee_audience !== "unknown") return null;
  const suggestion = suggestAudience({ documentUrl: row.source_url, text: sourceText ?? null, feeName: row.fee_name, amount });
  if (!suggestion) return null;
  return {
    feeAudience: suggestion.audience,
    audienceEvidence: `${DARWIN_AUDIENCE_PREFIX}${suggestion.source}: ${suggestion.evidence}`.slice(0, MAX_EVIDENCE_CHARS),
  };
}
