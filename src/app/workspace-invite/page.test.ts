import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasWorkspaceSeat: vi.fn(),
  acceptSigned: vi.fn(),
  memberships: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  hasWorkspaceSeat: mocks.hasWorkspaceSeat,
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  getUserInstitutionMemberships: mocks.memberships,
}));
vi.mock("@/lib/hamilton/workspace-invite-link", () => ({
  WORKSPACE_INVITE_PATH: "/workspace-invite",
  acceptSignedWorkspaceInvite: mocks.acceptSigned,
  signedInviteMessage: () => "message",
}));
vi.mock("@/components/customer-footer", () => ({ CustomerFooter: () => null }));
vi.mock("@/components/consumer-nav", () => ({ ConsumerNav: () => null }));
vi.mock("@/components/public/search-modal", () => ({ SearchModal: () => null }));

import WorkspaceInvitePage from "./page";

const freeUser = {
  id: 8,
  username: "analyst@bank.com",
  email: "analyst@bank.com",
  role: "viewer",
  subscription_status: "none",
};

const TOKEN = "a".repeat(64);

describe("workspace invite page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberships.mockResolvedValue([]);
  });

  it("accepts a signed link for a signed-in account that has not paid, then re-checks the seat", async () => {
    mocks.getCurrentUser.mockResolvedValue(freeUser);
    mocks.acceptSigned.mockResolvedValue({ status: "accepted", membership: { id: 1 } });
    mocks.hasWorkspaceSeat.mockResolvedValue(true);

    await WorkspaceInvitePage({ searchParams: Promise.resolve({ i: "91", t: TOKEN }) });

    expect(mocks.acceptSigned).toHaveBeenCalledWith({ invitationId: 91, token: TOKEN, user: freeUser });
    expect(mocks.hasWorkspaceSeat).toHaveBeenCalledWith(8);
  });

  it("accepts nothing without a signed link, even for the invited email", async () => {
    mocks.getCurrentUser.mockResolvedValue(freeUser);
    await WorkspaceInvitePage({ searchParams: Promise.resolve({}) });
    await WorkspaceInvitePage({ searchParams: Promise.resolve({ i: "91" }) });
    expect(mocks.acceptSigned).not.toHaveBeenCalled();
  });

  it("accepts nothing for a signed-out visitor", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await WorkspaceInvitePage({ searchParams: Promise.resolve({ i: "91", t: TOKEN }) });
    expect(mocks.acceptSigned).not.toHaveBeenCalled();
  });
});
