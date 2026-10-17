/**
 * The peer sets the public pages offer, each one resolved only through peer-sets.ts so a
 * group is never computed two ways. The pages read a set's values or medians through the
 * fee index; nothing here adds a filter of its own.
 */
import { getPeerIndexes, type IndexEntry } from "./fee-index";
import type { PeerSetChoice } from "./peer-fee-rank";
import {
  PeerSetError,
  getPeerSubject,
  resolvePeerRequest,
  resolvePeerSet,
  type PeerRegulator,
  type PeerSetDefinition,
  type PeerSetRequest,
  type PeerSubject,
} from "./peer-sets";

/** How many institutions closest in assets make the "nearest" set. */
export const NEAREST_PEER_COUNT = 25;

/** The institution page's choices, in the order the picker lists them (?peers=...). */
export const INSTITUTION_PEER_SET_KEYS = ["state", "district", "size", "regulator", "metro", "nearest"] as const;
export type InstitutionPeerSetKey = (typeof INSTITUTION_PEER_SET_KEYS)[number];

/** Every choice keeps the institution's own charter, so banks meet banks and credit unions credit unions. */
export function institutionPeerRequest(key: InstitutionPeerSetKey, subject: PeerSubject): PeerSetRequest {
  switch (key) {
    case "state":
      return { charter_type: "same", states: "same" };
    case "district":
      return { charter_type: "same", fed_districts: "same" };
    case "size":
      return { charter_type: "same", asset_tiers: "same" };
    case "regulator":
      // Every credit union answers to NCUA, so its charter (federal or state) is the regulator split.
      return subject.charter_type === "credit_union"
        ? { charter_type: "same", cu_charter: "same" }
        : { charter_type: "same", regulators: "same" };
    case "metro":
      return { charter_type: "same", market: "same" };
    case "nearest":
      return { charter_type: "same", nearest: NEAREST_PEER_COUNT };
  }
}

/**
 * Each institution-page choice resolved for one institution. A choice the institution has no
 * value for (no metro, no regulator on record) is left out rather than guessed.
 */
export async function getInstitutionPeerChoices(institutionId: number): Promise<PeerSetChoice[]> {
  const subject = await getPeerSubject(institutionId);
  if (!subject) return [];
  const resolved = await Promise.all(
    INSTITUTION_PEER_SET_KEYS.map(async (key): Promise<PeerSetChoice | null> => {
      try {
        const set = await resolvePeerRequest(subject, institutionPeerRequest(key, subject));
        return { key, label: set.label, filters: set.filters };
      } catch (error) {
        if (error instanceof PeerSetError) return null;
        throw error;
      }
    }),
  );
  return resolved.filter((choice): choice is PeerSetChoice => choice !== null);
}

const STATE_SIZE_TIERS = ["community_small", "community_mid", "community_large", "regional"] as const;
const STATE_REGULATORS: PeerRegulator[] = ["occ", "fdic", "fed"];

/**
 * The state page's choices among institutions headquartered in the state: by size band, by
 * bank regulator, and by credit union charter. Banks against credit unions already has its
 * own exhibit on the page.
 */
export function statePeerDefinitions(stateCode: string): { key: string; def: PeerSetDefinition }[] {
  const states = [stateCode];
  return [
    ...STATE_SIZE_TIERS.map((tier) => ({ key: tier, def: { asset_tiers: [tier], states } })),
    ...STATE_REGULATORS.map((r) => ({ key: r, def: { charter_type: "bank", regulators: [r], states } })),
    { key: "federal_cu", def: { charter_type: "credit_union", cu_charter: "federal" as const, states } },
    { key: "state_cu", def: { charter_type: "credit_union", cu_charter: "state" as const, states } },
  ];
}

export interface PeerSetIndex {
  key: string;
  label: string;
  /** The set's fee index: each fee's median and how many institutions it counts. */
  entries: Pick<IndexEntry, "fee_category" | "median_amount" | "institution_count">[];
}

/** Each state choice resolved, with its fee index from one catalog read. */
export async function getStatePeerSetIndexes(stateCode: string): Promise<PeerSetIndex[]> {
  const resolved = await Promise.all(
    statePeerDefinitions(stateCode).map(async ({ key, def }) => ({ key, set: await resolvePeerSet(def, null) })),
  );
  const withPeers = resolved.filter((r) => r.set.filters !== null);
  if (withPeers.length === 0) return [];
  const indexes = await getPeerIndexes(withPeers.map((r) => r.set.filters!));
  return withPeers.map((r, i) => ({
    key: r.key,
    label: r.set.label,
    entries: indexes[i].map(({ fee_category, median_amount, institution_count }) => ({ fee_category, median_amount, institution_count })),
  }));
}
