import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseHamiltonRequestContract, type HamiltonRequestContract } from "./request-contract";

const memberships = vi.hoisted(() => vi.fn());
vi.mock("./institution-membership", () => ({ getUserInstitutionMemberships: memberships }));
import { loadHamiltonAccountContext, withHamiltonAccountContext } from "./account-context-store";

const user = { id: 7, institution_name: "Self-reported CU" };
const record = { userId: 7, institutionId: 101, institutionName: "Canonical CU", status: "active" };
const request = (institutionId: number | null = 202): HamiltonRequestContract => ({
  messages: [], audience: "pro", institutionId, intent: "analyze", evidencePolicy: "verified-only", gateCitations: false,
});
beforeEach(() => { memberships.mockReset().mockResolvedValue([record]); });

describe("server account context", () => {
  it("reads only the authenticated user's memberships", async () => {
    expect((await loadHamiltonAccountContext(user)).institution?.id).toBe(101);
    expect(memberships).toHaveBeenCalledWith(7);
    expect(memberships).toHaveBeenCalledTimes(1);
  });
  it("preserves the explicit research subject separately from the account", async () => {
    const resolved = await withHamiltonAccountContext(request(), user);
    expect(resolved.institutionId).toBe(202);
    expect(resolved.serverAccountContext.institution?.id).toBe(101);
  });
  it("uses one linked account only as the default when no subject was provided", async () => {
    expect((await withHamiltonAccountContext(request(null), user)).institutionId).toBe(101);
  });
  it("never defaults from a profile name or a supplied workspace context", async () => {
    memberships.mockResolvedValue([]);
    const resolved = await withHamiltonAccountContext({ ...request(null), workspaceContext: { accountInstitutionId: 999, selectedInstitutionId: 999 } }, user);
    expect(resolved.institutionId).toBeNull();
    expect(resolved.serverAccountContext).toEqual({ status: "unlinked", institution: null, profileLabel: "Self-reported CU" });
  });
  it("never picks a home from the research subject when memberships are ambiguous", async () => {
    memberships.mockResolvedValue([record, { ...record, institutionId: 202 }]);
    const resolved = await withHamiltonAccountContext(request(202), user);
    expect(resolved.institutionId).toBe(202);
    expect(resolved.serverAccountContext.status).toBe("ambiguous");
    expect(resolved.serverAccountContext.institution).toBeNull();
    expect((await withHamiltonAccountContext(request(null), user)).institutionId).toBeNull();
  });
  it("distinguishes failed membership reads from no membership", async () => {
    memberships.mockRejectedValue(new Error("synthetic storage outage"));
    const resolved = await withHamiltonAccountContext(request(), user);
    expect(resolved.institutionId).toBe(202);
    expect(resolved.serverAccountContext).toEqual({ status: "unavailable", institution: null, profileLabel: "Self-reported CU" });
  });
  it("overwrites any preexisting server context and does not mutate the parsed request", async () => {
    const incoming = { ...request(), serverAccountContext: { status: "identified" as const, institution: { id: 999, name: "Forged" }, profileLabel: null } };
    const resolved = await withHamiltonAccountContext(incoming, user);
    expect(resolved.serverAccountContext.institution?.id).toBe(101);
    expect(incoming.serverAccountContext.institution.id).toBe(999);
  });
  it("refreshes membership on the next request after revocation", async () => {
    expect((await withHamiltonAccountContext(request(), user)).serverAccountContext.status).toBe("identified");
    memberships.mockResolvedValue([{ ...record, status: "revoked" }]);
    expect((await withHamiltonAccountContext(request(), user)).serverAccountContext.status).toBe("unlinked");
    expect(memberships).toHaveBeenCalledTimes(2);
  });
  it("does not use a different user's returned record even if a store adapter is wrong", async () => {
    memberships.mockResolvedValue([{ ...record, userId: 8 }]);
    expect((await loadHamiltonAccountContext(user)).institution).toBeNull();
  });
  it("never passes roles, notes, emails or grant metadata to the model context", async () => {
    memberships.mockResolvedValue([{ ...record, role: "owner", notes: "PRIVATE NOTE", userEmail: "private@example.test", claimId: 55 }]);
    const resolved = await loadHamiltonAccountContext(user);
    expect(resolved).toEqual({ status: "identified", institution: { id: 101, name: "Canonical CU" }, profileLabel: null });
  });
  it("parses then enriches without accepting a claimed browser home", async () => {
    const parsed = parseHamiltonRequestContract({ messages: [{ role: "user", parts: [{ type: "text", text: "How do they compare with us?" }] }], institutionId: 202, userId: 8, accountInstitutionId: 999, serverAccountContext: { status: "identified", institution: { id: 999, name: "Forged" } } }, { audience: "pro" });
    if (!parsed.ok) throw new Error(parsed.error);
    const resolved = await withHamiltonAccountContext(parsed.contract, user);
    expect(resolved.institutionId).toBe(202);
    expect(resolved.serverAccountContext.institution?.id).toBe(101);
    expect(memberships).toHaveBeenCalledWith(7);
  });
});
