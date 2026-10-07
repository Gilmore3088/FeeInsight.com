import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasWorkspaceSeat: vi.fn(),
  accept: vi.fn(),
  memberships: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  hasWorkspaceSeat: mocks.hasWorkspaceSeat,
}));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  acceptPendingWorkspaceInvitationsForUser: mocks.accept,
  getUserInstitutionMemberships: mocks.memberships,
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

describe("workspace invite page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberships.mockResolvedValue([]);
  });

  it("accepts the invitation for a signed-in account that has not paid", async () => {
    mocks.getCurrentUser.mockResolvedValue(freeUser);
    mocks.accept.mockResolvedValue([{ id: 1 }]);
    mocks.hasWorkspaceSeat.mockResolvedValue(true);

    await WorkspaceInvitePage();

    expect(mocks.accept).toHaveBeenCalledWith({ userId: 8, email: "analyst@bank.com" });
    // The seat is re-checked after accepting, since the user was loaded before.
    expect(mocks.hasWorkspaceSeat).toHaveBeenCalledWith(8);
  });

  it("accepts nothing for a signed-out visitor", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await WorkspaceInvitePage();
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});
