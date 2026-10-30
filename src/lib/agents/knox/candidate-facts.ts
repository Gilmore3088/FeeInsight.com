import { feeApplicability } from "@/lib/fee-audience";
import { ACCOUNT_PRODUCT_CATEGORIES, LINEUP_CATEGORY } from "./lineup";
import type { ExtractedFeeCandidate } from "./rules";

/** The facts the raw writer actually persists; learning must not infer a different owner/audience. */
export function candidateWriteFacts(candidate: ExtractedFeeCandidate) {
  const owner = candidate.ancillaryProduct;
  const stated = feeApplicability(candidate.feeName, candidate.excerpt, candidate.amount);
  // #2062: a confirmed business-schedule takedown's lesson names the audience only where the line names none.
  const applicability = candidate.audienceLesson && stated.feeAudience === "unknown"
    ? { ...stated, feeAudience: candidate.audienceLesson.audience, audienceEvidence: candidate.audienceLesson.evidence }
    : stated;
  const read = ACCOUNT_PRODUCT_CATEGORIES.has(candidate.canonicalHint) ? (candidate.lineup ?? null)
    : owner ? { productName: owner.productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } : null;
  const lineup = read && candidate.canonicalHint !== LINEUP_CATEGORY
    ? { productName: read.productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } : read;
  const ownedPrice = candidate.ownedBullet || candidate.ownedPolicy || candidate.ownUnit || candidate.ownCondition;
  const ownText = candidate.ownedBullet || candidate.ownedPolicy
    ? candidate.excerpt : candidate.ownCondition ?? candidate.ownUnit?.sourceLine ?? candidate.excerpt;
  const sourceConditions = owner
    ? [owner.title, owner.applicability, ownedPrice ? ownText : owner.ownLine,
      candidate.linkedConditions].filter(Boolean).join("\n")
    : ownedPrice ? [ownText, candidate.linkedConditions].filter(Boolean).join(" ") : null;
  return { owner, applicability, lineup, sourceConditions };
}
