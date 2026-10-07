import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDefaultPeerSets: vi.fn(), getSavedPeerSetById: vi.fn() }));

vi.mock("@/lib/data-store/saved-peers", () => mocks);
vi.mock("@/lib/data-store/fee-index", () => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
}));

import { getActivePeerSet, peerSetCandidate, pickActivePeerSet } from "./active-peer-set";
import { describePeerFilters } from "./peer-index";
import type { SavedPeerSet } from "@/lib/data-store/saved-peers";

function set(overrides: Partial<SavedPeerSet>): SavedPeerSet {
  return {
    id: 1,
    name: "Set",
    tiers: null,
    districts: null,
    charter_type: null,
    created_by: "7",
    created_at: "2026-10-07T00:00:00Z",
    institution_ids: null,
    states: null,
    institution_id: null,
    is_default: true,
    ...overrides,
  };
}

const team = set({ id: 10, name: "Team peers", institution_id: 2945, institution_ids: [11, 12, 13] });
const personal = set({ id: 20, name: "My peers", charter_type: "bank", states: ["GA", "FL"], tiers: "community_mid" });

describe("pickActivePeerSet", () => {
  it("prefers the workspace default over the user's own", () => {
    expect(pickActivePeerSet([personal, team], 2945)?.id).toBe(10);
  });

  it("uses the user's own default when the workspace has none", () => {
    expect(pickActivePeerSet([personal], 2945)?.id).toBe(20);
  });

  it("ignores another workspace's default", () => {
    const other = set({ id: 30, institution_id: 77 });
    expect(pickActivePeerSet([other], 2945)).toBeNull();
    expect(pickActivePeerSet([other, personal], 2945)?.id).toBe(20);
  });

  it("ignores sets that are not the default", () => {
    expect(pickActivePeerSet([set({ id: 40, is_default: false })], null)).toBeNull();
  });

  it("parses the set's filters, chosen institutions and states", () => {
    expect(pickActivePeerSet([team], 2945)).toEqual({
      id: 10,
      name: "Team peers",
      label: "Team peers",
      filters: { institutionIds: [11, 12, 13] },
    });
    expect(pickActivePeerSet([personal], null)?.filters).toEqual({
      charter_type: "bank",
      asset_tiers: ["community_mid"],
      states: ["GA", "FL"],
    });
  });
});

describe("getActivePeerSet", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads the defaults for the user and workspace and applies the precedence", async () => {
    mocks.getDefaultPeerSets.mockResolvedValue([personal, team]);
    const active = await getActivePeerSet({ userId: 7, institutionId: 2945 });
    expect(mocks.getDefaultPeerSets).toHaveBeenCalledWith({ userId: "7", institutionId: 2945 });
    expect(active?.id).toBe(10);
  });

  it("returns null without a user, so a workspace's choice never shows outside it", async () => {
    expect(await getActivePeerSet({ userId: null, institutionId: 2945 })).toBeNull();
    expect(mocks.getDefaultPeerSets).not.toHaveBeenCalled();
  });

  it("falls back to the personal default when no institution is given", async () => {
    mocks.getDefaultPeerSets.mockResolvedValue([personal]);
    const active = await getActivePeerSet({ userId: "7", institutionId: null });
    expect(mocks.getDefaultPeerSets).toHaveBeenCalledWith({ userId: "7", institutionId: null });
    expect(active?.label).toBe("My peers");
  });
});

describe("peerSetCandidate", () => {
  it("carries the set's name so chart labels use it", () => {
    const active = pickActivePeerSet([team], 2945)!;
    const candidate = peerSetCandidate(active);
    expect(candidate).toEqual({ institutionIds: [11, 12, 13], label: "Team peers" });
    expect(describePeerFilters(candidate)).toBe("Team peers");
  });

  it("describes an unnamed chosen group by its size", () => {
    expect(describePeerFilters({ institutionIds: [1, 2] })).toBe("2 chosen institutions");
  });
});
