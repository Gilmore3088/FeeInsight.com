export const dynamic = "force-dynamic";

import Link from "next/link";
import { CustomerFooter } from "@/components/customer-footer";
import { ConsumerNav } from "@/components/consumer-nav";
import { SearchModal } from "@/components/public/search-modal";
import { canAccessPremium, hasTeamSeat } from "@/lib/access";
import { getCurrentUser, hasWorkspaceSeat } from "@/lib/auth";
import {
  acceptPendingWorkspaceInvitationsForUser,
  getUserInstitutionMemberships,
  type InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
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
  const userEmail = user?.email ?? user?.username ?? null;
  // A seat on an institution account needs no payment of its own: any signed-in account
  // accepts the pending invitations for its email here.
  const acceptedFromVisit = user
    ? await acceptPendingWorkspaceInvitationsForUser({
        userId: user.id,
        email: userEmail,
      }).catch(() => [])
    : [];
  const activeMemberships = user
    ? await getUserInstitutionMemberships(user.id).catch(() => [])
    : [];
  // The user was loaded before this visit accepted anything, so re-check the seat then.
  const hasSeat =
    user && acceptedFromVisit.length > 0 ? await hasWorkspaceSeat(user.id) : hasTeamSeat(user);
  const hasAccess = user ? canAccessPremium({ ...user, workspace_seat: hasSeat }) : false;

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
              An institution account includes up to {WORKSPACE_SEAT_LIMIT} teammates. Sign in with
              the email you were invited with and you join right away, with full Pro access and no
              payment of your own. Hamilton then carries that institution into Analyze, Reports,
              Simulate, Monitor, and Settings.
            </p>
          </div>

          {!user && (
            <div className="rounded-lg border border-[#E8DFD1] bg-white/70 p-4">
              <h2 className="text-base font-semibold text-[#1A1815]">
                Sign in with the invited email
              </h2>
              <p className="mt-2 text-sm text-[#6B6255]">
                Use the same email address your institution owner invited. If you don&apos;t have an
                account yet, create a free one with that email.
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

          {user && (
            <div className="space-y-4">
              {acceptedFromVisit.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  Accepted {acceptedFromVisit.length} workspace invitation
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
                  {!hasAccess && (
                    <p className="text-sm text-[#6B6255]">
                      This institution account isn&apos;t active right now, so Pro access is paused.
                      Ask the person who owns the account.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-[#E8DFD1] bg-white/70 p-4">
                  <p className="text-sm font-semibold text-[#1A1815]">
                    No invitation found for {userEmail}
                  </p>
                  <p className="mt-2 text-sm text-[#6B6255]">
                    Ask the institution owner to invite this exact email from Hamilton Settings, then
                    open this page again.
                    {!hasAccess && " If you want a workspace of your own, see the Pro plans."}
                  </p>
                  {!hasAccess && (
                    <Link
                      href="/subscribe"
                      className="mt-4 inline-flex rounded-full border border-[#D8CDBD] px-4 py-2 text-sm font-semibold text-[#1A1815] no-underline"
                    >
                      See Pro plans
                    </Link>
                  )}
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
