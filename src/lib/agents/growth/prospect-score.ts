import type { ContactRole } from "./contacts";
import { SNAPSHOT_MIN_PEERS, type MarketSnapshot, type SnapshotFee } from "./market-snapshot";

/**
 * The pilot's prospect qualification (outreach plan, James's audit 22:34 UTC Oct 8): a confidence tier
 * for every comparison, and a 0-100 score that ranks who gets a first email. The weights are the
 * plan's starting assumptions, to be refit on pilot outcomes. The score never decides what an
 * email claims; the tiers do.
 */

/**
 * A: the prospect's value and at least SNAPSHOT_MIN_PEERS local values all verify (a figure may be quoted).
 * B: the prospect's value verifies, with 1 to SNAPSHOT_MIN_PEERS - 1 verified local values (general wording only).
 * C: a value exists but the prospect's or every peer's fails the source check (no numbers anywhere).
 * D: a row behind the comparison is waiting on a takedown second look (held until reviewed).
 */
export type ComparisonTier = "A" | "B" | "C" | "D";

export function comparisonTier(fee: SnapshotFee, pendingTakedown: ReadonlySet<number> = new Set()): ComparisonTier | null {
  const own = fee.subject;
  if (!own) return null;
  const verifiedPeers = fee.peers.filter((peer) => peer.verified);
  const ids = [own, ...verifiedPeers].flatMap((value) => value.publishedIds);
  if (ids.some((id) => pendingTakedown.has(id))) return "D";
  if (!own.verified || verifiedPeers.length === 0) return "C";
  return verifiedPeers.length >= SNAPSHOT_MIN_PEERS && fee.verifiedMedian !== null ? "A" : "B";
}

/** Every fee type the prospect publishes, with its tier. */
export function comparisonTiers(snapshot: MarketSnapshot, pendingTakedown: ReadonlySet<number> = new Set()): Record<string, ComparisonTier> {
  const tiers: Record<string, ComparisonTier> = {};
  for (const fee of snapshot.fees) {
    const tier = comparisonTier(fee, pendingTakedown);
    if (tier) tiers[fee.category] = tier;
  }
  return tiers;
}

/** The plan's weights (sum 100). */
export const SCORE_WEIGHTS = { fit: 25, buyer: 20, research: 20, confidence: 20, commercial: 15 } as const;

const FINANCE_TITLE = /\b(?:cfo|chief financial|finance|treasurer|controller)\b/i;
const PRODUCT_TITLE = /\b(?:retail|deposits?|product|marketing|brand|member experience)\b/i;
const CHIEF_TITLE = /\b(?:ceo|chief executive|president)\b/i;

/** How close the title is to someone who owns fee research or pricing review. */
export function buyerRelevance(contact: { title: string | null; role: ContactRole }, assetsK: number | null): number {
  const title = contact.title ?? "";
  if (FINANCE_TITLE.test(title) || PRODUCT_TITLE.test(title)) return 1;
  // At a smaller institution the CEO often does the pricing review personally.
  if (CHIEF_TITLE.test(title)) return assetsK !== null && assetsK < 500_000 ? 1 : 0.8;
  if (contact.role === "operations" || contact.role === "executive") return 0.6;
  if (contact.role === "compliance") return 0.5;
  return 0.3;
}

export interface ProspectScore {
  total: number;
  parts: { fit: number; buyer: number; research: number; confidence: number; commercial: number };
  tiers: Record<string, ComparisonTier>;
}

/**
 * The score for one prospect. Fit: $500M-$2B full, $100M-$500M 80%, halved when fewer than
 * SNAPSHOT_MIN_PEERS local institutions publish a schedule. Research: tier-A comparisons, 5 for full
 * marks. Confidence: the share of the prospect's own fee values that pass the source check.
 * Commercial: the plan's price tiers ($300/mo at $500M-$2B, $150/mo below).
 */
export function scoreProspect(
  snapshot: MarketSnapshot,
  contact: { title: string | null; role: ContactRole },
  assetsK: number | null,
  pendingTakedown: ReadonlySet<number> = new Set(),
): ProspectScore {
  const tiers = comparisonTiers(snapshot, pendingTakedown);
  const sized = assetsK !== null && assetsK >= 500_000 ? 1 : 0.8;
  const fit = sized * (snapshot.peers.length >= SNAPSHOT_MIN_PEERS ? 1 : 0.5);
  const tierA = Object.values(tiers).filter((tier) => tier === "A").length;
  const own = snapshot.fees.filter((fee) => fee.subject);
  const confidence = own.length ? own.filter((fee) => fee.subject!.verified).length / own.length : 0;
  const parts = {
    fit: Math.round(SCORE_WEIGHTS.fit * fit),
    buyer: Math.round(SCORE_WEIGHTS.buyer * buyerRelevance(contact, assetsK)),
    research: Math.round(SCORE_WEIGHTS.research * Math.min(tierA / 5, 1)),
    confidence: Math.round(SCORE_WEIGHTS.confidence * confidence),
    commercial: Math.round(SCORE_WEIGHTS.commercial * (assetsK !== null && assetsK >= 500_000 ? 1 : 0.67)),
  };
  return { total: parts.fit + parts.buyer + parts.research + parts.confidence + parts.commercial, parts, tiers };
}

/** The research problem the email names, by the addressee's role (plan section 1). */
export function roleProblem(contact: { title: string | null; role: ContactRole }): { opening: string; useFor: string } {
  const title = contact.title ?? "";
  if (FINANCE_TITLE.test(title) || contact.role === "finance") {
    return { opening: "Preparing a competitive fee review for management or the board", useFor: "your next pricing review" };
  }
  if (/\b(?:retail|deposits?|member)\b/i.test(title) || contact.role === "retail") {
    return { opening: "Reviewing how competitors structure their deposit-account fees", useFor: "your deposit-account reviews" };
  }
  if (/\b(?:product|marketing|brand)\b/i.test(title) || contact.role === "marketing") {
    return { opening: "Reviewing a checking product against what competitors publish", useFor: "your product reviews" };
  }
  if (contact.role === "compliance") {
    return { opening: "Checking competitor fee figures used in internal analysis", useFor: "your internal analysis" };
  }
  return { opening: "Keeping track of what competitors charge", useFor: "your team" };
}
