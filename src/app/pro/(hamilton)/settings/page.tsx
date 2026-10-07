// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { CONTACT_EMAIL } from "@/lib/constants";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PeerSetManager } from "./PeerSetManager";
import { getSavedPeerSets } from "@/lib/data-store/saved-peers";
import {
  getIntelligenceSnapshot,
  getWorkspaceInstitutionClaimState,
} from "./actions";
import { FeatureToggles } from "./FeatureToggles";
import { ManageBillingButton } from "@/components/hamilton/settings/ManageBillingButton";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { WorkspaceInstitutionForm } from "./WorkspaceInstitutionForm";
import {
  getActiveInstitutionMembership,
  getInstitutionWorkspaceMembers,
  getPendingInstitutionWorkspaceInvitations,
  type InstitutionWorkspaceMembership,
  type InstitutionWorkspaceInvitation,
} from "@/lib/hamilton/institution-membership";
import { WorkspaceAccessManager } from "./WorkspaceAccessManager";
import { buildWorkspaceInvitePath, inviteLinksConfigured } from "@/lib/hamilton/workspace-invite-link";
import { LinkButton, MemoHeader, MemoPage, MemoSection, SERIF } from "@/components/hamilton/memo/memo";
import { FeeFiguresUpload } from "@/components/hamilton/settings/FeeFiguresUpload";

export const metadata: Metadata = {
  title: "My bank and data",
};

const PLAN_LABEL: Record<string, string> = {
  premium: "Professional",
  admin: "Admin Access",
  analyst: "Admin Access",
  viewer: "Free",
};

/**
 * My bank and data (reached from the Account menu), in the living-memo layout.
 * The bank picked here is the one Hamilton works on across every screen.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) {
    const returnPath = params.instId
      ? `/pro/settings?instId=${encodeURIComponent(params.instId)}`
      : "/pro/settings";
    redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  }

  const { institution: selectedInstitution, source: selectedSource } = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: params.instId,
    intent: "settings",
  });

  const planLabel = PLAN_LABEL[user.role] ?? "Free";
  const isAdmin = user.role === "admin" || user.role === "analyst";

  // Parallel data fetching
  const [peerSets, snapshot] = await Promise.all([
    getSavedPeerSets(String(user.id)).catch(() => []),
    getIntelligenceSnapshot(),
  ]);
  const [selectedClaim, selectedMembership, workspaceMembers, workspaceInvitations] = selectedInstitution
    ? await Promise.all([
        getWorkspaceInstitutionClaimState(selectedInstitution.id),
        getActiveInstitutionMembership({
          userId: user.id,
          institutionId: selectedInstitution.id,
        }).catch(() => null),
        getInstitutionWorkspaceMembers(selectedInstitution.id).catch(() => []),
        getPendingInstitutionWorkspaceInvitations(selectedInstitution.id).catch(() => []),
      ])
    : [null, null, [] as InstitutionWorkspaceMembership[], [] as InstitutionWorkspaceInvitation[]] as const;
  const canManageWorkspaceAccess =
    isAdmin ||
    selectedMembership?.role === "owner" ||
    selectedMembership?.role === "admin";
  // Signed per-invite links, computed here on the server; the secret never reaches the page.
  const inviteLinksReady = inviteLinksConfigured();
  const workspaceInviteLinks: Record<number, string | null> = canManageWorkspaceAccess
    ? Object.fromEntries(
        workspaceInvitations.map((invitation) => [
          invitation.id,
          buildWorkspaceInvitePath({
            invitationId: invitation.id,
            email: invitation.email,
            institutionId: invitation.institutionId,
          }),
        ]),
      )
    : {};

  const subscriptionStatus = user.subscription_status ?? "none";
  const statusLabel =
    subscriptionStatus === "active"
      ? "Active"
      : subscriptionStatus === "past_due"
        ? "Payment past due"
        : subscriptionStatus === "canceled"
          ? "Canceled"
          : "No subscription";
  const statusClass =
    subscriptionStatus === "past_due" || subscriptionStatus === "canceled"
      ? "bg-terra-soft text-terra-text"
      : "bg-warm-150 text-warm-800";
  // ManageBillingButton carries its own inline styles; for the neutral states (open the portal,
  // or subscribe) bring it in line with the memo's secondary button. Past-due and canceled keep
  // their own warning colours.
  const neutralBilling = !user.stripe_customer_id || subscriptionStatus === "none" || subscriptionStatus === "active";
  const billingButtonStyle = neutralBilling
    ? {
        padding: "0.5rem 0.875rem",
        fontSize: "0.875rem",
        fontWeight: 500,
        borderRadius: "0.375rem",
        border: "1px solid var(--color-warm-300)",
        color: "var(--color-warm-800)",
        backgroundColor: "var(--color-warm-50)",
        opacity: 1,
        cursor: "pointer",
      }
    : { padding: "0.5rem 0.875rem", fontSize: "0.875rem", fontWeight: 500 };

  const selectedInstParam = selectedInstitution
    ? `?instId=${selectedInstitution.id}`
    : "";
  const selectedInstAndIntentParam = selectedInstitution
    ? `?instId=${selectedInstitution.id}&intent=competitive-brief`
    : "?intent=competitive-brief";
  const panel = "rounded-lg border border-warm-300 bg-warm-50 p-5";

  return (
    <MemoPage>
      <MemoHeader
        kicker="Account"
        title="My bank and data"
        dek={
          selectedInstitution
            ? `Hamilton is working on ${selectedInstitution.name}.`
            : "Pick your bank so Hamilton can compare your fees with your peers."
        }
        actions={
          <>
            <LinkButton href={`/pro/monitor${selectedInstParam}`}>All changes</LinkButton>
            <LinkButton href={`/pro/analyze${selectedInstParam}`}>Ask Hamilton</LinkButton>
            <LinkButton href={`/pro/reports${selectedInstAndIntentParam}`} primary>
              Build a report
            </LinkButton>
          </>
        }
      />

      <MemoSection
        title="Your bank"
        note={
          selectedInstitution
            ? "Every screen starts from this bank."
            : "Choose your bank so Hamilton can compare your fees with your peers."
        }
      >
        <div className={panel}>
          <WorkspaceInstitutionForm
            selectedInstitution={selectedInstitution}
            selectedSource={selectedSource === "artifact" ? "manual" : selectedSource}
            selectedClaim={selectedClaim}
            selectedMembership={selectedMembership}
          />
        </div>
      </MemoSection>

      <MemoSection
        id="your-figures"
        title="Your own figures"
        note="Turns Hamilton's estimates into your own numbers."
      >
        <FeeFiguresUpload institutionId={selectedInstitution ? String(selectedInstitution.id) : null} />
      </MemoSection>

      <MemoSection
        id="peer-sets"
        title="Peer groups"
        note="Who your fees are compared with."
      >
        <div className={`${panel} scroll-mt-24`}>
          <PeerSetManager initialPeerSets={peerSets} />
        </div>
      </MemoSection>

      <MemoSection
        id="workspace-access"
        title="Team access"
        note="Colleagues see the same bank and saved work."
      >
        <div className={`${panel} scroll-mt-24`}>
          <WorkspaceAccessManager
            institutionId={selectedInstitution?.id ?? null}
            members={workspaceMembers}
            invitations={workspaceInvitations}
            canManage={canManageWorkspaceAccess}
            inviteLinks={workspaceInviteLinks}
            inviteLinksReady={inviteLinksReady}
          />
        </div>
      </MemoSection>

      <MemoSection title="Your account and billing">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={panel}>
            <p className="text-lg text-warm-900" style={SERIF}>
              {user.display_name}
            </p>
            {user.email && <p className="mt-0.5 text-sm text-warm-700">{user.email}</p>}
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-warm-700">
              <span className="rounded-full bg-warm-150 px-2.5 py-0.5 text-xs font-medium text-warm-800">
                {user.role === "admin" ? "Admin" : user.role === "analyst" ? "Analyst" : "Subscriber"}
              </span>
              <span>{planLabel}</span>
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-warm-200 pt-4 text-sm">
              <div>
                <dt className="text-warm-600">Saved analyses</dt>
                <dd className="mt-0.5 text-warm-900 [font-variant-numeric:tabular-nums]">{snapshot.savedAnalyses}</dd>
              </div>
              <div>
                <dt className="text-warm-600">Saved scenarios</dt>
                <dd className="mt-0.5 text-warm-900 [font-variant-numeric:tabular-nums]">{snapshot.savedScenarios}</dd>
              </div>
              <div>
                <dt className="text-warm-600">Account tier</dt>
                <dd className="mt-0.5 text-warm-900">{snapshot.tier}</dd>
              </div>
              <div>
                <dt className="text-warm-600">Last activity</dt>
                <dd className="mt-0.5 text-warm-900">
                  {snapshot.lastActivity ? new Date(snapshot.lastActivity).toLocaleDateString() : "No activity yet"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-warm-700">
              Research questions, report exports, saved analyses and saved scenarios have no monthly limit on your plan.
            </p>
            <Link
              href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/pro/analyze"}
              className="mt-3 inline-block text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra"
            >
              Ask Hamilton about your bank
            </Link>
          </div>

          <div className={panel}>
            {isAdmin ? (
              <>
                <p className="text-lg text-warm-900" style={SERIF}>
                  Admin access
                </p>
                <p className="mt-2 text-sm text-warm-700">
                  You have full access as an administrator. No billing applies.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg text-warm-900" style={SERIF}>
                    Hamilton Pro
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass}`}>{statusLabel}</span>
                </div>
                <p className="mt-2 text-sm text-warm-700">
                  Your plan, renewal date and invoices are in the billing portal.
                </p>
                <div className="mt-4 flex flex-wrap items-start gap-2">
                  <ManageBillingButton
                    hasStripeAccount={!!user.stripe_customer_id}
                    subscriptionStatus={subscriptionStatus}
                    className="hover:border-warm-500"
                    style={billingButtonStyle}
                  />
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=Fee%20Insight%20Hamilton%20support`}
                    className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 no-underline hover:border-warm-500"
                  >
                    Contact support
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </MemoSection>

      <MemoSection
        title="What your plan includes"
        note="Each link opens on the bank you picked above."
      >
        <FeatureToggles selectedInstitutionId={selectedInstitution ? String(selectedInstitution.id) : null} />
      </MemoSection>
    </MemoPage>
  );
}
