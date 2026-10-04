// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { redirect } from "next/navigation";
import { SettingsForm } from "./SettingsForm";
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

export const metadata: Metadata = {
  title: "Strategy Settings",
};

const PLAN_LABEL: Record<string, string> = {
  premium: "Professional",
  admin: "Admin Access",
  analyst: "Admin Access",
  viewer: "Free",
};

/**
 * Settings page — Strategy Settings editorial design.
 * Institution profile form feeds HamiltonContextBar across all screens.
 * Per D-01, D-09: warm parchment aesthetic, serif headers, editorial layout.
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

  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/settings");

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
  const [selectedClaim, selectedMembership] = selectedInstitution
    ? await Promise.all([
        getWorkspaceInstitutionClaimState(selectedInstitution.id),
        getActiveInstitutionMembership({
          userId: user.id,
          institutionId: selectedInstitution.id,
        }).catch(() => null),
      ])
    : [null, null] as const;
  const canManageWorkspaceAccess =
    isAdmin ||
    selectedMembership?.role === "owner" ||
    selectedMembership?.role === "admin";
  // Any institution can be selected via ?instId=, so the member roster and
  // pending invites (names, emails) load only for people inside that workspace.
  const canViewWorkspaceRoster = canManageWorkspaceAccess || Boolean(selectedMembership);
  const [workspaceMembers, workspaceInvitations] = selectedInstitution && canViewWorkspaceRoster
    ? await Promise.all([
        getInstitutionWorkspaceMembers(selectedInstitution.id).catch((): InstitutionWorkspaceMembership[] => []),
        canManageWorkspaceAccess
          ? getPendingInstitutionWorkspaceInvitations(selectedInstitution.id).catch((): InstitutionWorkspaceInvitation[] => [])
          : Promise.resolve([] as InstitutionWorkspaceInvitation[]),
      ])
    : [[] as InstitutionWorkspaceMembership[], [] as InstitutionWorkspaceInvitation[]] as const;

  const cardStyle = {
    backgroundColor: "var(--hamilton-surface-elevated)",
    border: "1px solid var(--hamilton-border)",
    borderRadius: "0.5rem",
    padding: "1.5rem",
  };

  const sectionLabelStyle = {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--hamilton-text-secondary)",
  };

  const statusColors: Record<string, { bg: string; text: string }> = {
    active: { bg: "rgb(236, 253, 245)", text: "rgb(5, 150, 105)" },
    past_due: { bg: "rgb(255, 251, 235)", text: "rgb(217, 119, 6)" },
    canceled: { bg: "rgb(254, 242, 242)", text: "rgb(220, 38, 38)" },
    none: { bg: "rgb(243, 244, 246)", text: "rgb(107, 114, 128)" },
  };
  const selectedInstParam = selectedInstitution
    ? `?instId=${selectedInstitution.id}`
    : "";
  const selectedInstAndIntentParam = selectedInstitution
    ? `?instId=${selectedInstitution.id}&intent=competitive-brief`
    : "?intent=competitive-brief";

  return (
    <div className="pb-16">
      {/* Page header */}
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: "var(--hamilton-text-secondary)" }}>
          Hamilton Intelligence
        </p>
        <h1
          className="text-3xl font-bold mb-2"
          style={{
            fontFamily: "var(--hamilton-font-serif)",
            color: "var(--hamilton-text-primary)",
          }}
        >
          Strategy Settings
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--hamilton-text-secondary)" }}>
          Refine your institutional parameters, monitor prediction thresholds, and tune the strategy
          model your Hamilton experience is built on.
        </p>
      </div>

      {/* Row 1: Account Overview + Intelligence Snapshot */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
        {/* Account Overview */}
        <div className="lg:col-span-2" style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-4">Account Overview</p>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className="text-lg font-bold"
                style={{
                  fontFamily: "var(--hamilton-font-serif)",
                  color: "var(--hamilton-text-primary)",
                }}
              >
                {user.display_name}
              </p>
              {user.email && (
                <p className="text-sm mt-0.5" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {user.email}
                </p>
              )}

              <div className="flex items-center gap-3 mt-3">
                <span
                  className="px-2 py-0.5 text-[11px] font-semibold rounded uppercase tracking-wider"
                  style={{
                    backgroundColor: "var(--hamilton-accent-subtle)",
                    color: "var(--hamilton-text-accent)",
                  }}
                >
                  {user.role}
                </span>
                <span className="text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {planLabel}
                </span>
              </div>
            </div>
          </div>

          {!isAdmin && (
            <div className="flex items-center gap-3 mt-5">
              <ManageBillingButton
                hasStripeAccount={!!user.stripe_customer_id}
                subscriptionStatus={user.subscription_status ?? "none"}
                className="px-4 py-2 text-xs font-semibold rounded-md border transition-opacity hover:opacity-80"
              />
              <a
                href="mailto:hello@bankfeeindex.com?subject=Fee%20Insight%20Hamilton%20support"
                className="px-4 py-2 text-xs font-semibold rounded-md border transition-opacity hover:opacity-80"
                style={{
                  borderColor: "var(--hamilton-border)",
                  color: "var(--hamilton-text-secondary)",
                  backgroundColor: "transparent",
                }}
              >
                Contact Support
              </a>
            </div>
          )}
        </div>

        {/* Intelligence Snapshot (SET-05) */}
        <div style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-4">Intelligence Snapshot</p>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Account Tier
              </p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--hamilton-text-primary)" }}>
                {snapshot.tier}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Saved Analyses
              </p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--hamilton-text-primary)" }}>
                {snapshot.savedAnalyses}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Saved Scenarios
              </p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--hamilton-text-primary)" }}>
                {snapshot.savedScenarios}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Last Activity
              </p>
              <p className="text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                {snapshot.lastActivity ? new Date(snapshot.lastActivity).toLocaleDateString() : "No activity yet"}
              </p>
            </div>
          </div>
          <Link
            href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/pro/analyze"}
            className="inline-block mt-4 text-xs font-medium no-underline hover:opacity-80"
            style={{ color: "var(--hamilton-accent)" }}
          >
            View in Analyze
          </Link>
        </div>
      </div>

      {/* Selected Hamilton Institution */}
      <div style={cardStyle} className="mb-6">
        <p style={sectionLabelStyle} className="mb-1">Selected Hamilton Institution</p>
        <p className="text-xs mb-5" style={{ color: "var(--hamilton-text-tertiary)" }}>
          This institution anchors Analyze, Reports, Scenarios, and Watchlist when no URL-specific institution is supplied.
        </p>
        <WorkspaceInstitutionForm
          selectedInstitution={selectedInstitution}
          selectedSource={selectedSource === "artifact" ? "manual" : selectedSource}
          selectedClaim={selectedClaim}
          selectedMembership={selectedMembership}
        />
      </div>

      {/* Institution Profile */}
      <div style={cardStyle} className="mb-6">
        <p style={sectionLabelStyle} className="mb-1">Institution Profile</p>
        <p className="text-xs mb-5" style={{ color: "var(--hamilton-text-tertiary)" }}>
          This profile powers all Hamilton screens. Configure it to unlock personalized benchmarks and analysis.
        </p>
        <SettingsForm
          initialValues={{
            institution_name: user.institution_name,
            institution_type: user.institution_type,
            asset_tier: user.asset_tier,
            state_code: user.state_code,
            fed_district: user.fed_district ?? null,
          }}
        />
      </div>

      {/* Peer Set Management (SET-02) */}
      <div id="peer-sets" style={cardStyle} className="mb-6 scroll-mt-24">
        <p style={sectionLabelStyle} className="mb-1">Peer Set Management</p>
        <p className="text-xs mb-4" style={{ color: "var(--hamilton-text-tertiary)" }}>
          Configure peer groups for Simulate and Reports. Peer sets define the comparison universe for your fee analysis.
        </p>
        <PeerSetManager initialPeerSets={peerSets} />
      </div>

      {/* Row: Usage & Limits + Feature Access */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
        {/* Usage & Limits */}
        <div style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-3">Usage and Limits</p>
          <div className="space-y-2">
            {[
              { label: "Research queries", value: "Unlimited" },
              { label: "Report exports", value: "Unlimited" },
              { label: "Saved analyses", value: "Unlimited" },
              { label: "Saved scenarios", value: "Unlimited" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--hamilton-text-secondary)" }}>{item.label}</span>
                <span className="font-semibold" style={{ color: "var(--hamilton-text-primary)" }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Access (SET-03) */}
        <div style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-3">Feature Access</p>
          <FeatureToggles selectedInstitutionId={selectedInstitution ? String(selectedInstitution.id) : null} />
        </div>
      </div>

      {/* Row: Workspace Access + Billing */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
        {/* Workspace Access */}
        <div id="workspace-access" style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-3">Workspace Access</p>
          <WorkspaceAccessManager
            institutionId={selectedInstitution?.id ?? null}
            members={workspaceMembers}
            invitations={workspaceInvitations}
            canManage={canManageWorkspaceAccess}
          />
        </div>

        {/* Billing (SET-04) */}
        <div style={cardStyle}>
          <p style={sectionLabelStyle} className="mb-3">Billing</p>
          {isAdmin ? (
            <div>
              <span
                className="inline-block px-3 py-1 text-[11px] font-semibold rounded uppercase tracking-wider"
                style={{ backgroundColor: "rgb(255, 251, 235)", color: "rgb(180, 83, 9)" }}
              >
                Admin Access
              </span>
              <p className="text-sm mt-2" style={{ color: "var(--hamilton-text-secondary)" }}>
                You have full platform access as an administrator. No billing applies.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <p
                  className="text-base font-bold"
                  style={{ fontFamily: "var(--hamilton-font-serif)", color: "var(--hamilton-text-primary)" }}
                >
                  Professional
                </p>
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wider"
                  style={{
                    backgroundColor: statusColors[user.subscription_status]?.bg ?? statusColors.none.bg,
                    color: statusColors[user.subscription_status]?.text ?? statusColors.none.text,
                  }}
                >
                  {user.subscription_status === "active" ? "Active" :
                   user.subscription_status === "past_due" ? "Past Due" :
                   user.subscription_status === "canceled" ? "Canceled" : "No Subscription"}
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Renews monthly
              </p>
              <ManageBillingButton
                hasStripeAccount={!!user.stripe_customer_id}
                subscriptionStatus={user.subscription_status ?? "none"}
                className="px-4 py-2 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
              />
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div style={cardStyle} className="mb-6">
        <p style={sectionLabelStyle} className="mb-4">Quick Actions: Continue Working</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: `/pro/monitor${selectedInstParam}`, label: "Back to Monitor" },
            { href: `/pro/analyze${selectedInstParam}`, label: "Run Analysis" },
            { href: `/pro/reports${selectedInstAndIntentParam}`, label: "Build Report" },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="block p-3 rounded-md text-sm font-medium no-underline text-center transition-all hover:opacity-80"
              style={{
                backgroundColor: "var(--hamilton-surface-container-low)",
                color: "var(--hamilton-text-primary)",
                border: "1px solid transparent",
              }}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
