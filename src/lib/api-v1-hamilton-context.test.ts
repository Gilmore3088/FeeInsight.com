import { beforeEach, describe, expect, it, vi } from "vitest";
import type { V1Caller } from "./api-v1-auth";
import { getV1HamiltonContext, getV1HamiltonInstitution, getV1SavedPeerSet, requireV1ContextUserId, v1ContextUserId } from "./api-v1-hamilton-context";
import type { SavedPeerSet } from "./data-store/saved-peers";

const mocks = vi.hoisted(() => ({ institution: vi.fn(), workspace: vi.fn(), account: vi.fn(), sets: vi.fn(), byId: vi.fn(), active: vi.fn() }));
vi.mock("@/lib/data-store/core", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ getHamiltonWorkspaceContext: mocks.workspace }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("@/lib/data-store/saved-peers", () => ({ getSavedPeerSets: mocks.sets, getSavedPeerSetById: mocks.byId }));
vi.mock("@/lib/hamilton/peer-index", async (original) => ({ ...await original<typeof import("./hamilton/peer-index")>(), getActivePeerSet: mocks.active }));

const set: SavedPeerSet = {
  id: 50, name: "My five peers", created_by: "12", created_at: "2026-10-19", tiers: null, districts: null,
  charter_type: null, states: null, institution_ids: [1, 2, 3, 4, 5], institution_id: null, is_default: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ selectedInstitutionId: 20, selectedSource: "manual" });
  mocks.institution.mockResolvedValue({ id: 20, institution_name: "Research Bank" });
  mocks.account.mockResolvedValue({ status: "identified", institution: { id: 30, name: "Account Bank" } });
  mocks.sets.mockResolvedValue([set]); mocks.byId.mockResolvedValue(set); mocks.active.mockResolvedValue({ id: 50 });
});

describe("API holder identity", () => {
  it("uses the key holder rather than the browser user or billing organization", () => {
    expect(v1ContextUserId({ auth: { valid: true, subscriberUserId: 12 }, user: { id: 7 }, organizationId: 99 } as V1Caller)).toBe(12);
  });
  it("never borrows a signed-in browser user for an unmapped partner key", () => {
    const caller = { auth: { valid: true }, user: { id: 7 } } as V1Caller;
    expect(v1ContextUserId(caller)).toBeNull();
    expect(() => requireV1ContextUserId(caller)).toThrow("personal Hamilton subscriber API key");
  });
  it("uses a signed-in session when no key was validated", () => {
    expect(v1ContextUserId({ auth: { valid: false }, user: { id: 7 } } as V1Caller)).toBe(7);
  });
});

describe("read-only Hamilton API context", () => {
  it("uses the saved research institution and only serializes permitted context", async () => {
    const result = await getV1HamiltonContext(12);
    expect(mocks.workspace).toHaveBeenCalledWith(12);
    expect(mocks.sets).toHaveBeenCalledWith("12", 20);
    expect(mocks.active).toHaveBeenCalledWith({ userId: 12, institutionId: 20 });
    expect(mocks.byId).toHaveBeenCalledWith(50, "12");
    expect(result).toEqual({ institution: { id: 20, name: "Research Bank" }, institution_source: "manual", active_peer_set_id: 50,
      peer_sets: [{ id: 50, name: "My five peers", scope: "personal", workspace_institution_id: null, is_default: true, filters: { institution_ids: [1, 2, 3, 4, 5] } }] });
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("refreshes settings on the next call without a shared context cache", async () => {
    await getV1HamiltonContext(12);
    mocks.workspace.mockResolvedValue({ selectedInstitutionId: 21, selectedSource: "profile" });
    mocks.institution.mockResolvedValue({ id: 21, institution_name: "New Bank" });
    mocks.sets.mockResolvedValue([]); mocks.active.mockResolvedValue(null);
    expect(await getV1HamiltonContext(12)).toMatchObject({ institution: { id: 21 }, peer_sets: [], active_peer_set_id: null });
    expect(mocks.workspace).toHaveBeenCalledTimes(2);
  });
  it("uses current account membership only when no research selection exists", async () => {
    mocks.workspace.mockResolvedValue(null);
    expect(await getV1HamiltonInstitution(12)).toEqual({ institution: { id: 30, name: "Account Bank" }, source: "account" });
    expect(mocks.account).toHaveBeenCalledWith({ id: 12 });
  });
  it("reports no institution for an ambiguous account", async () => {
    mocks.workspace.mockResolvedValue(null); mocks.account.mockResolvedValue({ status: "ambiguous", institution: null });
    expect(await getV1HamiltonInstitution(12)).toEqual({ institution: null, source: "none" });
  });
  it.each(["workspace", "institution", "sets", "active", "byId"])("fails closed when the %s read fails", async (name) => {
    mocks[name as keyof typeof mocks].mockRejectedValue(new Error("database down"));
    await expect(getV1HamiltonContext(12)).rejects.toMatchObject({ status: 503, code: "context_unavailable" });
  });
  it("does not interpret unavailable memberships as empty settings", async () => {
    mocks.workspace.mockResolvedValue(null); mocks.account.mockResolvedValue({ status: "unavailable", institution: null });
    await expect(getV1HamiltonContext(12)).rejects.toMatchObject({ status: 503, code: "context_unavailable" });
  });
  it("uses the same refusal for missing and unauthorized saved sets", async () => {
    mocks.byId.mockResolvedValue(null);
    await expect(getV1SavedPeerSet(12, 20, 999)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(mocks.byId).toHaveBeenCalledWith(999, "12");
  });
  it("keeps all 50 saved chosen peers", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    mocks.sets.mockResolvedValue([{ ...set, institution_ids: ids }]);
    const result = await getV1HamiltonContext(12);
    expect(result.peer_sets[0].filters.institution_ids).toEqual(ids);
  });
});
