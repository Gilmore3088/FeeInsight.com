import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
}));

vi.mock("@/lib/data-store/fee-index", () => mocks);
const savedPeers = vi.hoisted(() => ({ getSavedPeerSetById: vi.fn(), getDefaultPeerSets: vi.fn() }));
vi.mock("@/lib/data-store/saved-peers", () => savedPeers);

import { resolveHamiltonPeerIndex } from "./peer-index";

const institution = {
  institution_name: "Example Bank",
  state_code: "GA",
  charter_type: "bank",
  asset_size_tier: "community",
  fed_district: 6,
};

function usable(median: number) {
  return [1, 2, 3].map((i) => ({ fee_category: `c${i}`, median_amount: median, institution_count: 8 }));
}

describe("resolveHamiltonPeerIndex", () => {
  beforeEach(() => vi.resetAllMocks());

  it("loads every default candidate in one query and takes the narrowest usable one", async () => {
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map((_, i) => (i < 2 ? [] : usable(i))));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution });

    expect(mocks.getPeerIndexes).toHaveBeenCalledTimes(1);
    expect(mocks.getPeerIndex).not.toHaveBeenCalled();
    expect(result.source).toBe("selected-institution-default");
    expect(result.entries[0].median_amount).toBe(2);
  });

  it("falls back to the cached national index when every candidate is too sparse", async () => {
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => []));
    mocks.getNationalIndexCached.mockResolvedValue(usable(9));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution });

    expect(result.source).toBe("national");
    expect(mocks.getNationalIndexCached).toHaveBeenCalledTimes(1);
    expect(mocks.getNationalIndex).not.toHaveBeenCalled();
  });

  describe("with a default peer group", () => {
    const teamSet = {
      id: 42,
      name: "Our five rivals",
      tiers: null,
      districts: null,
      charter_type: null,
      created_by: "9",
      created_at: "2026-10-07T00:00:00Z",
      institution_ids: [11, 12, 13, 14, 15],
      states: null,
      institution_id: 2945,
      is_default: true,
    };

    it("uses the active set when no peerSetId is passed", async () => {
      savedPeers.getDefaultPeerSets.mockResolvedValue([teamSet]);
      mocks.getPeerIndex.mockResolvedValue(usable(4));

      const result = await resolveHamiltonPeerIndex({
        userId: 7,
        selectedInstitution: { ...institution, id: 2945 },
      });

      expect(savedPeers.getDefaultPeerSets).toHaveBeenCalledWith({ userId: "7", institutionId: 2945 });
      expect(mocks.getPeerIndex).toHaveBeenCalledWith({ institutionIds: [11, 12, 13, 14, 15] }, true);
      expect(mocks.getPeerIndexes).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        source: "saved-peer-set",
        label: "Our five rivals",
        peerSetId: "42",
        fallbackReason: null,
      });
    });

    it("widens to the bank's default groups when the active set is too thin", async () => {
      savedPeers.getDefaultPeerSets.mockResolvedValue([teamSet]);
      mocks.getPeerIndex.mockResolvedValue([]);
      mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(3)));

      const result = await resolveHamiltonPeerIndex({ userId: 7, institutionId: 2945, selectedInstitution: institution });

      expect(result.source).toBe("selected-institution-default");
      expect(result.fallbackReason).toContain("Our five rivals");
    });

    it("does not look up a default without a user", async () => {
      mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => usable(3)));

      const result = await resolveHamiltonPeerIndex({ selectedInstitution: { ...institution, id: 2945 } });

      expect(savedPeers.getDefaultPeerSets).not.toHaveBeenCalled();
      expect(result.source).toBe("selected-institution-default");
    });

    it("keeps an explicit peerSetId ahead of the default", async () => {
      savedPeers.getSavedPeerSetById.mockResolvedValue({ ...teamSet, id: 5, name: "Picked", institution_ids: null, states: ["GA"] });
      mocks.getPeerIndex.mockResolvedValue(usable(2));

      const result = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: "5", selectedInstitution: institution });

      expect(savedPeers.getDefaultPeerSets).not.toHaveBeenCalled();
      expect(mocks.getPeerIndex).toHaveBeenCalledWith({ states: ["GA"] }, true);
      expect(result).toMatchObject({ source: "saved-peer-set", label: "Picked", peerSetId: "5" });
    });
  });
});
