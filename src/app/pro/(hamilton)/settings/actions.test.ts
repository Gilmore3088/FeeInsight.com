import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    sqlCalls: Array<{ text: string; values: unknown[] }>;
    queuedRows: unknown[][];
  } = {
    sqlCalls: [],
    queuedRows: [],
  };

  const sqlMock = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      state.sqlCalls.push({ text: strings.join("?"), values });
      return Promise.resolve(state.queuedRows.shift() ?? []);
    }),
    { json: vi.fn((value: unknown) => ({ json: value })) },
  );

  return {
    state,
    sqlMock,
    getCurrentUserMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    getHamiltonInstitutionContextMock: vi.fn(),
    getActiveInstitutionMembershipMock: vi.fn(),
    createInstitutionWorkspaceInvitationMock: vi.fn(),
    grantInstitutionWorkspaceMembershipMock: vi.fn(),
    revokeInstitutionWorkspaceInvitationMock: vi.fn(),
    revokeInstitutionWorkspaceMembershipMock: vi.fn(),
    setHamiltonWorkspaceContextMock: vi.fn(),
    sendWorkspaceInviteEmailMock: vi.fn(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePathMock,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUserMock,
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: mocks.sqlMock,
  withTransaction: vi.fn(async (callback: (tx: typeof mocks.sqlMock) => Promise<void>) =>
    callback(mocks.sqlMock),
  ),
}));

vi.mock("@/lib/email/workspace-invite", () => ({
  sendWorkspaceInviteEmail: mocks.sendWorkspaceInviteEmailMock,
}));

vi.mock("@/lib/hamilton/institution-context", () => ({
  getHamiltonInstitutionContext: mocks.getHamiltonInstitutionContextMock,
}));

vi.mock("@/lib/hamilton/workspace-context", () => ({
  setHamiltonWorkspaceContext: mocks.setHamiltonWorkspaceContextMock,
}));

vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.getActiveInstitutionMembershipMock,
  createInstitutionWorkspaceInvitation: mocks.createInstitutionWorkspaceInvitationMock,
  grantInstitutionWorkspaceMembership: mocks.grantInstitutionWorkspaceMembershipMock,
  revokeInstitutionWorkspaceInvitation: mocks.revokeInstitutionWorkspaceInvitationMock,
  revokeInstitutionWorkspaceMembership: mocks.revokeInstitutionWorkspaceMembershipMock,
}));

vi.mock("@/lib/data-store/saved-peers", () => ({
  getSavedPeerSets: vi.fn(async () => []),
  savePeerSet: vi.fn(async () => 1),
  deletePeerSet: vi.fn(async () => undefined),
}));

function proUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: "owner",
    display_name: "Owner User",
    role: "premium",
    email: "owner@example.com",
    stripe_customer_id: "cus_123",
    subscription_status: "active",
    institution_name: "Hamilton Bank",
    institution_type: "bank",
    asset_tier: "c",
    state_code: "NY",
    fed_district: 2,
    job_role: "executive",
    interests: null,
    ...overrides,
  };
}

function form(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("Hamilton Settings workspace access actions", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows = [];
    mocks.sqlMock.mockClear();
    mocks.getCurrentUserMock.mockReset();
    mocks.revalidatePathMock.mockReset();
    mocks.getHamiltonInstitutionContextMock.mockReset();
    mocks.getActiveInstitutionMembershipMock.mockReset();
    mocks.createInstitutionWorkspaceInvitationMock.mockReset();
    mocks.grantInstitutionWorkspaceMembershipMock.mockReset();
    mocks.revokeInstitutionWorkspaceInvitationMock.mockReset();
    mocks.revokeInstitutionWorkspaceMembershipMock.mockReset();
    mocks.setHamiltonWorkspaceContextMock.mockReset();
    mocks.sendWorkspaceInviteEmailMock.mockReset();

    mocks.getCurrentUserMock.mockResolvedValue(proUser());
    mocks.getHamiltonInstitutionContextMock.mockResolvedValue({
      institution: { id: 2945, name: "Hamilton Bank" },
      error: null,
    });
    // The signed-in user (7) owns the workspace; other users have no membership.
    mocks.getActiveInstitutionMembershipMock.mockImplementation(async ({ userId }: { userId: number }) =>
      userId === 7 ? { role: "owner", institutionId: 2945, userId: 7 } : null,
    );
    mocks.sendWorkspaceInviteEmailMock.mockResolvedValue({
      status: "not_configured",
      reason: "RESEND_API_KEY is not configured.",
    });
  });

  it("grants delegated access to an existing Pro user when the current user can manage the institution", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([
      {
        id: 8,
        display_name: "Analyst User",
        email: "analyst@example.com",
        role: "premium",
        subscription_status: "active",
      },
    ]);
    mocks.grantInstitutionWorkspaceMembershipMock.mockResolvedValue({
      id: 51,
      userDisplayName: "Analyst User",
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "Analyst@Example.com",
        role: "analyst",
        notes: "Board packet support.",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "Analyst User now has analyst access to Hamilton Bank.",
    });
    expect(mocks.state.sqlCalls[0].values).toEqual(["analyst@example.com"]);
    expect(mocks.grantInstitutionWorkspaceMembershipMock).toHaveBeenCalledWith({
      institutionId: 2945,
      userId: 8,
      role: "analyst",
      source: "delegated",
      grantedByUserId: 7,
      notes: "Board packet support.",
    });
  });

  it("rejects delegated grants from users without owner or admin institution authority", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.getActiveInstitutionMembershipMock.mockResolvedValue({
      role: "viewer",
      institutionId: 2945,
      userId: 7,
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "analyst@example.com",
        role: "analyst",
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "Only institution owners or admins can manage workspace access.",
    });
    expect(mocks.grantInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("refuses to re-grant (and so demote) an existing workspace owner", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.getActiveInstitutionMembershipMock.mockImplementation(async ({ userId }: { userId: number }) =>
      userId === 7
        ? { role: "admin", institutionId: 2945, userId: 7 }
        : { role: "owner", institutionId: 2945, userId },
    );
    mocks.state.queuedRows.push([
      { id: 9, display_name: "Owner User", email: "owner@example.com", role: "premium", subscription_status: "active" },
    ]);

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "owner@example.com", role: "viewer" }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "Only a platform admin can change an owner's workspace authority.",
    });
    expect(mocks.grantInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("queues an invitation when the target user is not active Pro yet", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([
      {
        id: 8,
        display_name: "Viewer User",
        email: "viewer@example.com",
        role: "viewer",
        subscription_status: "none",
      },
    ]);
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue({
      id: 91,
      email: "viewer@example.com",
      role: "viewer",
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "viewer@example.com",
        role: "viewer",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "viewer@example.com has been queued for viewer access. The invite activates after that user upgrades to Pro. Automated email is not configured yet; use the Email Invite action or send /workspace-invite manually.",
    });
    expect(mocks.grantInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalledWith({
      institutionId: 2945,
      email: "viewer@example.com",
      role: "viewer",
      invitedByUserId: 7,
      notes: "Pending viewer access from Hamilton Settings.",
    });
    expect(mocks.sendWorkspaceInviteEmailMock).toHaveBeenCalledWith({
      id: 91,
      email: "viewer@example.com",
      role: "viewer",
    });
  });

  it("queues an invitation when the target email has no account yet", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([]);
    mocks.sendWorkspaceInviteEmailMock.mockResolvedValue({
      status: "sent",
      providerId: "em_123",
    });
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue({
      id: 91,
      email: "newuser@example.com",
      role: "analyst",
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "newuser@example.com",
        role: "analyst",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "newuser@example.com has been queued for analyst access. Authority activates after they register and activate Pro with that email. Invite email sent with /workspace-invite.",
    });
    expect(mocks.grantInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalledWith({
      institutionId: 2945,
      email: "newuser@example.com",
      role: "analyst",
      invitedByUserId: 7,
      notes: "Pending analyst access from Hamilton Settings.",
    });
    expect(mocks.sendWorkspaceInviteEmailMock).toHaveBeenCalledWith({
      id: 91,
      email: "newuser@example.com",
      role: "analyst",
    });
  });

  it("keeps the queued invitation when email delivery fails", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([]);
    mocks.sendWorkspaceInviteEmailMock.mockResolvedValue({
      status: "failed",
      error: "provider unavailable",
    });
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue({
      id: 91,
      email: "newuser@example.com",
      role: "analyst",
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "newuser@example.com",
        role: "analyst",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "newuser@example.com has been queued for analyst access. Authority activates after they register and activate Pro with that email. Automated email delivery failed; use the Email Invite action or send /workspace-invite manually.",
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalled();
    expect(mocks.sendWorkspaceInviteEmailMock).toHaveBeenCalled();
  });

  it("keeps the queued invitation when the email helper throws", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([]);
    mocks.sendWorkspaceInviteEmailMock.mockRejectedValue(new Error("unexpected delivery error"));
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue({
      id: 91,
      email: "newuser@example.com",
      role: "analyst",
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        email: "newuser@example.com",
        role: "analyst",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "newuser@example.com has been queued for analyst access. Authority activates after they register and activate Pro with that email. Automated email delivery failed; use the Email Invite action or send /workspace-invite manually.",
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalled();
  });

  it("revokes delegated workspace access without allowing self-revocation", async () => {
    const { revokeWorkspaceAccess } = await import("./actions");
    mocks.state.queuedRows.push([{ user_id: 8, membership_role: "analyst" }]);
    mocks.revokeInstitutionWorkspaceMembershipMock.mockResolvedValue({
      id: 51,
      userDisplayName: "Analyst User",
      userEmail: "analyst@example.com",
      role: "analyst",
    });

    const result = await revokeWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        membership_id: "51",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "Analyst User no longer has analyst access to Hamilton Bank.",
    });
    expect(mocks.revokeInstitutionWorkspaceMembershipMock).toHaveBeenCalledWith({
      membershipId: 51,
      revokedByUserId: 7,
    });
  });

  it("blocks revoke attempts from users without active Pro access", async () => {
    const { revokeWorkspaceAccess } = await import("./actions");
    mocks.getCurrentUserMock.mockResolvedValue(proUser({ subscription_status: "none" }));

    const result = await revokeWorkspaceAccess(
      { success: false },
      form({
        institution_id: "2945",
        membership_id: "51",
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "Upgrade before managing workspace access.",
    });
    expect(mocks.revokeInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("revokes a pending workspace invitation", async () => {
    const { revokeWorkspaceInvitation } = await import("./actions");
    mocks.revokeInstitutionWorkspaceInvitationMock.mockResolvedValue({
      id: 91,
      email: "pending@example.com",
      role: "analyst",
    });

    const result = await revokeWorkspaceInvitation(
      { success: false },
      form({
        institution_id: "2945",
        invitation_id: "91",
      }),
    );

    expect(result).toMatchObject({
      success: true,
      message: "pending@example.com no longer has a pending analyst invitation for Hamilton Bank.",
    });
    expect(mocks.revokeInstitutionWorkspaceInvitationMock).toHaveBeenCalledWith({
      invitationId: 91,
      institutionId: 2945,
      revokedByUserId: 7,
    });
  });
});
