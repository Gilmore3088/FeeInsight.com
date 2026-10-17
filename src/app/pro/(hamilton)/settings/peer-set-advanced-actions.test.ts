import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  savedPeers: {
    getSavedPeerSets: vi.fn(),
    savePeerSet: vi.fn(),
    deletePeerSet: vi.fn(),
    updatePeerSet: vi.fn(),
    setDefaultPeerSet: vi.fn(),
    getPeerSetWorkspace: vi.fn(),
    getPeerInstitutionNames: vi.fn(),
  },
  getPeerGroupCounts: vi.fn(),
  markets: { getMarketInstitutionIds: vi.fn(), getHomeMarket: vi.fn() },
  sql: Object.assign(vi.fn(async () => []), { unsafe: vi.fn() }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql, withTransaction: vi.fn() }));
vi.mock("@/lib/email/workspace-invite", () => ({ sendWorkspaceInviteEmail: vi.fn() }));
vi.mock("@/lib/hamilton/institution-context", () => ({ getHamiltonInstitutionContext: vi.fn() }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ setHamiltonWorkspaceContext: vi.fn() }));
vi.mock("@/lib/hamilton/adopt-institution", () => ({ adoptInstitution: vi.fn() }));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: vi.fn(),
  createInstitutionWorkspaceInvitation: vi.fn(),
  grantInstitutionWorkspaceMembership: vi.fn(),
  revokeInstitutionWorkspaceInvitation: vi.fn(),
  revokeInstitutionWorkspaceMembership: vi.fn(),
}));
vi.mock("@/lib/data-store/saved-peers", () => mocks.savedPeers);
vi.mock("@/lib/data-store/fee-index", () => ({
  getPeerGroupCounts: mocks.getPeerGroupCounts,
  peerInstitutionIds: (f: { institutionIds?: number[] }) => (f.institutionIds?.length ? f.institutionIds : null),
}));
vi.mock("@/lib/data-store/peer-markets", () => mocks.markets);

import { createPeerSet, editPeerSet } from "./actions";

const pro = { id: 7, role: "premium", subscription_status: "active" };
const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};
const savedAdvanced = (call = 0) => mocks.savedPeers.savePeerSet.mock.calls[call];

describe("peer groups on the wider dimensions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sql.mockImplementation(async () => []);
    mocks.getCurrentUser.mockResolvedValue(pro);
    mocks.savedPeers.getSavedPeerSets.mockResolvedValue([]);
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue(null);
    mocks.savedPeers.savePeerSet.mockResolvedValue(3);
    mocks.savedPeers.getPeerInstitutionNames.mockResolvedValue(new Map());
    mocks.getPeerGroupCounts.mockResolvedValue([{ institutions: 2, publishing: 2 }]);
    mocks.markets.getMarketInstitutionIds.mockResolvedValue({ market: { code: 45220, name: "Tallahassee, FL" }, ids: new Set([323, 5, 21]) });
  });

  it("saves every new dimension in dollars and names an unnamed group in plain words", async () => {
    const result = await createPeerSet(form([
      ["name", ""],
      ["charter_type", "bank"],
      ["states", "FL"],
      ["asset_min_m", "500"],
      ["asset_max_m", "2,000"],
      ["regulators", "occ"],
      ["regulators", "fdic"],
      ["holding_company_rssd", "1234"],
      ["market_code", "45220"],
      ["nearest", "10"],
    ]));
    expect(result.success).toBe(true);
    const [name, filters] = savedAdvanced();
    expect(filters).toEqual({
      charter_type: "bank", asset_tiers: [], fed_districts: [], states: ["FL"],
      advanced: {
        asset_min: 500_000_000, asset_max: 2_000_000_000, regulators: ["occ", "fdic"],
        holding_company_rssd: "1234", market_code: 45220, nearest: 10,
      },
    });
    expect(name).toBe("The 10 banks closest in assets with $500M to $2B in assets regulated by OCC or FDIC in the same...");
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it("names a short unnamed group in full", async () => {
    await createPeerSet(form([["name", ""], ["market_code", "45220"]]));
    expect(savedAdvanced()[0]).toBe("Institutions with branches in the Tallahassee, FL metro");
  });

  it("keeps a typed name and saves a credit union charter", async () => {
    await createPeerSet(form([["name", "Federal CUs"], ["charter_type", "credit_union"], ["cu_charter", "federal"]]));
    expect(savedAdvanced()[0]).toBe("Federal CUs");
    expect(savedAdvanced()[1].advanced).toEqual({ cu_charter: "federal" });
  });

  it("keeps a basic group exactly as before, with no wider dimensions", async () => {
    await createPeerSet(form([["name", "Southeast"], ["states", "GA"], ["asset_min_m", ""], ["nearest", ""], ["market_code", ""]]));
    expect(savedAdvanced()).toEqual(["Southeast", { charter_type: undefined, asset_tiers: [], fed_districts: [], states: ["GA"] }, "7", null]);
    expect(mocks.markets.getMarketInstitutionIds).not.toHaveBeenCalled();
  });

  for (const [why, entries, message, field] of [
    ["min above max", [["asset_min_m", "900"], ["asset_max_m", "100"]], "The lowest total assets can't be more than the highest.", "assets"],
    ["negative assets", [["asset_min_m", "-1"]], "negative", "assets"],
    ["letters for assets", [["asset_max_m", "lots"]], "Enter total assets as a number, in $ millions (for example 500).", "assets"],
    ["nearest of 0", [["nearest", "0"]], "1 to 100", "nearest"],
    ["nearest over the cap", [["nearest", "101"]], "1 to 100", "nearest"],
    ["nearest not whole", [["nearest", "2.5"]], "1 to 100", "nearest"],
    ["nearest as letters", [["nearest", "ten"]], "1 to 100", "nearest"],
    ["unknown regulator", [["regulators", "cfpb"]], "Choose regulators", "regulators"],
    ["unknown CU charter", [["cu_charter", "national"]], "Choose federal or state", "cu_charter"],
    ["CU charter on banks", [["charter_type", "bank"], ["cu_charter", "state"]], 'Credit union charter works only for credit union groups. Choose "Credit unions only", or set charter to "Banks and credit unions".', "cu_charter"],
    ["NCUA on banks", [["charter_type", "bank"], ["regulators", "ncua"]], "NCUA", "regulators"],
    ["bad holding company", [["holding_company_rssd", "abc"]], "Clear the holding company box and save again.", "holding_company_rssd"],
  ] as [string, [string, string][], string, string][]) {
    it(`refuses ${why}`, async () => {
      const result = await createPeerSet(form([["name", "X"], ...entries]));
      expect(result.success).toBe(false);
      expect(result.error).toContain(message);
      expect(result.field).toBe(field);
      expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
    });
  }

  it("refuses a metro the branch records don't have", async () => {
    mocks.markets.getMarketInstitutionIds.mockResolvedValue(null);
    const result = await createPeerSet(form([["name", "X"], ["market_code", "99999"]]));
    expect(result).toMatchObject({ success: false, error: "Choose a metro market from the list.", field: "market_code" });
  });

  it("does not keep wider dimensions with hand-picked institutions", async () => {
    await createPeerSet(form([["name", "Rivals"], ["mode", "institutions"], ["institution_ids", "5"], ["nearest", "3"]]));
    expect(savedAdvanced()[1]).toEqual({ institution_ids: [5] });
  });

  it("counts a saved metro group through the same resolution charts use", async () => {
    const saved = {
      id: 3, name: "Metro", institution_ids: null, states: null, tiers: null, districts: null, charter_type: null,
      institution_id: null, advanced: { market_code: 45220 },
    };
    mocks.savedPeers.getSavedPeerSets.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    mocks.sql.unsafe.mockResolvedValue([{ id: 5 }, { id: 21 }]);
    const result = await createPeerSet(form([["name", "Metro"], ["market_code", "45220"], ["research_institution_id", "323"]]));
    expect(mocks.getPeerGroupCounts).toHaveBeenCalledWith([{ institutionIds: [5, 21] }], 323);
    expect(result).toMatchObject({ success: true, count: { institutions: 2, publishing: 2 }, note: null });
  });

  it("edits a group's wider dimensions", async () => {
    mocks.savedPeers.updatePeerSet.mockResolvedValue(true);
    await editPeerSet(4, form([["name", "Big"], ["asset_min_m", "10000"]]));
    expect(mocks.savedPeers.updatePeerSet).toHaveBeenCalledWith(
      4, "Big", { charter_type: undefined, asset_tiers: [], fed_districts: [], states: [], advanced: { asset_min: 10_000_000_000 } }, "7",
    );
  });
});
