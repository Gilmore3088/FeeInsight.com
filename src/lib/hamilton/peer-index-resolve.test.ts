import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
}));

vi.mock("@/lib/data-store/fee-index", () => mocks);
vi.mock("@/lib/data-store/saved-peers", () => ({ getSavedPeerSetById: vi.fn() }));

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
});
