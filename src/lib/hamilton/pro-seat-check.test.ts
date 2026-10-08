import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sql: vi.fn(),
  getSavedPeerSets: vi.fn(),
  savePeerSet: vi.fn(),
  setDefaultPeerSet: vi.fn(),
  getDefaultPeerSets: vi.fn(),
  getMembership: vi.fn(),
  grant: vi.fn(),
  invite: vi.fn(),
  seatUsage: vi.fn(),
  accept: vi.fn(),
  configured: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: m.sql }));
vi.mock("@/lib/data-store/saved-peers", () => ({
  getSavedPeerSets: m.getSavedPeerSets,
  savePeerSet: m.savePeerSet,
  setDefaultPeerSet: m.setDefaultPeerSet,
  getDefaultPeerSets: m.getDefaultPeerSets,
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: m.getMembership,
  grantInstitutionWorkspaceMembership: m.grant,
  createInstitutionWorkspaceInvitation: m.invite,
  getInstitutionWorkspaceSeatUsage: m.seatUsage,
}));
vi.mock("@/lib/hamilton/workspace-invite-link", () => ({
  acceptSignedWorkspaceInvite: m.accept,
  inviteLinksConfigured: m.configured,
  buildWorkspaceInvitePath: (i: { invitationId: number }) => `/workspace-invite?i=${i.invitationId}&t=sig`,
  signWorkspaceInviteToken: () => "sig",
  verifyWorkspaceInviteToken: (i: { institutionId: number }) => i.institutionId === 6561,
}));
vi.mock("@/lib/hamilton/peer-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hamilton/peer-index")>();
  return { pickActivePeerSet: actual.pickActivePeerSet, resolveHamiltonPeerIndex: m.resolve };
});

import { runProSeatCheck, SEAT_CHECK, summarizeProSeatCheck } from "./pro-seat-check";

const owner = { id: 18, email: SEAT_CHECK.ownerEmail, username: SEAT_CHECK.ownerEmail, role: "premium" };
const teammate = { id: 21, email: SEAT_CHECK.teammateEmail, username: SEAT_CHECK.teammateEmail, role: "viewer" };

function teamSet(isDefault: boolean) {
  return {
    id: 7, name: SEAT_CHECK.peerSetName, tiers: null, districts: null, charter_type: "credit_union",
    created_by: "18", created_at: "", institution_ids: null, states: ["OH"], institution_id: 6561, is_default: isDefault,
  };
}

function sqlText(call: unknown[]): string {
  return (call[0] as string[]).join("?");
}

beforeEach(() => {
  vi.clearAllMocks();
  let teammateHasSeat = false;
  m.sql.mockImplementation(async (strings: string[], ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM users")) return values[0] === teammate.email ? [teammate] : [owner];
    if (text.includes("hamilton_workspace_contexts")) return [{ selected_institution_id: 6561 }];
    return [];
  });
  m.configured.mockReturnValue(true);
  m.getMembership.mockImplementation(async ({ userId }: { userId: number }) =>
    userId === teammate.id && teammateHasSeat ? { id: 2 } : null,
  );
  m.grant.mockResolvedValue({ id: 1 });
  m.invite.mockResolvedValue({ id: 91, email: teammate.email });
  m.accept.mockImplementation(async () => {
    teammateHasSeat = true;
    return { status: "accepted" };
  });
  m.getSavedPeerSets.mockResolvedValue([]);
  m.savePeerSet.mockResolvedValue(7);
  m.setDefaultPeerSet.mockResolvedValue({ institutionId: 6561 });
  m.getDefaultPeerSets.mockResolvedValue([teamSet(true)]);
  m.seatUsage.mockResolvedValue({ used: 2, emailHoldsSeat: true });
  m.resolve.mockResolvedValue({
    entries: new Array(12).fill({}), label: SEAT_CHECK.peerSetName, source: "saved-peer-set",
    filters: {}, peerSetId: "7", fallbackReason: null,
  });
});

describe("runProSeatCheck", () => {
  it("grants the owner's seat, accepts a signed invite, saves the team group and sees Hamilton follow it", async () => {
    const result = await runProSeatCheck();

    expect(m.grant).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 6561, userId: 18, role: "owner", source: "manual_admin" }));
    expect(m.invite).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 6561, email: teammate.email, role: "analyst", invitedByUserId: 18 }));
    expect(m.accept).toHaveBeenCalledWith({ invitationId: 91, token: "sig", user: { id: 21, email: teammate.email, username: teammate.email } });
    expect(m.savePeerSet).toHaveBeenCalledWith(SEAT_CHECK.peerSetName, { charter_type: "credit_union", states: ["OH"] }, "18", 6561);
    expect(m.setDefaultPeerSet).toHaveBeenCalledWith({ id: 7, userId: "18", institutionId: 6561 });
    expect(m.resolve).toHaveBeenCalledWith({ userId: 18, institutionId: 6561 });
    expect(m.resolve).toHaveBeenCalledWith({ userId: 21, institutionId: 6561 });

    expect(result.passed).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.teammate).toMatchObject({ invitationId: 91, accept: "accepted", seat: true, savedBank: 6561, tamperedLinkRefused: true });
    expect(result.peerSet).toEqual({ id: 7, created: true, isDefault: true });
    expect(result.hamilton.teammate).toMatchObject({ follows: true, label: SEAT_CHECK.peerSetName });
    expect(summarizeProSeatCheck(result)).toContain("Team seats and peer groups work");
  });

  it("reuses the seats and group a previous run made", async () => {
    m.getMembership.mockResolvedValue({ id: 1 });
    m.getSavedPeerSets.mockResolvedValue([teamSet(true)]);

    const result = await runProSeatCheck();

    expect(m.grant).not.toHaveBeenCalled();
    expect(m.invite).not.toHaveBeenCalled();
    expect(m.savePeerSet).not.toHaveBeenCalled();
    expect(result.owner.seat).toBe("existing");
    expect(result.teammate.accept).toBe("already_member");
    expect(result.peerSet).toEqual({ id: 7, created: false, isDefault: true });
    expect(result.passed).toBe(true);
  });

  it("fails when Hamilton shows another group to the teammate", async () => {
    m.resolve.mockImplementation(async ({ userId }: { userId: number }) => ({
      entries: [], label: userId === 21 ? "Ohio peers" : SEAT_CHECK.peerSetName,
      source: userId === 21 ? "selected-institution-default" : "saved-peer-set",
      filters: {}, peerSetId: userId === 21 ? null : "7", fallbackReason: null,
    }));

    const result = await runProSeatCheck();

    expect(result.passed).toBe(false);
    expect(result.problems).toEqual(['Hamilton shows "Ohio peers" to the teammate, not the team\'s group.']);
  });

  it("writes nothing in a dry run", async () => {
    m.getDefaultPeerSets.mockResolvedValue([]);

    const result = await runProSeatCheck({ dryRun: true });

    expect(m.grant).not.toHaveBeenCalled();
    expect(m.invite).not.toHaveBeenCalled();
    expect(m.accept).not.toHaveBeenCalled();
    expect(m.savePeerSet).not.toHaveBeenCalled();
    expect(m.setDefaultPeerSet).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
    expect(result.owner.seat).toBe("missing");
  });

  it("refuses to run on an admin account", async () => {
    m.sql.mockImplementation(async (strings: string[]) =>
      strings.join("?").includes("FROM users") ? [{ ...owner, role: "admin" }] : [],
    );

    await expect(runProSeatCheck()).rejects.toThrow("admin account");
    expect(m.grant).not.toHaveBeenCalled();
    expect(m.sql.mock.calls.every((call) => !sqlText(call).includes("INSERT"))).toBe(true);
  });
});
