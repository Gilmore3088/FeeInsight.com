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
  membership: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/email/workspace-invite", () => ({ sendWorkspaceInviteEmail: vi.fn() }));
vi.mock("@/lib/hamilton/institution-context", () => ({ getHamiltonInstitutionContext: vi.fn() }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ setHamiltonWorkspaceContext: vi.fn() }));
vi.mock("@/lib/hamilton/adopt-institution", () => ({ adoptInstitution: vi.fn() }));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.membership,
  createInstitutionWorkspaceInvitation: vi.fn(),
  grantInstitutionWorkspaceMembership: vi.fn(),
  revokeInstitutionWorkspaceInvitation: vi.fn(),
  revokeInstitutionWorkspaceMembership: vi.fn(),
}));
vi.mock("@/lib/data-store/saved-peers", () => mocks.savedPeers);
vi.mock("@/lib/data-store/fee-index", () => ({ getPeerGroupCounts: mocks.getPeerGroupCounts }));

import { createPeerSet, editPeerSet, setPeerSetForAllCharts } from "./actions";

const pro = { id: 7, role: "premium", subscription_status: "active" };

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("peer group actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUser.mockResolvedValue(pro);
    mocks.savedPeers.getSavedPeerSets.mockResolvedValue([]);
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue(null);
    mocks.membership.mockResolvedValue(null);
    mocks.savedPeers.savePeerSet.mockResolvedValue(3);
    mocks.savedPeers.getPeerInstitutionNames.mockResolvedValue(new Map());
    mocks.getPeerGroupCounts.mockResolvedValue([{ institutions: 12, publishing: 9 }]);
  });

  it("saves chosen institutions without the filters, in the user's workspace", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "owner" });
    const result = await createPeerSet(
      form([
        ["name", " Rivals "],
        ["mode", "institutions"],
        ["charter_type", "bank"],
        ["institution_ids", "11"],
        ["institution_ids", "12"],
        ["institution_ids", "11"],
      ]),
    );
    expect(result.success).toBe(true);
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith("Rivals", { institution_ids: [11, 12] }, "7", 2945);
  });

  it("refuses more than 50 chosen institutions", async () => {
    const entries: [string, string][] = [["name", "Too many"], ["mode", "institutions"]];
    for (let i = 1; i <= 51; i++) entries.push(["institution_ids", String(i)]);
    const result = await createPeerSet(form(entries));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("50") });
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
  });

  it("needs at least one institution when choosing by name", async () => {
    const result = await createPeerSet(form([["name", "Empty"], ["mode", "institutions"]]));
    expect(result).toMatchObject({ success: false, error: "Choose at least one institution." });
  });

  it("saves states and the real asset tiers, and rejects unknown states", async () => {
    const ok = await createPeerSet(
      form([
        ["name", "Southeast"],
        ["charter_type", "credit_union"],
        ["states", "ga"],
        ["states", "FL"],
        ["asset_tiers", "community_mid"],
        ["fed_districts", "6"],
      ]),
    );
    expect(ok.success).toBe(true);
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith(
      "Southeast",
      { charter_type: "credit_union", asset_tiers: ["community_mid"], fed_districts: [6], states: ["GA", "FL"] },
      "7",
      null,
    );

    const badState = await createPeerSet(form([["name", "X"], ["states", "ZZ"]]));
    expect(badState.success).toBe(false);
    const badTier = await createPeerSet(form([["name", "X"], ["asset_tiers", "c"]]));
    expect(badTier.success).toBe(false);
  });

  it("returns the saved set with its real peer count", async () => {
    const saved = { id: 3, name: "Southeast", institution_ids: null, states: ["GA"], tiers: null, districts: null, charter_type: null };
    mocks.savedPeers.getSavedPeerSets.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    const result = await createPeerSet(form([["name", "Southeast"], ["states", "GA"]]));
    expect(mocks.getPeerGroupCounts).toHaveBeenCalledWith([{ states: ["GA"] }], null);
    expect(result).toMatchObject({ success: true, id: 3, count: { institutions: 12, publishing: 9 } });
  });

  it("caps peer groups at ten per workspace", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "admin" });
    mocks.savedPeers.getSavedPeerSets.mockResolvedValue(
      Array.from({ length: 10 }, (_, id) => ({ id, institution_id: 2945 })),
    );
    const result = await createPeerSet(form([["name", "Eleventh"]]));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("up to 10") });
  });

  it("does not let a team viewer add a group", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "viewer" });
    const result = await createPeerSet(form([["name", "Mine"]]));
    expect(result.success).toBe(false);
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
  });

  it("renames and edits a set the user may change", async () => {
    mocks.savedPeers.updatePeerSet.mockResolvedValue(true);
    const result = await editPeerSet(4, form([["name", "Renamed"], ["charter_type", "bank"]]));
    expect(result.success).toBe(true);
    expect(mocks.savedPeers.updatePeerSet).toHaveBeenCalledWith(
      4,
      "Renamed",
      { charter_type: "bank", asset_tiers: [], fed_districts: [], states: [] },
      "7",
    );

    mocks.savedPeers.updatePeerSet.mockResolvedValue(false);
    expect(await editPeerSet(4, form([["name", "Renamed"]]))).toMatchObject({ success: false });
    expect(await editPeerSet(0, form([["name", "Renamed"]]))).toMatchObject({ success: false });
  });

  it("sets the chart default, clearing the team default for a personal pick", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "owner" });
    mocks.savedPeers.setDefaultPeerSet.mockResolvedValueOnce({ institutionId: null }).mockResolvedValue({ institutionId: 2945 });
    expect(await setPeerSetForAllCharts(8)).toMatchObject({ success: true });
    expect(mocks.savedPeers.setDefaultPeerSet).toHaveBeenNthCalledWith(1, { id: 8, userId: "7", institutionId: null });
    expect(mocks.savedPeers.setDefaultPeerSet).toHaveBeenNthCalledWith(2, { id: null, userId: "7", institutionId: 2945 });
  });

  it("goes back to automatic peers and reports a set the user can't change", async () => {
    mocks.savedPeers.setDefaultPeerSet.mockResolvedValue({ institutionId: null });
    expect(await setPeerSetForAllCharts(null)).toMatchObject({ success: true });
    expect(mocks.savedPeers.setDefaultPeerSet).toHaveBeenCalledWith({ id: null, userId: "7", institutionId: null });

    mocks.savedPeers.setDefaultPeerSet.mockResolvedValue(null);
    expect(await setPeerSetForAllCharts(9)).toMatchObject({ success: false });
    expect(await setPeerSetForAllCharts(-1)).toMatchObject({ success: false });
  });

  it("refuses users without an active subscription", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 9, role: "viewer", subscription_status: "canceled" });
    expect(await editPeerSet(1, form([["name", "X"]]))).toMatchObject({ success: false });
    expect(await setPeerSetForAllCharts(1)).toMatchObject({ success: false });
  });

  it("generates a name from Florida and asset criteria with no district", async () => {
    const result = await createPeerSet(form([["states", "FL"], ["asset_tiers", "community_large"]]));
    expect(result.success).toBe(true);
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith(
      "Florida · $1B to $10B · Institutions",
      { charter_type: undefined, asset_tiers: ["community_large"], fed_districts: [], states: ["FL"] }, "7", null,
    );
    expect(await createPeerSet(form([["mode", "institutions"], ["institution_ids", "11"], ["institution_ids", "12"], ["institution_ids", "11"]]))).toMatchObject({ success: true });
    expect(mocks.savedPeers.savePeerSet).toHaveBeenLastCalledWith("2 selected institutions", { institution_ids: [11, 12] }, "7", null);
  });

  it("accepts Florida and an asset band without any district when named", async () => {
    const result = await createPeerSet(form([["name", "Florida research"], ["states", "FL"], ["asset_tiers", "community_large"]]));
    expect(result.success).toBe(true);
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith(
      "Florida research",
      { charter_type: undefined, asset_tiers: ["community_large"], fed_districts: [], states: ["FL"] }, "7", null,
    );
  });

  it("saves exact selected IDs personally when the research subject has no membership", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "owner" });
    const result = await createPeerSet(form([
      ["name", "Chosen Florida peers"], ["mode", "institutions"], ["research_institution_id", "8109"],
      ["institution_ids", "11"], ["institution_ids", "12"], ["institution_ids", "13"], ["created_by", "999"],
    ]));
    expect(result.success).toBe(true);
    expect(mocks.membership).toHaveBeenCalledWith({ userId: 7, institutionId: 8109 });
    expect(mocks.savedPeers.getPeerSetWorkspace).not.toHaveBeenCalled();
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith("Chosen Florida peers", { institution_ids: [11, 12, 13] }, "7", null);
  });

  it("shares a researched subject's group only through fresh active membership", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 2945, role: "owner" });
    mocks.membership.mockResolvedValue({ institutionId: 8109, userId: 7, role: "analyst", status: "active" });
    expect(await createPeerSet(form([
      ["name", "Selected research peers"], ["mode", "institutions"], ["research_institution_id", "8109"], ["institution_ids", "11"],
    ]))).toMatchObject({ success: true });
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith("Selected research peers", { institution_ids: [11] }, "7", 8109);
    expect(mocks.savedPeers.getPeerSetWorkspace).not.toHaveBeenCalled();
    expect(mocks.savedPeers.setDefaultPeerSet).not.toHaveBeenCalled();
  });

  it("keeps research membership permissions and group caps in force", async () => {
    const selected = () => form([["mode", "institutions"], ["research_institution_id", "8109"], ["institution_ids", "11"]]);
    mocks.membership.mockResolvedValue({ institutionId: 8109, userId: 7, role: "viewer", status: "active" });
    expect(await createPeerSet(selected())).toMatchObject({ success: false, error: expect.stringContaining("Viewers") });
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
    mocks.membership.mockResolvedValue({ institutionId: 8109, userId: 7, role: "admin", status: "active" });
    mocks.savedPeers.getSavedPeerSets.mockResolvedValue(Array.from({ length: 10 }, (_, id) => ({ id, institution_id: 8109 })));
    expect(await createPeerSet(selected())).toMatchObject({ success: false, error: expect.stringContaining("up to 10") });
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid research ID or unavailable membership lookup", async () => {
    for (const subject of ["001", "8109junk", "9007199254740992"]) {
      expect(await createPeerSet(form([["research_institution_id", subject]]))).toMatchObject({ success: false, error: "Enter a valid research institution ID." });
    }
    expect(mocks.membership).not.toHaveBeenCalled();
    mocks.membership.mockRejectedValue(new Error("membership lookup unavailable"));
    expect(await createPeerSet(form([["research_institution_id", "8109"]]))).toMatchObject({ success: false, error: expect.stringContaining("Could not verify access") });
    expect(mocks.savedPeers.getPeerSetWorkspace).not.toHaveBeenCalled();
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
  });

  it("requires the authenticated premium user for a selected list", async () => {
    const selected = () => form([["mode", "institutions"], ["research_institution_id", "8109"], ["institution_ids", "11"], ["created_by", "7"]]);
    mocks.getCurrentUser.mockResolvedValue(null);
    expect(await createPeerSet(selected())).toMatchObject({ success: false, error: "Not authenticated" });
    mocks.getCurrentUser.mockResolvedValue({ id: 9, role: "viewer", subscription_status: "canceled" });
    expect(await createPeerSet(selected())).toMatchObject({ success: false, error: expect.stringContaining("subscription") });
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.savedPeers.savePeerSet).not.toHaveBeenCalled();
  });

  it("lets user 25 save Addition research personally while preserving Space Coast Viewer restrictions", async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...pro, id: 25 });
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 8109, role: "viewer" });
    mocks.membership.mockResolvedValue(null);
    const chosen = (subject: string) => form([
      ["name", "Three Florida institutions"], ["mode", "institutions"], ["research_institution_id", subject],
      ["institution_ids", "11"], ["institution_ids", "12"], ["institution_ids", "13"],
    ]);
    expect(await createPeerSet(chosen("8629"))).toMatchObject({ success: true });
    expect(mocks.membership).toHaveBeenCalledWith({ userId: 25, institutionId: 8629 });
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith("Three Florida institutions", { institution_ids: [11, 12, 13] }, "25", null);
    expect(mocks.savedPeers.getPeerSetWorkspace).not.toHaveBeenCalled();

    mocks.membership.mockResolvedValue({ institutionId: 8109, userId: 25, role: "viewer", status: "active" });
    expect(await createPeerSet(chosen("8109"))).toMatchObject({ success: false, error: "Viewers can use the team's peer groups but not add them." });
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledTimes(1);
    mocks.savedPeers.updatePeerSet.mockResolvedValue(false);
    expect(await editPeerSet(900, chosen("8109"))).toMatchObject({ success: false, error: "Peer group not found, or you can't change it." });
    expect(mocks.savedPeers.updatePeerSet).toHaveBeenCalledWith(900, "Three Florida institutions", { institution_ids: [11, 12, 13] }, "25");
    expect(mocks.savedPeers.setDefaultPeerSet).not.toHaveBeenCalled();
  });

  it("keeps an explicitly unselected subject personal instead of consulting stored A", async () => {
    mocks.savedPeers.getPeerSetWorkspace.mockResolvedValue({ institutionId: 8109, role: "viewer" });
    expect(await createPeerSet(form([["name", "Personal research"], ["research_institution_id", ""]]))).toMatchObject({ success: true });
    expect(mocks.savedPeers.savePeerSet).toHaveBeenCalledWith("Personal research", { charter_type: undefined, asset_tiers: [], fed_districts: [], states: [] }, "7", null);
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.savedPeers.getPeerSetWorkspace).not.toHaveBeenCalled();
  });
});
