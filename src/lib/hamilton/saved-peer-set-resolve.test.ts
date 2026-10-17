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
  return { PeerSetError, resolvePeerSet: vi.fn(), getPeerSubject: vi.fn() };
});
vi.mock("@/lib/data-store/peer-sets", () => peerSets);

import {
  getActivePeerSet,
  parseSavedPeerSetFilters,
  resolveHamiltonPeerIndex,
  resolveSavedPeerSetFilters,
  savedPeerSetDefinition,
} from "./peer-index";

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

describe("basic saved sets are unchanged", () => {
  const basics: SavedPeerSet[] = [
    set({ charter_type: "bank", tiers: "community_mid,community_large", districts: "6,11", states: ["fl", "GA"] }),
    set({ institution_ids: [5, 21, 323] }),
    set({ charter_type: "credit_union", districts: "6,99" }),
    set({ states: ["TX"], advanced: null }),
    // A hand-picked set never takes wider dimensions, even if some were stored.
    set({ institution_ids: [5, 21], advanced: { nearest: 5 } }),
  ];

  for (const basic of basics) {
    it(`gives exactly parseSavedPeerSetFilters for ${JSON.stringify(parseSavedPeerSetFilters(basic))}`, async () => {
      const resolved = await resolveSavedPeerSetFilters(basic, 323);
      expect(resolved.filters).toEqual(parseSavedPeerSetFilters(basic));
      expect(resolved.problem).toBeNull();
      expect(peerSets.resolvePeerSet).not.toHaveBeenCalled();
      expect(peerSets.getPeerSubject).not.toHaveBeenCalled();
    });
  }

  it("keeps today's literal filters for the readers", () => {
    expect(parseSavedPeerSetFilters(basics[0])).toEqual({
      charter_type: "bank", asset_tiers: ["community_mid", "community_large"], fed_districts: [6, 11], states: ["FL", "GA"],
    });
    expect(parseSavedPeerSetFilters(basics[1])).toEqual({ institutionIds: [5, 21, 323] });
  });

  it("passes a basic explicit set to getPeerIndex as before", async () => {
    savedPeers.getSavedPeerSetById.mockResolvedValue(basics[0]);
    fee.getPeerIndex.mockResolvedValue(usable(2));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "1", institutionId: 323 });
    expect(fee.getPeerIndex).toHaveBeenCalledTimes(1);
    expect(fee.getPeerIndex).toHaveBeenCalledWith(parseSavedPeerSetFilters(basics[0]), true);
    expect(peerSets.resolvePeerSet).not.toHaveBeenCalled();
    expect(result.label).toBe("FL/GA · bank · $300M to $1B or $1B to $10B · Fed district 6/11 peers");
  });
});

describe("sets with wider dimensions", () => {
  const metro = set({
    id: 9, name: "Tallahassee banks", charter_type: "bank", states: ["FL"],
    advanced: { asset_min: 500_000_000, regulators: ["occ", "fdic"], market_code: 45220, nearest: 10 },
  });

  it("builds the shared definition from columns plus the filters jsonb", () => {
    expect(savedPeerSetDefinition(metro)).toEqual({
      charter_type: "bank", states: ["FL"], asset_min: 500_000_000, regulators: ["occ", "fdic"], market_code: 45220, nearest: 10,
    });
  });

  it("resolves only through resolvePeerSet and hands its filters to the fee index", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: { institutionIds: [5, 21] }, label: "Banks", market: null });
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    fee.getPeerIndex.mockResolvedValue(usable(3));

    const result = await resolveHamiltonPeerIndex({ userId: 7, institutionId: 323 });

    expect(peerSets.getPeerSubject).toHaveBeenCalledWith(323);
    expect(peerSets.resolvePeerSet).toHaveBeenCalledWith(savedPeerSetDefinition(metro), capitalCity);
    expect(fee.getPeerIndex).toHaveBeenCalledTimes(1);
    expect(fee.getPeerIndex).toHaveBeenCalledWith({ institutionIds: [5, 21] }, true);
    expect(fee.getPeerIndexes).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: "saved-peer-set", label: "Tallahassee banks", peerSetId: "9", filters: { institutionIds: [5, 21] } });
  });

  it("gives charts the resolved institutions and names an unnamed group with describePeerSet's label", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({
      definition: {}, filters: { institutionIds: [5] }, label: "Banks with at least $500M in assets", market: null,
    });
    savedPeers.getDefaultPeerSets.mockResolvedValue([{ ...metro, name: "" }]);
    const active = await getActivePeerSet({ userId: 7, institutionId: 323 });
    expect(active).toEqual({ id: 9, name: "", filters: { institutionIds: [5] }, label: "Banks with at least $500M in assets" });
  });

  it("never turns an empty group into the national index", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: null, label: "Banks", market: null });
    savedPeers.getDefaultPeerSets.mockResolvedValue([metro]);
    fee.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(1)));

    expect(await getActivePeerSet({ userId: 7, institutionId: 323 })).toBeNull();
    const result = await resolveHamiltonPeerIndex({
      userId: 7, institutionId: 323,
      selectedInstitution: { institution_name: "Capital City Bank", state_code: "FL", charter_type: "bank", asset_size_tier: "community_large", fed_district: 6 },
    });
    expect(fee.getPeerIndex).not.toHaveBeenCalled();
    expect(result.source).toBe("selected-institution-default");
    expect(result.fallbackReason).toContain('Your peer group "Tallahassee banks" has no peers right now');
    expect(result.fallbackReason).toContain("None found");
  });

  it("says why when closest in assets has no institution to measure against", async () => {
    peerSets.resolvePeerSet.mockRejectedValue(new peerSets.PeerSetError("no assets"));
    const resolved = await resolveSavedPeerSetFilters(metro, null);
    expect(resolved.filters).toBeNull();
    expect(resolved.problem).toContain("closest in total assets");
  });

  it("falls back to the national index for an explicit set with no peers", async () => {
    peerSets.getPeerSubject.mockResolvedValue(capitalCity);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: null, label: "Banks", market: null });
    savedPeers.getSavedPeerSetById.mockResolvedValue(metro);
    fee.getNationalIndexCached.mockResolvedValue(usable(9));
    const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "9", institutionId: 323 });
    expect(fee.getPeerIndex).not.toHaveBeenCalled();
    expect(result.source).toBe("national");
    expect(result.fallbackReason).toContain("None found");
  });
});
