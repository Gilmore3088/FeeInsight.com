/**
 * The peer sets the public pages offer, each one resolved only through peer-sets.ts so a
 * group is never computed two ways. The pages read a set's values or medians through the
 * fee index; nothing here adds a filter of its own.
 */
import { getPeerIndexes, peerInstitutionIds, type IndexEntry } from "./fee-index";
import { explorerMemberIds } from "./peer-explorer";
import type { PeerSetChoice } from "./peer-fee-rank";
import {
  PeerSetError,
  getPeerSubject,
  resolvePeerRequest,
  describePeerSet,
  resolvePeerSet,
  type PeerRegulator,
  type PeerSetDefinition,
  type PeerSetRequest,
  type PeerSubject,
  type ResolvedPeerSet,
} from "./peer-sets";

/** How many institutions closest in assets make the "nearest" set. */
export const NEAREST_PEER_COUNT = 25;

/**
 * The institution page's choices, in the order the picker lists them (?peers=...), narrowest
 * first. The default is the first that compares at least 80% of the institution's own fees, else
 * the one that compares the most (pickPeerSet, the shared default-group rule, #2098).
 * `metro_banks` is the home metro's banks-only view: a toggle on the Home metro chip, never the
 * default (BANKS_ONLY_METRO_KEY).
 */
export const INSTITUTION_PEER_SET_KEYS = ["nearest", "metro", "metro_banks", "state", "district", "size", "regulator"] as const;
export type InstitutionPeerSetKey = (typeof INSTITUTION_PEER_SET_KEYS)[number];

/**
 * Every choice but the home metro keeps the institution's own charter, so banks meet banks and
 * credit unions credit unions. The home metro is the local market, so it takes banks and credit
 * unions together, with a banks-only view beside it (James, 2026-10-20; tracker #1811).
 */
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
      return { market: "same" };
    case "metro_banks":
      return { charter_type: "bank", market: "same" };
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
    INSTITUTION_PEER_SET_KEYS.map(async (key): Promise<ResolvedChoice | null> => {
      try {
        const set = await resolvePeerRequest(subject, institutionPeerRequest(key, subject));
        return { key, label: homeMetroLabel(key, set.market?.name) ?? set.label, filters: set.filters, resolved: set };
      } catch (error) {
        if (error instanceof PeerSetError) return null;
        throw error;
      }
    }),
  );
  return keepExplorerMembers(resolved.filter((choice): choice is ResolvedChoice => choice !== null));
}

/** "Banks and credit unions in the Tallahassee, FL metro", or null for any other set. */
function homeMetroLabel(key: InstitutionPeerSetKey, metro: string | undefined): string | null {
  if (!metro) return null;
  if (key === "metro") return `Banks and credit unions in the ${metro} metro`;
  if (key === "metro_banks") return `Banks in the ${metro} metro`;
  return null;
}

/**
 * A chosen set (nearest, home metro, regulator) keeps only the institutions the peer explorer
 * lists (explorerMemberIds), so its count is the explorer's. The home metro once counted every
 * bank with a branch there (17 in Tallahassee) while the explorer showed the 14 that are active
 * and publish fees (James's Oct 20 review of #1887). A set left with nobody is not offered.
 * Filter sets (state, district, size) carry no count and pass through unchanged. The nearest
 * set's label is rebuilt from the members kept, so it never names more than the explorer shows.
 */
async function keepExplorerMembers(choices: ResolvedChoice[]): Promise<PeerSetChoice[]> {
  const strip = (choice: ResolvedChoice): PeerSetChoice => ({ key: choice.key, label: choice.label, filters: choice.filters });
  const chosen = new Set(choices.flatMap((choice) => (choice.filters ? (peerInstitutionIds(choice.filters) ?? []) : [])));
  if (chosen.size === 0) return choices.map(strip);
  const members = await explorerMemberIds([...chosen]);
  const trimmed = choices.map((choice) => {
    const ids = choice.filters ? peerInstitutionIds(choice.filters) : null;
    if (!ids) return strip(choice);
    const kept = ids.filter((id) => members.has(id));
    const { definition, market } = choice.resolved;
    const label = definition.nearest !== undefined && kept.length > 0 ? describePeerSet(definition, market, kept.length) : choice.label;
    return { ...strip(choice), label, filters: kept.length > 0 ? { ...choice.filters, institutionIds: kept } : null };
  });
  return nameHomeMetroCharters(trimmed);
}

/** How many members a choice keeps; null when it lists none or is a filter set. */
function memberCount(choice: PeerSetChoice | undefined): number | null {
  return choice?.filters?.institutionIds?.length ?? null;
}

/**
 * The home metro is named "Banks and credit unions" only when it keeps a credit union. Its
 * banks-only view is the same members without credit unions, so the same count means none, and
 * the set is named "Banks in the ... metro" like that view (James, 2026-10-20).
 */
function nameHomeMetroCharters(choices: PeerSetChoice[]): PeerSetChoice[] {
  const banksOnly = choices.find((choice) => choice.key === "metro_banks");
  return choices.map((choice) => {
    if (choice.key !== "metro" || !banksOnly) return choice;
    const count = memberCount(choice);
    return count !== null && count === memberCount(banksOnly) ? { ...choice, label: banksOnly.label } : choice;
  });
}

/** A choice with the resolved set it came from, so a trimmed nearest set can be renamed. */
type ResolvedChoice = PeerSetChoice & { resolved: ResolvedPeerSet };

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
