import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedPeerSet } from "@/lib/data-store/saved-peers";

const fee = vi.hoisted(() => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
}));
vi.mock("@/lib/data-store/fee-index", () => fee);
const savedPeers = vi.hoisted(() => ({ getSavedPeerSetById: vi.fn(), getDefaultPeerSets: vi.fn() }));
vi.mock("@/lib/data-store/saved-peers", () => savedPeers);
const peerSets = vi.hoisted(() => {
  class PeerSetError extends Error {}
  return { PeerSetError, resolvePeerSet: vi.fn(), getPeerSubject: vi.fn(), resolvePeerInstitutionIds: vi.fn() };
});
vi.mock("@/lib/data-store/peer-sets", () => peerSets);

import {
  getActivePeerSet,
  parseSavedPeerSetFilters,
  resolveHamiltonPeerIndex,
  resolveSavedPeerGroupMembership,
  resolveSavedPeerSetFilters,
  savedPeerSetDefinition,
} from "./peer-index";
import { emptyPeerGroupMessage } from "./peer-group-copy";

function set(overrides: Partial<SavedPeerSet>): SavedPeerSet {
  return {
    id: 1, name: "", tiers: null, districts: null, charter_type: null, created_by: "7",
    created_at: "2026-10-17T00:00:00Z", institution_ids: null, states: null, institution_id: 323,
    is_default: true, ...overrides,
  };
}
const usable = (median: number) => [1, 2, 3].map((i) => ({ fee_category: `c${i}`, median_amount: median, institution_count: 8 }));
const capitalCity = { id: 323, charter_type: "bank", asset_size: 4_000_000, state_code: "FL" };

beforeEach(() => vi.resetAllMocks());

describe("basic saved sets resolve to their exact institutions", () => {
  const basics: SavedPeerSet[] = [
    set({ charter_type: "bank", tiers: "community_mid,community_large", districts: "6,11", states: ["fl", "GA"] }),
    set({ institution_ids: [5, 21, 323] }),
    set({ charter_type: "credit_union", districts: "6,99" }),
    set({ states: ["TX"], advanced: null }),
    // A hand-picked set never takes wider dimensions, even if some were stored.
    set({ institution_ids: [5, 21], advanced: { nearest: 5 } }),
  ];

  for (const basic of basics) {
    it(`reads ${JSON.stringify(parseSavedPeerSetFilters(basic))} through resolvePeerInstitutionIds, the research institution left out`, async () => {
      peerSets.resolvePeerInstitutionIds.mockResolvedValue([5, 21]);
      const resolved = await resolveSavedPeerGroupMembership(basic, 323);
      expect(peerSets.resolvePeerInstitutionIds).toHaveBeenCalledWith(savedPeerSetDefinition(basic), { id: 323 });
      expect(resolved).toMatchObject({ status: "ready", institutionIds: [5, 21], filters: { institutionIds: [5, 21] }, problem: null });
      expect(peerSets.resolvePeerSet).not.toHaveBeenCalled();
      expect(peerSets.getPeerSubject).not.toHaveBeenCalled();
    });
  }

  it("keeps the stored filters as the definition", () => {
    expect(parseSavedPeerSetFilters(basics[0])).toEqual({
      charter_type: "bank", asset_tiers: ["community_mid", "community_large"], fed_districts: [6, 11], states: ["FL", "GA"],
    });
    expect(parseSavedPeerSetFilters(basics[1])).toEqual({ institutionIds: [5, 21, 323] });
  });

  it("passes a basic explicit set's institutions to getPeerIndex and names it", async () => {
    savedPeers.getSavedPeerSetById.mockResolvedValue(basics[0]);
    peerSets.resolvePeerInstitutionIds.mockResolvedValue([5, 21, 40]);
    fee.getPeerIndex.mockResolvedValue(usable(2));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "1", institutionId: 323 });
    expect(fee.getPeerIndex).toHaveBeenCalledTimes(1);
    expect(fee.getPeerIndex).toHaveBeenCalledWith({ institutionIds: [5, 21, 40] }, true);
    expect(result).toMatchObject({
      status: "ready",
      label: "FL/GA · bank · $300M to $1B or $1B to $10B · Fed district 6/11 peers",
      group: { id: 1, institutionCount: 3, institutionId: 323 },
    });
  });

  it("is empty, with the reason, when a basic set matches nobody", async () => {
    peerSets.resolvePeerInstitutionIds.mockResolvedValue([]);
    const resolved = await resolveSavedPeerGroupMembership(set({ name: "Texas CUs", charter_type: "credit_union", states: ["TX"] }), 323);
    expect(resolved).toEqual({
      status: "empty", institutionIds: [], filters: null, label: "Texas CUs",
      problem: "None found: no institution meets all of its filters.",
    });
  });
});

describe("sets with wider dimensions", () => {
  const metro = set({
    id: 9, name: "Tallahassee banks", charter_type: "bank", states: ["FL"],
    advanced: { asset_min: 500_000_000, regulators: ["occ", "fdic"], market_code: 45220, nearest: 10 },
  });
  const capitalCityDetail = { institution_name: "Capital City Bank", state_code: "FL", charter_type: "bank", asset_size_tier: "community_large", fed_district: 6 };

  it("builds the shared definition from columns plus the filters jsonb", () => {
    expect(savedPeerSetDefinition(metro)).toEqual({
      charter_type: "bank", states: ["FL"], asset_min: 500_000_000, regulators: ["occ", "fdic"], market_code: 45220, nearest: 10,
    });
  });

  it("resolves only through resolvePeerSet and hands its institutions to the fee index", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: { institutionIds: [5, 21] }, label: "Banks", market: null });
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    fee.getPeerIndex.mockResolvedValue(usable(3));

    const result = await resolveHamiltonPeerIndex({ userId: 7, institutionId: 323 });

    expect(peerSets.getPeerSubject).toHaveBeenCalledWith(323);
    expect(peerSets.resolvePeerSet).toHaveBeenCalledWith(savedPeerSetDefinition(metro), capitalCity);
    expect(peerSets.resolvePeerInstitutionIds).not.toHaveBeenCalled();
    expect(fee.getPeerIndex).toHaveBeenCalledTimes(1);
    expect(fee.getPeerIndex).toHaveBeenCalledWith({ institutionIds: [5, 21] }, true);
    expect(fee.getPeerIndexes).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ready", source: "saved-peer-set", label: "Tallahassee banks", peerSetId: "9", filters: { institutionIds: [5, 21] } });
  });

  it("gives charts the resolved institutions and names an unnamed group with describePeerSet's label", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({
      definition: {}, filters: { institutionIds: [5] }, label: "Banks with at least $500M in assets", market: null,
    });
    savedPeers.getDefaultPeerSets.mockResolvedValue([{ ...metro, name: "" }]);
    const active = await getActivePeerSet({ userId: 7, institutionId: 323 });
    expect(active).toEqual({
      status: "ready", id: 9, name: "", filters: { institutionIds: [5] }, label: "Banks with at least $500M in assets",
      institutionCount: 1, institutionId: 323, definition: null,
    });
  });

  it("never substitutes another group for a default group that matches no institutions", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: null, label: "Banks", market: null });
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    fee.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(1)));
    fee.getNationalIndexCached.mockResolvedValue(usable(9));

    const reason = "None found: no institution meets all of its filters.";
    expect(await getActivePeerSet({ userId: 7, institutionId: 323, institutionName: "Capital City Bank" })).toEqual({
      status: "empty", id: 9, name: "Tallahassee banks", label: "Tallahassee banks", institutionId: 323, institutionName: "Capital City Bank", reason,
    });
    const result = await resolveHamiltonPeerIndex({ userId: 7, institutionId: 323, selectedInstitution: capitalCityDetail });
    expect(fee.getPeerIndex).not.toHaveBeenCalled();
    expect(fee.getPeerIndexes).not.toHaveBeenCalled();
    expect(fee.getNationalIndexCached).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "empty", id: 9, name: "Tallahassee banks", label: "Tallahassee banks", institutionId: 323,
      institutionName: "Capital City Bank", reason, entries: [], source: "saved-peer-set", peerSetId: "9",
    });
    expect(result.status === "empty" && emptyPeerGroupMessage(result)).toBe(
      `Your peer group "Tallahassee banks" matches no institutions for Capital City Bank. ${reason}`,
    );
  });

  it("says why when closest in assets has no institution to measure against", async () => {
    peerSets.resolvePeerSet.mockRejectedValue(new peerSets.PeerSetError("no assets"));
    const resolved = await resolveSavedPeerSetFilters(metro, null);
    expect(resolved.status).toBe("empty");
    expect(resolved.filters).toBeNull();
    expect(resolved.problem).toBe('Choose a research institution in Settings first. "Closest in total assets" is measured against it.');
  });

  it("keeps an explicitly picked set with no peers empty instead of using the national index", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: null, label: "Banks", market: null });
    savedPeers.getSavedPeerSetById.mockResolvedValue(metro);
    fee.getNationalIndexCached.mockResolvedValue(usable(9));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "9", institutionId: 323 });
    expect(fee.getPeerIndex).not.toHaveBeenCalled();
    expect(fee.getNationalIndexCached).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "empty", source: "saved-peer-set", peerSetId: "9", entries: [] });
  });

  it("keeps a picked set that is no longer available empty instead of using automatic peers", async () => {
    savedPeers.getSavedPeerSetById.mockResolvedValue(null);
    fee.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(1)));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "44", institutionId: 323, selectedInstitution: capitalCityDetail });
    expect(fee.getPeerIndexes).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "empty", id: 44, peerSetId: "44" });
  });

  it("never widens a group with members, however few publish a fee", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: { institutionIds: [5] }, label: "Banks", market: null });
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    const thin = [{ fee_category: "overdraft", median_amount: null, institution_count: 1 }];
    fee.getPeerIndex.mockResolvedValue(thin);
    const result = await resolveHamiltonPeerIndex({ userId: 7, institutionId: 323, selectedInstitution: capitalCityDetail });
    expect(fee.getPeerIndexes).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ready", source: "saved-peer-set", entries: thin, fallbackReason: null, group: { institutionCount: 1 } });
  });

  it("uses automatic peers when the reader picks them, even with a default group", async () => {
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    fee.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(1)));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "auto", institutionId: 323, selectedInstitution: capitalCityDetail });
    expect(savedPeers.getDefaultPeerSets).not.toHaveBeenCalled();
    expect(peerSets.resolvePeerSet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ready", source: "selected-institution-default", group: null });
  });
});
