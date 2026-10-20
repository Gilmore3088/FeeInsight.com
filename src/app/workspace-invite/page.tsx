export const dynamic = "force-dynamic";

import Link from "next/link";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_CARD, utilityButton, utilityNotice } from "@/components/utility/form-style";
import { ConfirmEmailButton } from "@/app/account/confirm-email-button";
import { canAccessPremium, hasTeamSeat } from "@/lib/access";
import { getCurrentUser, hasWorkspaceSeat } from "@/lib/auth";
import {
  getUserInstitutionMemberships,
  type InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import {
  WORKSPACE_INVITE_PATH,
  acceptSignedWorkspaceInvite,
  signedInviteMessage,
  type SignedInviteResult,
} from "@/lib/hamilton/workspace-invite-link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace Invitation",
  description: "Accept an institution workspace invitation for Hamilton.",
};

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function locationLabel(item: { city: string | null; stateCode: string | null }): string {
  return [item.city, item.stateCode].filter(Boolean).join(", ");
}

function MembershipCard({ membership }: { membership: InstitutionWorkspaceMembership }) {
  return (
    <div className="rounded-lg border border-border bg-paper px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">
            {membership.institutionName}
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {[locationLabel(membership), roleLabel(membership.role)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link
          href={`/pro/analyze?instId=${membership.institutionId}`}
          className={`w-fit ${utilityButton("primary")}`}
        >
          Open Hamilton
        </Link>
      </div>
    </div>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? String(first) : null;
}

export default async function WorkspaceInvitePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const invitationParam = firstParam(params.i);
  const token = firstParam(params.t);
  const hasLink = Boolean(invitationParam && token);
  const returnPath = hasLink
    ? `${WORKSPACE_INVITE_PATH}?i=${encodeURIComponent(invitationParam ?? "")}&t=${encodeURIComponent(token ?? "")}`
    : WORKSPACE_INVITE_PATH;
  const fromParam = encodeURIComponent(returnPath);

  const user = await getCurrentUser();
  const userEmail = user?.email ?? user?.username ?? null;
  // A seat starts only from a signed invite link opened by the invited email. A seat on an
  // institution account needs no payment of its own.
  const result: SignedInviteResult | null =
    user && hasLink
      ? await acceptSignedWorkspaceInvite({
          invitationId: Number(invitationParam),
          token: token ?? "",
          user,
        })
      : null;
  const activeMemberships = user
    ? await getUserInstitutionMemberships(user.id).catch(() => [])
    : [];
  // The user was loaded before this visit accepted anything, so re-check the seat then.
  const hasSeat =
    user && result?.status === "accepted" ? await hasWorkspaceSeat(user.id) : hasTeamSeat(user);
  const hasAccess = user ? canAccessPremium({ ...user, workspace_seat: hasSeat }) : false;

  return (
    <UtilityShell>
      <UtilityHeading
        title="Join your institution's workspace"
        lede={`Your institution's plan covers up to ${WORKSPACE_SEAT_LIMIT} people. Sign in with the invited email to join at no cost.`}
      />

      {!user && (
        <div className={`${UTILITY_CARD} space-y-4`}>
          <div>
            <h2 className="text-[17px] font-semibold text-ink">Sign in with the invited email</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
              No account yet? Create a free one with that email.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href={`/login?from=${fromParam}`} className={utilityButton("primary", { block: true })}>
              Sign in
            </Link>
            <Link href={`/register?from=${fromParam}`} className={utilityButton("secondary", { block: true })}>
              Create account
            </Link>
          </div>
        </div>
      )}

      {user && (
        <div className="space-y-4">
          {result && (
            <div
              role="status"
              className={utilityNotice(
                result.status === "accepted" || result.status === "already_accepted" ? "success" : "error",
              )}
            >
              {signedInviteMessage(result, userEmail)}
            </div>
          )}
          {result?.status === "email_unconfirmed" && (
            <div className={`${UTILITY_CARD} space-y-2`}>
              <p className="text-[14px] leading-relaxed text-ink-muted">
                No confirmation email? Send a new link to {userEmail}.
              </p>
              <ConfirmEmailButton />
            </div>
          )}
          {activeMemberships.length > 0 ? (
            <div className={`${UTILITY_CARD} space-y-3`}>
              <h2 className="text-[17px] font-semibold text-ink">Your institution workspaces</h2>
              {activeMemberships.map((membership) => (
                <MembershipCard key={membership.id} membership={membership} />
              ))}
              {!hasAccess && (
                <p className="text-[14px] leading-relaxed text-ink-muted">
                  This institution account isn&apos;t active right now, so Pro access is paused.
                  Ask the person who owns the account.
                </p>
              )}
            </div>
          ) : (
            <div className={`${UTILITY_CARD} space-y-3`}>
              <h2 className="text-[17px] font-semibold text-ink">No workspace for {userEmail} yet</h2>
              <p className="text-[14px] leading-relaxed text-ink-muted">
                Open the invite link the account owner sent you. No link? Ask them to invite this exact
                email from Hamilton Settings.
                {!hasAccess && " For a workspace of your own, see the Hamilton plans."}
              </p>
              {!hasAccess && (
                <Link href="/subscribe" className={utilityButton("secondary")}>
                  See Hamilton plans
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </UtilityShell>
  );
}
