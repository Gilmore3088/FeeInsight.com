export const dynamic = "force-dynamic";

import Link from "next/link";
import { CustomerFooter } from "@/components/customer-footer";
import { ConsumerNav } from "@/components/consumer-nav";
import { SearchModal } from "@/components/public/search-modal";
import { canAccessPremium } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import {
  acceptPendingWorkspaceInvitationsForUser,
  getPendingWorkspaceInvitationsForEmail,
  getUserInstitutionMemberships,
  type InstitutionWorkspaceInvitation,
  type InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace Invitation",
  description: "Accept an institution workspace invitation for Hamilton Pro.",
};

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function locationLabel(item: { city: string | null; stateCode: string | null }): string {
  return [item.city, item.stateCode].filter(Boolean).join(", ");
}

function PendingInviteCard({ invitation }: { invitation: InstitutionWorkspaceInvitation }) {
  return (
    <div className="rounded-lg border border-[#E8DFD1] bg-white/75 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#1A1815]">
            {invitation.institutionName}
          </p>
          <p className="mt-1 text-xs text-[#6B6255]">
            {[locationLabel(invitation), roleLabel(invitation.role)].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-[#6B6255]">
            Invited by {invitation.invitedByDisplayName ?? invitation.invitedByEmail ?? "a workspace owner"}
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
          Pending Pro
        </span>
      </div>
    </div>
  );
}

function MembershipCard({ membership }: { membership: InstitutionWorkspaceMembership }) {
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#1A1815]">
            {membership.institutionName}
          </p>
          <p className="mt-1 text-xs text-[#6B6255]">
            {[locationLabel(membership), roleLabel(membership.role)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link
          href={`/pro/analyze?instId=${membership.institutionId}`}
          className="inline-flex w-fit rounded-full bg-[#1A1815] px-3 py-1.5 text-[11px] font-semibold text-white no-underline"
        >
          Open Hamilton
        </Link>
      </div>
    </div>
  );
}

export default async function WorkspaceInvitePage() {
  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);
  const userEmail = user?.email ?? user?.username ?? null;
  const pendingInvitations =
    user && !isPro
      ? await getPendingWorkspaceInvitationsForEmail(userEmail, 10).catch(() => [])
      : [];
  const acceptedFromVisit =
    user && isPro
      ? await acceptPendingWorkspaceInvitationsForUser({
          userId: user.id,
          email: userEmail,
        }).catch(() => [])
      : [];
  const activeMemberships =
    user && isPro
      ? await getUserInstitutionMemberships(user.id).catch(() => [])
      : [];

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A93D25]">
              Hamilton Workspace
            </p>
            <h1
              className="mt-2 text-3xl font-normal tracking-tight text-[#1A1815]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Institution workspace invitation
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#6B6255]">
              Workspace access is tied to your signed-in email and an active Pro seat. Once both match,
              Hamilton grants the delegated institution role automatically and carries that institution
              into Analyze, Reports, Simulate, Monitor, and Settings.
            </p>
          </div>

          {!user && (
            <div className="rounded-lg border border-[#E8DFD1] bg-white/70 p-4">
              <h2 className="text-base font-semibold text-[#1A1815]">
                Sign in with the invited email
              </h2>
              <p className="mt-2 text-sm text-[#6B6255]">
                Use the same email address your institution owner invited. If you do not have an
                account yet, create one first, then activate a Pro seat.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/register?from=%2Fworkspace-invite"
                  className="rounded-full bg-[#C44B2E] px-4 py-2 text-sm font-semibold text-white no-underline"
                >
                  Create Account
                </Link>
                <Link
                  href="/login?from=%2Fworkspace-invite"
                  className="rounded-full border border-[#D8CDBD] px-4 py-2 text-sm font-semibold text-[#1A1815] no-underline"
                >
                  Sign In
                </Link>
              </div>
            </div>
          )}

          {user && !isPro && (
            <div className="space-y-4">
              {pendingInvitations.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[#1A1815]">
                    Pending invitations for {userEmail}
                  </p>
                  {pendingInvitations.map((invitation) => (
                    <PendingInviteCard key={invitation.id} invitation={invitation} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-[#E8DFD1] bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[#1A1815]">
                    No pending invitation found for {userEmail}
                  </p>
                  <p className="mt-2 text-sm text-[#6B6255]">
                    Ask the institution owner to invite this exact email from Hamilton Settings, or
                    continue to Pro if you need your own workspace.
                  </p>
                </div>
              )}
              <Link
                href="/subscribe?invite=workspace"
                className="inline-flex rounded-full bg-[#C44B2E] px-4 py-2 text-sm font-semibold text-white no-underline"
              >
                Activate Pro Seat
              </Link>
            </div>
          )}

          {user && isPro && (
            <div className="space-y-4">
              {acceptedFromVisit.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  Accepted {acceptedFromVisit.length} pending workspace invitation
                  {acceptedFromVisit.length === 1 ? "" : "s"} for {userEmail}.
                </div>
              )}
              {activeMemberships.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[#1A1815]">
                    Active institution workspaces
                  </p>
                  {activeMemberships.map((membership) => (
                    <MembershipCard key={membership.id} membership={membership} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-[#E8DFD1] bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[#1A1815]">
                    No active institution workspace yet
                  </p>
                  <p className="mt-2 text-sm text-[#6B6255]">
                    Your Pro seat is active, but this email has no pending delegated workspace invite.
                    Ask the institution owner to invite {userEmail} from Hamilton Settings.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
