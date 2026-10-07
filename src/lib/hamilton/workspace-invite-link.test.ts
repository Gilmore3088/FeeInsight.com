import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInvitation: vi.fn(),
  accept: vi.fn(),
  tx: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: vi.fn(),
  withTransaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.tx)),
}));

vi.mock("@/lib/hamilton/institution-membership", () => ({
  getWorkspaceInvitationForAccept: mocks.getInvitation,
  acceptWorkspaceInvitation: mocks.accept,
}));

import {
  acceptSignedWorkspaceInvite,
  buildWorkspaceInvitePath,
  signWorkspaceInviteToken,
  signedInviteMessage,
  verifyWorkspaceInviteToken,
} from "./workspace-invite-link";

const SECRET = "test-secret-for-invites";
const invite = { invitationId: 91, email: "analyst@bank.com", institutionId: 2945 };
const user = { id: 8, email: "analyst@bank.com", username: "analyst@bank.com" };

function pendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    institutionId: 2945,
    email: "analyst@bank.com",
    role: "analyst",
    status: "pending",
    expired: false,
    acceptedByUserId: null,
    ...overrides,
  };
}

const membership = {
  id: 51,
  institutionId: 2945,
  institutionName: "Hamilton Bank",
  role: "analyst",
};

describe("signed workspace invite links", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.BFI_COOKIE_SECRET;
    process.env.BFI_COOKIE_SECRET = SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.BFI_COOKIE_SECRET;
    else process.env.BFI_COOKIE_SECRET = previousSecret;
  });

  it("signs HMAC-SHA256 of id:email:institution with the session secret", () => {
    const expected = crypto.createHmac("sha256", SECRET).update("91:analyst@bank.com:2945").digest("hex");
    expect(signWorkspaceInviteToken(invite)).toBe(expected);
    expect(signWorkspaceInviteToken({ ...invite, email: " Analyst@Bank.com " })).toBe(expected);
    expect(buildWorkspaceInvitePath(invite)).toBe(`/workspace-invite?i=91&t=${expected}`);
  });

  it("verifies only the exact token", () => {
    const token = signWorkspaceInviteToken(invite)!;
    expect(verifyWorkspaceInviteToken(invite, token)).toBe(true);
    expect(verifyWorkspaceInviteToken({ ...invite, institutionId: 2946 }, token)).toBe(false);
    expect(verifyWorkspaceInviteToken({ ...invite, email: "other@bank.com" }, token)).toBe(false);
    expect(verifyWorkspaceInviteToken(invite, "0".repeat(64))).toBe(false);
    expect(verifyWorkspaceInviteToken(invite, "not-hex")).toBe(false);
    expect(verifyWorkspaceInviteToken(invite, null)).toBe(false);
  });

  it("accepts with a valid token, a pending unexpired invite and the invited email", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation());
    mocks.accept.mockResolvedValue(membership);

    const result = await acceptSignedWorkspaceInvite({
      invitationId: 91,
      token: signWorkspaceInviteToken(invite)!,
      user: { ...user, email: "Analyst@Bank.com" },
    });

    expect(result).toEqual({ status: "accepted", membership });
    expect(mocks.getInvitation).toHaveBeenCalledWith(91, mocks.tx);
    expect(mocks.accept).toHaveBeenCalledWith(
      { invitationId: 91, userId: 8, email: "analyst@bank.com" },
      mocks.tx,
    );
  });

  it("rejects a wrong token", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation());
    const result = await acceptSignedWorkspaceInvite({ invitationId: 91, token: "a".repeat(64), user });
    expect(result).toEqual({ status: "invalid_link" });
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects a valid token for another invitation id", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation({ id: 92 }));
    const result = await acceptSignedWorkspaceInvite({
      invitationId: 92,
      token: signWorkspaceInviteToken(invite)!,
      user,
    });
    expect(result).toEqual({ status: "invalid_link" });
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects the wrong signed-in email", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation());
    const result = await acceptSignedWorkspaceInvite({
      invitationId: 91,
      token: signWorkspaceInviteToken(invite)!,
      user: { ...user, email: "someone@else.com", username: "someone@else.com" },
    });
    expect(result).toEqual({ status: "wrong_email", invitedEmail: "analyst@bank.com" });
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(signedInviteMessage(result, "someone@else.com")).toContain("This invitation is for analyst@bank.com");
  });

  it("rejects an expired invite, whether marked expired or past its date", async () => {
    const token = signWorkspaceInviteToken(invite)!;
    mocks.getInvitation.mockResolvedValueOnce(pendingInvitation({ expired: true }));
    expect(await acceptSignedWorkspaceInvite({ invitationId: 91, token, user })).toEqual({ status: "expired" });
    mocks.getInvitation.mockResolvedValueOnce(pendingInvitation({ status: "expired" }));
    expect(await acceptSignedWorkspaceInvite({ invitationId: 91, token, user })).toEqual({ status: "expired" });
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("rejects a revoked invite", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation({ status: "revoked" }));
    const result = await acceptSignedWorkspaceInvite({
      invitationId: 91,
      token: signWorkspaceInviteToken(invite)!,
      user,
    });
    expect(result).toEqual({ status: "revoked" });
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(signedInviteMessage(result, null)).toBe("This invitation was cancelled by the account owner.");
  });

  it("does not let a second person reuse an accepted invite", async () => {
    mocks.getInvitation.mockResolvedValue(pendingInvitation({ status: "accepted", acceptedByUserId: 99 }));
    const result = await acceptSignedWorkspaceInvite({
      invitationId: 91,
      token: signWorkspaceInviteToken(invite)!,
      user,
    });
    expect(result).toEqual({ status: "used" });
  });

  it("fails closed without a secret: no link is issued and none is accepted", async () => {
    const token = signWorkspaceInviteToken(invite)!;
    delete process.env.BFI_COOKIE_SECRET;

    expect(signWorkspaceInviteToken(invite)).toBeNull();
    expect(buildWorkspaceInvitePath(invite)).toBeNull();
    expect(verifyWorkspaceInviteToken(invite, token)).toBe(false);
    const result = await acceptSignedWorkspaceInvite({ invitationId: 91, token, user });
    expect(result).toEqual({ status: "not_configured" });
    expect(mocks.getInvitation).not.toHaveBeenCalled();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("treats a missing invitation as an invalid link", async () => {
    mocks.getInvitation.mockResolvedValue(null);
    const result = await acceptSignedWorkspaceInvite({
      invitationId: 91,
      token: signWorkspaceInviteToken(invite)!,
      user,
    });
    expect(result).toEqual({ status: "invalid_link" });
  });
});
