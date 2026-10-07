import crypto from "crypto";
import type { User } from "@/lib/auth";
import { withTransaction } from "@/lib/data-store/connection";
import {
  acceptWorkspaceInvitation,
  getWorkspaceInvitationForAccept,
  type InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";

/**
 * Signed workspace invite links. Server only: the secret never reaches the browser.
 *
 * A link is /workspace-invite?i=<invitationId>&t=<token>, where the token is
 * HMAC-SHA256(`${invitationId}:${email}:${institutionId}`) keyed with BFI_COOKIE_SECRET,
 * the secret that already signs session cookies (src/lib/auth.ts). Without that secret no
 * link is issued and none is accepted; there is no development fallback here.
 *
 * A seat becomes active only when the invitee opens a valid link while signed in with the
 * invited email, and the invitation is still pending and unexpired.
 */

export const WORKSPACE_INVITE_PATH = "/workspace-invite";

export const INVITE_SECRET_MISSING_MESSAGE =
  "Invite links can't be signed because the server secret (BFI_COOKIE_SECRET) is not set.";

function inviteSecret(): string | null {
  const secret = process.env.BFI_COOKIE_SECRET;
  return secret && secret.trim() ? secret : null;
}

export function inviteLinksConfigured(): boolean {
  return inviteSecret() !== null;
}

interface InviteIdentity {
  invitationId: number;
  email: string;
  institutionId: number;
}

function payload(invite: InviteIdentity): string {
  return `${invite.invitationId}:${invite.email.trim().toLowerCase()}:${invite.institutionId}`;
}

/** The token for one invitation, or null when the secret is not configured. */
export function signWorkspaceInviteToken(invite: InviteIdentity): string | null {
  const secret = inviteSecret();
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(payload(invite)).digest("hex");
}

/** Constant-time check of a token. False when the secret is missing or the token is malformed. */
export function verifyWorkspaceInviteToken(invite: InviteIdentity, token: string | null | undefined): boolean {
  const expected = signWorkspaceInviteToken(invite);
  if (!expected || !token || !/^[0-9a-f]{64}$/i.test(token)) return false;
  const given = Buffer.from(token.toLowerCase(), "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Path-and-query link for one invitation (the page adds its own origin), or null without a secret. */
export function buildWorkspaceInvitePath(invite: InviteIdentity): string | null {
  const token = signWorkspaceInviteToken(invite);
  if (!token) return null;
  return `${WORKSPACE_INVITE_PATH}?i=${invite.invitationId}&t=${token}`;
}

export type SignedInviteResult =
  | { status: "accepted"; membership: InstitutionWorkspaceMembership }
  | { status: "already_accepted" }
  | { status: "not_configured" }
  | { status: "invalid_link" }
  | { status: "wrong_email"; invitedEmail: string }
  | { status: "expired" }
  | { status: "revoked" }
  | { status: "used" }
  | { status: "failed" };

/** Plain-language reason for each result that is not an acceptance. */
export function signedInviteMessage(result: SignedInviteResult, signedInEmail: string | null): string {
  switch (result.status) {
    case "accepted":
      return `You joined ${result.membership.institutionName} as ${result.membership.role}.`;
    case "already_accepted":
      return "You already accepted this invitation.";
    case "not_configured":
      return "Invite links can't be checked right now because the server isn't set up for them. Ask the account owner to contact us.";
    case "invalid_link":
      return "This invite link isn't valid. Ask the account owner to copy the link again from Hamilton Settings.";
    case "wrong_email":
      return `This invitation is for ${result.invitedEmail}, but you're signed in as ${signedInEmail ?? "a different email"}. Sign in with the invited email to accept it.`;
    case "expired":
      return "This invitation has expired. Ask the account owner to invite you again.";
    case "revoked":
      return "This invitation was cancelled by the account owner.";
    case "used":
      return "This invitation has already been used.";
    case "failed":
      return "The invitation couldn't be accepted. Try again, or ask the account owner to invite you again.";
  }
}

/**
 * Accepts the invitation in a signed link for the signed-in user. Checks, in order: the
 * secret is set, the invitation exists and the token matches it, it is pending and
 * unexpired, and the user's email is the invited email. Runs in one transaction with the
 * invitation row locked.
 */
export async function acceptSignedWorkspaceInvite(params: {
  invitationId: number;
  token: string;
  user: Pick<User, "id" | "email" | "username">;
}): Promise<SignedInviteResult> {
  if (!inviteLinksConfigured()) return { status: "not_configured" };
  if (!Number.isSafeInteger(params.invitationId) || params.invitationId <= 0) {
    return { status: "invalid_link" };
  }
  const userEmail = (params.user.email ?? params.user.username ?? "").trim().toLowerCase();

  try {
    return await withTransaction(async (tx): Promise<SignedInviteResult> => {
      const invitation = await getWorkspaceInvitationForAccept(params.invitationId, tx);
      if (!invitation) return { status: "invalid_link" };
      const tokenValid = verifyWorkspaceInviteToken(
        { invitationId: invitation.id, email: invitation.email, institutionId: invitation.institutionId },
        params.token,
      );
      if (!tokenValid) return { status: "invalid_link" };

      if (invitation.status === "revoked") return { status: "revoked" };
      if (invitation.status === "accepted") {
        return invitation.acceptedByUserId === params.user.id
          ? { status: "already_accepted" }
          : { status: "used" };
      }
      if (invitation.status === "expired" || invitation.expired) return { status: "expired" };
      if (!userEmail || userEmail !== invitation.email.trim().toLowerCase()) {
        return { status: "wrong_email", invitedEmail: invitation.email };
      }

      const membership = await acceptWorkspaceInvitation(
        { invitationId: invitation.id, userId: params.user.id, email: userEmail },
        tx,
      );
      return membership ? { status: "accepted", membership } : { status: "failed" };
    });
  } catch (error) {
    console.error("[workspace-invite] accept failed:", error);
    return { status: "failed" };
  }
}
