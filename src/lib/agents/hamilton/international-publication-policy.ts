import { sameProduct } from "@/lib/fee-product";
import { countsInMarketComparison } from "@/lib/market-eligibility";
import { reviewInternationalDirection, type OwnWireScope } from "@/lib/custom-report/own-wire-scope";

/** Factual current lineage supplied by the locked publication adapter, never caller claims. */
export interface InternationalPublicationFacts {
  publishedId?: number;
  category: string;
  name: string;
  amount: number | null;
  frequency: string | null;
  audience: string | null;
  product: string | null;
  sourceUrl: string | null;
  sourceLine: string | null;
  sourced: boolean;
  scope: OwnWireScope;
}

export type InternationalPublicationPolicy = { kind: "not_applicable" | "ready" }
  | { kind: "deferred"; reason: "candidate_scope_unproven" | "live_scope_conflict"; conflictingPublishedIds: number[] };

const overlap = (one: string | null, two: string | null) => one === two
  || [one ?? "unknown", two ?? "unknown"].some(value => value === "unknown" || value === "both");
const comparable = (row: InternationalPublicationFacts) => countsInMarketComparison({
  category: row.category, amount: row.amount, audience: row.audience, sourced: row.sourced,
  sourceUrl: row.sourceUrl, feeName: row.name, accountProduct: row.product,
  sourceLine: row.sourceLine, frequency: row.frequency,
});

/** Public comparison/identity facts only; original-source availability cannot erase a peer. */
export function potentialInternationalPublicationPeer(candidate: InternationalPublicationFacts,
  peer: InternationalPublicationFacts): boolean {
  return comparable(candidate) && peer.category === candidate.category && peer.amount !== candidate.amount
    && sameProduct(peer.product, candidate.product) && overlap(peer.audience, candidate.audience) && comparable(peer);
}

/**
 * A nonsettling prospective publication decision. This neither rewrites old rows nor
 * interprets their generic price as an incoming/outgoing price or a new numeric bound.
 */
export function internationalPublicationPolicy(candidate: InternationalPublicationFacts,
  peers: readonly InternationalPublicationFacts[]): InternationalPublicationPolicy {
  if (!candidate.category.startsWith("wire_intl_")) return { kind: "not_applicable" };
  if (!candidate.sourced || reviewInternationalDirection(candidate.scope, candidate.category).kind !== "admit")
    return { kind: "deferred", reason: "candidate_scope_unproven", conflictingPublishedIds: [] };
  if (!comparable(candidate)) return { kind: "ready" };
  const conflicts = peers.filter(peer => potentialInternationalPublicationPeer(candidate, peer)
    && reviewInternationalDirection(peer.scope, peer.category).kind !== "admit")
    .map(peer => peer.publishedId!).filter(Number.isSafeInteger).sort((a, b) => a - b);
  return conflicts.length ? { kind: "deferred", reason: "live_scope_conflict", conflictingPublishedIds: conflicts }
    : { kind: "ready" };
}
