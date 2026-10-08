import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    getInstitutionWorkspaceSeatUsageMock: vi.fn(),
    createInstitutionWorkspaceInvitationMock: vi.fn(),
    grantInstitutionWorkspaceMembershipMock: vi.fn(),
    revokeInstitutionWorkspaceInvitationMock: vi.fn(),
    revokeInstitutionWorkspaceMembershipMock: vi.fn(),
    setHamiltonWorkspaceContextMock: vi.fn(),
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
  withTransaction: vi.fn(async (callback: (tx: typeof mocks.sqlMock) => Promise<unknown>) =>
    callback(mocks.sqlMock),
  ),
}));

vi.mock("@/lib/hamilton/institution-context", () => ({
  getHamiltonInstitutionContext: mocks.getHamiltonInstitutionContextMock,
}));

vi.mock("@/lib/hamilton/workspace-context", () => ({
  setHamiltonWorkspaceContext: mocks.setHamiltonWorkspaceContextMock,
}));

vi.mock("@/lib/hamilton/institution-membership", () => ({
  getActiveInstitutionMembership: mocks.getActiveInstitutionMembershipMock,
  getInstitutionWorkspaceSeatUsage: mocks.getInstitutionWorkspaceSeatUsageMock,
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

const INVITE_SECRET = "settings-test-secret";

function invitationRow(overrides: Record<string, unknown> = {}) {
  return { id: 91, email: "newuser@example.com", role: "analyst", institutionId: 2945, ...overrides };
}

describe("Hamilton Settings workspace access actions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let previousSecret: string | undefined;

  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows = [];
    mocks.sqlMock.mockClear();
    mocks.getCurrentUserMock.mockReset();
    mocks.revalidatePathMock.mockReset();
    mocks.getHamiltonInstitutionContextMock.mockReset();
    mocks.getActiveInstitutionMembershipMock.mockReset();
    mocks.getInstitutionWorkspaceSeatUsageMock.mockReset();
    mocks.createInstitutionWorkspaceInvitationMock.mockReset();
    mocks.grantInstitutionWorkspaceMembershipMock.mockReset();
    mocks.revokeInstitutionWorkspaceInvitationMock.mockReset();
    mocks.revokeInstitutionWorkspaceMembershipMock.mockReset();
    mocks.setHamiltonWorkspaceContextMock.mockReset();
    previousSecret = process.env.BFI_COOKIE_SECRET;
    process.env.BFI_COOKIE_SECRET = INVITE_SECRET;
    // Any outbound request (an email provider included) would go through fetch.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));

    mocks.getCurrentUserMock.mockResolvedValue(proUser());
    mocks.getHamiltonInstitutionContextMock.mockResolvedValue({
      institution: { id: 2945, name: "Hamilton Bank" },
      error: null,
    });
    mocks.getActiveInstitutionMembershipMock.mockResolvedValue({
      role: "owner",
      institutionId: 2945,
      userId: 7,
    });
    mocks.getInstitutionWorkspaceSeatUsageMock.mockResolvedValue({
      used: 2,
      limit: 5,
      emailHoldsSeat: false,
    });
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue(invitationRow());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (previousSecret === undefined) delete process.env.BFI_COOKIE_SECRET;
    else process.env.BFI_COOKIE_SECRET = previousSecret;
  });

  it("saves an invitation with a signed link and sends no email", async () => {
    const { grantWorkspaceAccess } = await import("./actions");

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "NewUser@Example.com", role: "analyst" }),
    );

    const token = createHmac("sha256", INVITE_SECRET).update("91:newuser@example.com:2945").digest("hex");
    expect(result).toMatchObject({
      success: true,
      inviteLink: `/workspace-invite?i=91&t=${token}`,
      inviteEmail: "newuser@example.com",
      message: expect.stringContaining("Copy the invite link"),
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalledWith(
      {
        institutionId: 2945,
        email: "newuser@example.com",
        role: "analyst",
        invitedByUserId: 7,
        notes: "Pending analyst access from Hamilton Settings.",
      },
      mocks.sqlMock,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gives an existing account an invitation, not instant access", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    // Even if a users row exists for this email, nothing grants a membership here.
    mocks.state.queuedRows.push([{ id: 8, display_name: "Analyst User", email: "analyst@example.com" }]);
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue(invitationRow({ email: "analyst@example.com" }));

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "analyst@example.com", role: "analyst" }),
    );

    expect(result).toMatchObject({ success: true, inviteEmail: "analyst@example.com" });
    expect(mocks.grantInstitutionWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalledTimes(1);
    expect(mocks.state.sqlCalls.some((call) => call.text.includes("INSERT INTO institution_workspace_memberships"))).toBe(false);
  });

  it("refuses to create an invite when the signing secret is missing", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    delete process.env.BFI_COOKIE_SECRET;

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "newuser@example.com", role: "analyst" }),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("BFI_COOKIE_SECRET"),
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("refuses an invite to the inviter's own email", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "owner@example.com", role: "admin" }),
    );
    expect(result.success).toBe(false);
    expect(mocks.createInstitutionWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("checks seats and writes under one per-institution lock", async () => {
    const { grantWorkspaceAccess } = await import("./actions");

    await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "a@example.com", role: "analyst" }),
    );

    expect(mocks.state.sqlCalls[0].text).toContain("pg_advisory_xact_lock");
    expect(mocks.state.sqlCalls[0].values).toEqual([2945]);
    expect(mocks.getInstitutionWorkspaceSeatUsageMock).toHaveBeenCalledWith(
      { institutionId: 2945, email: "a@example.com" },
      mocks.sqlMock,
    );
  });

  it("refuses a sixth person when all five seats are used", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.getInstitutionWorkspaceSeatUsageMock.mockResolvedValue({
      used: 5,
      limit: 5,
      emailHoldsSeat: false,
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "sixth@example.com", role: "analyst" }),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("All 5 seats on this institution account are in use"),
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("still lets a full workspace re-invite someone who already holds a seat", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.getInstitutionWorkspaceSeatUsageMock.mockResolvedValue({
      used: 5,
      limit: 5,
      emailHoldsSeat: true,
    });

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "member@example.com", role: "admin" }),
    );

    expect(result).toMatchObject({ success: true });
    expect(mocks.createInstitutionWorkspaceInvitationMock).toHaveBeenCalled();
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
      form({ institution_id: "2945", email: "analyst@example.com", role: "analyst" }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "Only institution owners or admins can manage workspace access.",
    });
    expect(mocks.createInstitutionWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("reports a failed invitation save instead of claiming success", async () => {
    const { grantWorkspaceAccess } = await import("./actions");
    mocks.createInstitutionWorkspaceInvitationMock.mockResolvedValue(null);

    const result = await grantWorkspaceAccess(
      { success: false },
      form({ institution_id: "2945", email: "newuser@example.com", role: "analyst" }),
    );

    expect(result).toMatchObject({ success: false, error: "Workspace invitation could not be saved." });
  });
});

describe("workspace invites send no email", () => {
  const settingsDir = join(process.cwd(), "src/app/pro/(hamilton)/settings");

  it("the settings actions import no email module", () => {
    const source = readFileSync(join(settingsDir, "actions.ts"), "utf8");
    expect(source).not.toMatch(/@\/lib\/email\//);
    expect(source).not.toMatch(/sendWorkspaceInviteEmail|resend/i);
  });

  it("the access manager has no mailto link and copies each invite's signed link", () => {
    const source = readFileSync(join(settingsDir, "WorkspaceAccessManager.tsx"), "utf8");
    expect(source).not.toContain("mailto:");
    expect(source).not.toContain("BFI_COOKIE_SECRET ||");
    expect(source).not.toContain("workspace-invite-link");
    expect(source).toContain("navigator.clipboard");
    expect(source).toContain("Copy invite link");
    expect(source).toContain("window.location.origin");
    expect(source).toContain("inviteLinks[invitation.id]");
  });
});

describe("Hamilton Settings revoke actions", () => {
  beforeEach(() => {
    mocks.state.sqlCalls.length = 0;
    mocks.state.queuedRows = [];
    mocks.getCurrentUserMock.mockReset();
    mocks.getCurrentUserMock.mockResolvedValue(proUser());
    mocks.getHamiltonInstitutionContextMock.mockResolvedValue({
      institution: { id: 2945, name: "Hamilton Bank" },
      error: null,
    });
    mocks.getActiveInstitutionMembershipMock.mockResolvedValue({
      role: "owner",
      institutionId: 2945,
      userId: 7,
    });
    mocks.revokeInstitutionWorkspaceInvitationMock.mockReset();
    mocks.revokeInstitutionWorkspaceMembershipMock.mockReset();
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

describe("settings server actions surface", () => {
  it("does not expose getSavedPeerSets(userId) as a callable server action", async () => {
    const actions = await import("./actions");
    expect("getSavedPeerSets" in actions).toBe(false);
  });
});

describe("Pro-only settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const lapsed = { id: 9, role: "viewer", subscription_status: "canceled" };

  it("refuse users without an active subscription", async () => {
    mocks.getCurrentUserMock.mockResolvedValue(lapsed);
    const actions = await import("./actions");
    const form = new FormData();
    form.set("name", "Peers");
    expect(await actions.createPeerSet(form)).toMatchObject({ success: false, error: expect.stringContaining("subscription") });
    expect(await actions.removePeerSet(1)).toMatchObject({ success: false });
    const institutionForm = new FormData();
    institutionForm.set("institution_id", "2945");
    expect(await actions.updateWorkspaceInstitution({ success: false } as never, institutionForm)).toMatchObject({ success: false });
  });

  it("caps saved peer sets at ten", async () => {
    mocks.getCurrentUserMock.mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    const savedPeers = await import("@/lib/data-store/saved-peers");
    vi.mocked(savedPeers.getSavedPeerSets).mockResolvedValueOnce(Array.from({ length: 10 }, (_, id) => ({ id })) as never);
    const actions = await import("./actions");
    const form = new FormData();
    form.set("name", "Eleventh");
    expect(await actions.createPeerSet(form)).toMatchObject({ success: false, error: expect.stringContaining("up to 10") });
  });
});
