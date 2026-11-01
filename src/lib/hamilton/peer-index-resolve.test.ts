import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
  getInstitutionOwnFees: vi.fn(),
}));

// The resolver reads the stamped readers; each wraps a plain mock so calls stay easy to assert.
const stamps = vi.hoisted(() => {
  const base = {
    methodVersion: 13,
    counting: "counted_once" as const,
    filters: [{ key: "sourced", label: "Only sourced fees" }],
    newestRecordAt: null,
  };
  return {
    live: (key: string) => ({ ...base, dataset: "published_fee_catalog" as const, mode: "live" as const, readAt: "2026-10-18T14:00:00.000Z", runId: null, id: `live:${key}` }),
    cached: {
      ...base,
      dataset: "fee_index_cache" as const,
      derivedFrom: "published_fee_catalog" as const,
      mode: "cached" as const,
      readAt: "2026-10-17T02:00:00.000Z",
      runId: 9001,
      id: "cached",
    },
  };
});

vi.mock("@/lib/data-store/fee-index", () => ({
  getInstitutionOwnFees: (id: number) => mocks.getInstitutionOwnFees(id),
  getPeerIndexStamped: async (filters: unknown, approvedOnly: boolean) => ({
    entries: await mocks.getPeerIndex(filters, approvedOnly),
    stamp: stamps.live(JSON.stringify(filters)),
  }),
  getPeerIndexesStamped: async (sets: unknown[], approvedOnly: boolean) =>
    ((await mocks.getPeerIndexes(sets, approvedOnly)) as unknown[]).map((entries, i) => ({ entries, stamp: stamps.live(JSON.stringify(sets[i])) })),
  getNationalIndexStamped: async (approvedOnly: boolean) => ({ entries: await mocks.getNationalIndex(approvedOnly), stamp: stamps.live("national") }),
  getNationalIndexCachedStamped: async () => ({ entries: await mocks.getNationalIndexCached(), stamp: stamps.cached }),
}));
const savedPeers = vi.hoisted(() => ({ getSavedPeerSetById: vi.fn(), getDefaultPeerSets: vi.fn() }));
vi.mock("@/lib/data-store/saved-peers", () => savedPeers);

import { resolveHamiltonPeerIndex } from "./peer-index";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";

const institution = {
  institution_name: "Example Bank",
  state_code: "GA",
  charter_type: "bank",
  asset_size_tier: "community",
  fed_district: 6,
};

// Usable: three fees with a median, overdraft (the fee that picks the group) among them.
function usable(median: number, overdraftCount = 12) {
  return ["overdraft", "c2", "c3"].map((c) => ({ fee_category: c, median_amount: median, institution_count: c === "overdraft" ? overdraftCount : 12 }));
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
    // The stamp is the chosen candidate's, not another candidate's.
    expect(result.stamp.id).toBe(`live:${JSON.stringify(result.filters)}`);
    expect(result.stamp.mode).toBe("live");
  });

  it(`picks the group as every answer does: the narrowest where ${MIN_PEERS_FOR_POSITION} or more publish an overdraft fee (#2096)`, async () => {
    // The first candidate has three usable fees but only 9 overdraft publishers, so it is passed over.
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map((_, i) => (i === 0 ? usable(1, MIN_PEERS_FOR_POSITION - 1) : usable(i + 1))));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution, minUsableCategories: 1 });

    expect(result.source).toBe("selected-institution-default");
    expect(result.entries[0].median_amount).toBe(2);
  });

  it("still needs the caller's usable fees: a report's three are not met by overdraft alone", async () => {
    const overdraftOnly = [{ fee_category: "overdraft", median_amount: 30, institution_count: 12 }];
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map((_, i) => (i === 0 ? overdraftOnly : usable(i + 1))));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution, minUsableCategories: 3 });

    expect(result.entries[0].median_amount).toBe(2);
  });

  it(`picks the narrowest group where ${MIN_PEERS_FOR_POSITION} others publish 80% of the bank's own fees (#2098)`, async () => {
    // The bank publishes overdraft, c2 and c3. The first group has 12 overdraft publishers but only
    // 10 for c2 and c3 (the bank counts itself, so 11 are needed): one of three fees, passed over.
    mocks.getInstitutionOwnFees.mockResolvedValue(new Map([["overdraft", {}], ["c2", {}], ["c3", {}]]));
    const thin = [{ fee_category: "overdraft", median_amount: 1, institution_count: 12 }, ...["c2", "c3"].map((c) => ({ fee_category: c, median_amount: 1, institution_count: MIN_PEERS_FOR_POSITION }))];
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map((_, i) => (i === 0 ? thin : usable(i + 1))));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: { ...institution, id: 2945 }, minUsableCategories: 1 });

    expect(mocks.getInstitutionOwnFees).toHaveBeenCalledWith(2945);
    expect(result.entries[0].median_amount).toBe(2);
  });

  it("falls back to the cached national index when every candidate is too sparse", async () => {
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => []));
    mocks.getNationalIndexCached.mockResolvedValue(usable(9));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution });

    expect(result.source).toBe("national");
    expect(mocks.getNationalIndexCached).toHaveBeenCalledTimes(1);
    expect(mocks.getNationalIndex).not.toHaveBeenCalled();
    // The national fallback carries the snapshot's stamp: cache time, run and method (#1924).
    expect(result.stamp).toMatchObject({ dataset: "fee_index_cache", mode: "cached", runId: 9001, readAt: "2026-10-17T02:00:00.000Z" });
  });

  it("stamps the live national index when unapproved rows are asked for", async () => {
    mocks.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => []));
    mocks.getNationalIndex.mockResolvedValue(usable(9));

    const result = await resolveHamiltonPeerIndex({ selectedInstitution: institution, approvedOnly: false });

    expect(result.source).toBe("national");
    expect(mocks.getNationalIndex).toHaveBeenCalledWith(false);
    expect(result.stamp).toMatchObject({ dataset: "published_fee_catalog", mode: "live" });
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
      expect(result.stamp.id).toBe(`live:${JSON.stringify({ institutionIds: [11, 12, 13, 14, 15] })}`);
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
