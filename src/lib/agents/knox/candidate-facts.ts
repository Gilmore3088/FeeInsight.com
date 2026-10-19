import { feeApplicability } from "@/lib/fee-audience";
import { ACCOUNT_PRODUCT_CATEGORIES, LINEUP_CATEGORY } from "./lineup";
import type { ExtractedFeeCandidate } from "./rules";

/** The facts the raw writer actually persists; learning must not infer a different owner/audience. */
export function candidateWriteFacts(candidate: ExtractedFeeCandidate) {
  const owner = candidate.ancillaryProduct;
  const applicability = feeApplicability(candidate.feeName, candidate.excerpt, candidate.amount);
  const read = ACCOUNT_PRODUCT_CATEGORIES.has(candidate.canonicalHint) ? (candidate.lineup ?? null)
    : owner ? { productName: owner.productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } : null;
  const lineup = read && candidate.canonicalHint !== LINEUP_CATEGORY
    ? { productName: read.productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null } : read;
  const ownedPrice = candidate.ownedBullet || candidate.ownedPolicy || candidate.ownUnit;
  const ownText = candidate.ownedBullet || candidate.ownedPolicy
    ? candidate.excerpt : candidate.ownUnit?.sourceLine ?? candidate.excerpt;
  const sourceConditions = owner
    ? [owner.title, owner.applicability, ownedPrice ? ownText : owner.ownLine,
      candidate.linkedConditions].filter(Boolean).join("\n")
    : ownedPrice ? [ownText, candidate.linkedConditions].filter(Boolean).join(" ") : null;
  return { owner, applicability, lineup, sourceConditions };
}
