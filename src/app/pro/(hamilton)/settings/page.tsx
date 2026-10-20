// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import { CONTACT_EMAIL } from "@/lib/constants";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PeerSetManager } from "./PeerSetManager";
import {
  getPeerInstitutionNames,
  getSavedPeerSets,
  type SavedPeerSet,
} from "@/lib/data-store/saved-peers";
import { getPeerGroupCounts, type PeerGroupCount } from "@/lib/data-store/fee-index";
import {
  buildInstitutionPeerFilterCandidates,
  describePeerFilters,
  parseSavedPeerSetFilters,
} from "@/lib/hamilton/peer-index";
import { MIN_PEERS_FOR_POSITION } from "@/lib/hamilton/workspace/scenario";
import {
  hasPeerSetPrefill,
  parsePeerSetPrefillParams,
  peerSetPrefillSearch,
  resolvePeerSetPrefill,
  type PeerSetPrefillParams,
} from "@/lib/hamilton/peer-set-prefill";
import {
  getIntelligenceSnapshot,
} from "./actions";
import { FeatureToggles } from "./FeatureToggles";
import { ManageBillingButton } from "@/components/hamilton/settings/ManageBillingButton";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { WorkspaceInstitutionForm } from "./WorkspaceInstitutionForm";
import { sql } from "@/lib/data-store/connection";
import { getPendingInstitutionLink } from "@/lib/pro-institution-link";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
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
import { isCappedConsultant } from "@/lib/hamilton/report-cap";
import { CONSULTANT_MONTHLY_REPORTS } from "@/lib/pro-tiers";

export const metadata: Metadata = {
  title: "Research and data",
};

const PLAN_LABEL: Record<string, string> = {
  premium: "Professional",
  admin: "Admin Access",
  analyst: "Admin Access",
  viewer: "Free",
};

/**
 * Research and data (reached from the Account menu), in the living-memo layout.
 * Research selection is separate from authenticated institution membership.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string } & PeerSetPrefillParams>;
}) {
  const params = await searchParams;
  // A peer set handed over by a public page (#1981), each parameter checked and dropped if bad.
  const prefillParams = parsePeerSetPrefillParams(params);
  const user = await getCurrentUser();
  if (!user) {
    const returnSearch = new URLSearchParams();
    if (typeof params.instId === "string" && params.instId) returnSearch.set("instId", params.instId);
    for (const [key, value] of peerSetPrefillSearch(prefillParams)) returnSearch.set(key, value);
    const query = returnSearch.toString();
    const returnPath = `/pro/settings${query ? `?${query}` : ""}${hasPeerSetPrefill(prefillParams) ? "#peer-sets" : ""}`;
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
  const [snapshot, cappedConsultant, accountContext, pendingLink, fetchedMembership] = await Promise.all([
    getIntelligenceSnapshot(),
    isCappedConsultant(user).catch(() => false),
    loadHamiltonAccountContext(user),
    getPendingInstitutionLink(sql, user.id),
    selectedInstitution
      ? getActiveInstitutionMembership({ userId: user.id, institutionId: selectedInstitution.id }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const selectedMembership = fetchedMembership?.userId === user.id &&
    fetchedMembership.institutionId === selectedInstitution?.id && fetchedMembership.status === "active"
      ? fetchedMembership
      : null;
  // The research subject can be any institution (?instId=), so its team (names, emails, pending
  // invites) is read only for an active member of that institution or platform staff (#1922).
  const canSeeTeam = isAdmin || selectedMembership !== null;
  const [workspaceMembers, workspaceInvitations]: [InstitutionWorkspaceMembership[], InstitutionWorkspaceInvitation[]] =
    selectedInstitution && canSeeTeam
      ? await Promise.all([
          getInstitutionWorkspaceMembers(selectedInstitution.id).catch(() => []),
          getPendingInstitutionWorkspaceInvitations(selectedInstitution.id).catch(() => []),
        ])
      : [[], []];
  const peerSetWorkspace = selectedMembership
    ? { institutionId: selectedMembership.institutionId, role: selectedMembership.role }
    : null;
  const loadedPeerSets = await getSavedPeerSets(
    String(user.id),
    peerSetWorkspace?.institutionId ?? null,
  ).catch(() => []);
  // Team groups from another institution the user belongs to stay in the store, but
  // they cannot become the displayed baseline for this research subject.
  const peerSets: SavedPeerSet[] = loadedPeerSets.filter((set) =>
    set.institution_id === null || set.institution_id === peerSetWorkspace?.institutionId,
  );
  // Real counts of the institutions each set resolves to, names for the chosen-peer chips, and
  // the handed-over set's peers (unknown institutions dropped). Nothing is saved here.
  const [peerSetCounts, peerInstitutionNames, peerSetPrefill] = await Promise.all([
    getPeerGroupCounts(
      peerSets.map((set) => parseSavedPeerSetFilters(set)),
      peerSetWorkspace?.institutionId ?? selectedInstitution?.id ?? null,
    ).catch((): PeerGroupCount[] => []),
    getPeerInstitutionNames(peerSets.flatMap((set) => set.institution_ids ?? [])).catch(
      () => new Map<number, string>(),
    ),
    resolvePeerSetPrefill(prefillParams, getPeerInstitutionNames),
  ]);
  // Where a set is too thin for a fee, charts fall back to the bank's own default group.
  const firstDefaultGroup = selectedInstitution
    ? buildInstitutionPeerFilterCandidates({
        institution_name: selectedInstitution.name,
        state_code: selectedInstitution.stateCode,
        charter_type: selectedInstitution.charterType,
        asset_size_tier: selectedInstitution.assetTier,
        fed_district: selectedInstitution.fedDistrict,
      })[0]
    : undefined;
  const widerGroupLabel = firstDefaultGroup ? describePeerFilters(firstDefaultGroup) : "the national index";
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
        kicker="Settings"
        title="Research and data"
        dek={
          selectedInstitution
            ? `Research institution: ${selectedInstitution.name}.`
            : "Choose an institution for Hamilton's fee research and peer comparisons."
        }
        actions={
          <>
            <LinkButton href={`/pro/monitor${selectedInstParam}`}>Alerts and watches</LinkButton>
            <LinkButton href={`/pro/analyze${selectedInstParam}`}>Ask Hamilton</LinkButton>
            <LinkButton href={`/pro/reports${selectedInstAndIntentParam}`} primary>
              Build a report
            </LinkButton>
          </>
        }
      />

      <MemoSection
        id="account-institution"
        title="Your institution"
        note="The institution you work at, linked by your work email or your team's invitation. Researching another institution doesn't change it."
      >
        <div className={panel}>
          {accountContext.status === "identified" && accountContext.institution ? (
            <>
              <p className="text-lg text-warm-900" style={SERIF}>{accountContext.institution.name}</p>
            </>
          ) : (
            <p className="text-sm text-warm-700">
              {accountContext.status === "ambiguous"
                ? "More than one institution is linked to your account. Hamilton asks which one you mean when it matters."
                : accountContext.status === "unavailable"
                  ? "Your institution couldn't load just now."
                  : pendingLink
                    ? pendingLink.needsInfo
                      ? `${pendingLink.institutionName}: we need a little more before linking it. Email ${CONTACT_EMAIL} from your work address.`
                      : pendingLink.emailConfirmed
                        ? `${pendingLink.institutionName}: we're checking your work email against it, and it links once that's done.`
                        : `${pendingLink.institutionName}: confirm your work email (the link is in your inbox) and it links on its own when the email matches ${pendingLink.institutionName}'s website.`
                    : "No institution linked yet."}
            </p>
          )}
        </div>
      </MemoSection>

      <MemoSection
        title="Research institution"
        note="Choose the institution Hamilton researches. Account membership and workspace access are separate."
      >
        <div className={panel}>
          <WorkspaceInstitutionForm
            key={JSON.stringify([user.id, selectedInstitution?.id ?? null, selectedSource])}
            selectedInstitution={selectedInstitution}
            selectedSource={selectedSource === "artifact" ? "manual" : selectedSource}
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
        note="Who the research institution's fees are compared with."
      >
        <div className={`${panel} scroll-mt-24`}>
          <PeerSetManager
            key={JSON.stringify([
              user.id,
              selectedInstitution?.id ?? null,
              peerSetWorkspace?.institutionId ?? null,
              peerSetPrefill ? [peerSetPrefill.peers.map((peer) => peer.id), peerSetPrefill.name, peerSetPrefill.fee?.key, peerSetPrefill.asOf, peerSetPrefill.tooLarge] : null,
            ])}
            researchInstitutionId={selectedInstitution?.id ?? null}
            initialPeerSets={peerSets}
            initialCounts={Object.fromEntries(
              peerSets.flatMap((set, i) => (peerSetCounts[i] ? [[set.id, peerSetCounts[i]]] : [])),
            )}
            initialInstitutionNames={Object.fromEntries(peerInstitutionNames)}
            workspaceName={peerSetWorkspace ? selectedInstitution?.name ?? null : null}
            canEditWorkspaceSets={peerSetWorkspace?.role !== "viewer"}
            currentUserId={String(user.id)}
            minPeers={MIN_PEERS_FOR_POSITION}
            widerGroupLabel={widerGroupLabel}
            prefill={peerSetPrefill}
          />
        </div>
      </MemoSection>

      <MemoSection
        id="workspace-access"
        title="Team access"
        note="Manage institution workspace access separately from research selection."
      >
        <div className={`${panel} scroll-mt-24`}>
          {selectedInstitution && !canSeeTeam ? (
            <p className="text-sm text-warm-700">
              Only people on {selectedInstitution.name}&apos;s team can see who has access to it.
            </p>
          ) : (
            <WorkspaceAccessManager
              institutionId={selectedInstitution?.id ?? null}
              members={workspaceMembers}
              invitations={workspaceInvitations}
              canManage={canManageWorkspaceAccess}
              inviteLinks={workspaceInviteLinks}
              inviteLinksReady={inviteLinksReady}
            />
          )}
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
              {cappedConsultant
                ? `Your plan includes ${CONSULTANT_MONTHLY_REPORTS} Hamilton reports a month. Research questions, saved analyses and saved scenarios have no monthly limit.`
                : "Research questions, report exports, saved analyses and saved scenarios have no monthly limit on your plan."}
            </p>
            <Link
              href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/pro/analyze"}
              className="mt-3 inline-block text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra"
            >
              Ask Hamilton about this institution
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
                    Hamilton
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
        note="Each link opens on the research institution selected above."
      >
        <FeatureToggles selectedInstitutionId={selectedInstitution ? String(selectedInstitution.id) : null} />
      </MemoSection>
    </MemoPage>
  );
}
