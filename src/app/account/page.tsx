export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { redirect } from "next/navigation";
import { ManageBillingButton } from "./manage-billing-button";
import { PremiumBadge } from "@/components/upgrade-gate";
import { LogoutButton } from "./logout-button";
import { ProfileForm } from "./profile-form";
import { AlertsPanel } from "./alerts-panel";
import { SubscriptionStatusNotice } from "./subscription-status-notice";
import { STATE_TO_DISTRICT, DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import { formatAmount } from "@/lib/format";
import { getHamiltonInstitutionContext } from "@/lib/hamilton/institution-context";
import { getHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";
import {
  buildAccountQuickActions,
  buildHamiltonAccountHref,
} from "@/lib/hamilton/account-actions";
import {
  getUserInstitutionClaimHistory,
  getUserInstitutionMemberships,
  getPendingWorkspaceInvitationsForEmail,
} from "@/lib/hamilton/institution-membership";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
};

const VERIFIED_BENCHMARK_POLICY = "Verified-only benchmark medians";
const PROVISIONAL_ANALYSIS_POLICY = "Provisional-first Hamilton analysis";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/account");

  const params = await searchParams;
  // Fallback: if webhook missed, verify payment directly with Stripe
  if (user.subscription_status !== "active" && user.stripe_customer_id) {
    try {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        const { sql: sqlConn } = await import("@/lib/data-store/connection");
        await sqlConn`
          UPDATE users SET subscription_status = 'active', past_due_since = NULL, role = 'premium'
          WHERE id = ${user.id} AND role NOT IN ('admin', 'analyst')`;
        user.subscription_status = "active";
        if (user.role !== "admin" && user.role !== "analyst") {
          user.role = "premium";
        }
      }
    } catch {
      // Stripe not configured or error -- continue with current status
    }
  }

  const isPro = canAccessPremium(user);
  const pendingWorkspaceInvitations = !isPro
    ? await getPendingWorkspaceInvitationsForEmail(user.email ?? user.username, 5).catch(() => [])
    : [];
  const district = user.state_code ? STATE_TO_DISTRICT[user.state_code] : null;
  const districtName = district ? DISTRICT_NAMES[district] : null;
  const stateName = user.state_code ? STATE_NAMES[user.state_code] : null;
  const selectedWorkspaceContext = isPro
    ? await getHamiltonWorkspaceContext(user.id).catch(() => null)
    : null;
  const selectedInstitution = selectedWorkspaceContext?.selectedInstitutionId
    ? (
        await getHamiltonInstitutionContext(
          selectedWorkspaceContext.selectedInstitutionId,
        ).catch(() => ({ institution: null }))
      ).institution
    : null;
  const [institutionMemberships, claimHistory] = isPro
    ? await Promise.all([
        getUserInstitutionMemberships(user.id).catch(() => []),
        getUserInstitutionClaimHistory(user.id, 5).catch(() => []),
      ])
    : [[], []];
  const selectedMembership = selectedInstitution
    ? institutionMemberships.find((membership) => membership.institutionId === selectedInstitution.id)
    : null;

  function hamiltonHref(path: string, params?: Record<string, string>): string {
    return buildHamiltonAccountHref({
      isPro,
      path,
      params,
      selectedInstitutionId: selectedInstitution?.id ?? null,
    });
  }

  const selectedContextSourceLabel =
    selectedWorkspaceContext?.selectedSource === "url"
      ? "URL selected"
      : selectedWorkspaceContext?.selectedSource === "manual"
        ? "Manual"
        : selectedWorkspaceContext?.selectedSource === "profile"
          ? "Profile"
          : selectedWorkspaceContext?.selectedSource === "watchlist"
            ? "Watchlist"
            : null;

  // Personalized fee insight
  let feeInsight: { category: string; stateMedian: number | null; nationalMedian: number | null } | null = null;
  if (user.state_code) {
    try {
      const nationalIndex = await getNationalIndex();
      const stateIndex = await getPeerIndex({ state_code: user.state_code });
      const odNational = nationalIndex.find((e) => e.fee_category === "overdraft");
      const odState = stateIndex.find((e) => e.fee_category === "overdraft");
      if (odNational && odState && odState.median_amount !== null) {
        feeInsight = {
          category: "overdraft",
          stateMedian: odState.median_amount,
          nationalMedian: odNational.median_amount,
        };
      }
    } catch {
      // DB not available
    }
  }

  const quickActions = buildAccountQuickActions({
    isPro,
    userStateCode: user.state_code,
    districtName,
    selectedInstitution: selectedInstitution
      ? { id: selectedInstitution.id, name: selectedInstitution.name }
      : null,
  });

  const userInitial = (user.institution_name?.[0] || user.email?.[0] || user.username?.[0] || "U").toUpperCase();
  const formatDate = (value: string | null | undefined) => {
    if (!value) return "Not reviewed";
    return new Date(value).toLocaleDateString();
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">

      <div className="mx-auto max-w-4xl px-6 py-14">
        {params.success && (
          <div className="mb-6 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            Your subscription is now active! Welcome to Fee Insight.
          </div>
        )}

        {/* ── Welcome Header ── */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1A1815] text-[16px] font-bold text-white shrink-0">
              {userInitial}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-px w-6 bg-[#C44B2E]/40" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
                  {isPro ? "Pro Account" : "Free Account"}
                </span>
              </div>
              <h1
                className="mt-1 text-[1.5rem] sm:text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {user.institution_name || "Your Account"}
              </h1>
              <p className="mt-1 text-[13px] text-[#6B6255]">
                {user.email || user.username}
                {stateName && <> &middot; {stateName}</>}
                {districtName && <> &middot; District {district}</>}
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>

        <SubscriptionStatusNotice user={user} />

        {/* ── Saved institutions and fee alerts: what a free account is for, so it comes first ── */}
        <AlertsPanel userId={user.id} />

        {/* ── Subscription Status ── */}
        {!isPro && (
          <div className="rounded-xl border-2 border-[#C44B2E] bg-white/70 backdrop-blur-sm p-6 mb-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/60 to-transparent" />
            <div className="md:flex md:items-center md:justify-between">
              <div>
                <h2
                  className="text-[18px] font-medium text-[#1A1815]"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  Unlock the full platform
                </h2>
                <p className="text-[13px] text-[#6B6255] mt-1">
                  {pendingWorkspaceInvitations.length > 0
                    ? "Your email has been invited to an institution account. It includes up to five teammates, so you don't need to pay to join. Open the invite link the account owner sent you."
                    : "The full fee catalog, peer benchmarks, Hamilton analysis, data exports, and report workflows."}
                </p>
                {pendingWorkspaceInvitations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pendingWorkspaceInvitations.map((invitation) => (
                      <span
                        key={invitation.id}
                        className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"
                      >
                        {invitation.institutionName} · {invitation.role}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <a
                href={pendingWorkspaceInvitations.length > 0 ? "/workspace-invite" : "/subscribe"}
                className="mt-4 md:mt-0 inline-flex items-center gap-2 rounded-full bg-[#C44B2E] px-6 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-[#C44B2E]/15 hover:shadow-md hover:shadow-[#C44B2E]/25 transition-all flex-shrink-0 no-underline"
              >
                {pendingWorkspaceInvitations.length > 0 ? "Accept invitation" : "View Plans"}
                <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
        )}

        {isPro && (
          <div className="rounded-xl border border-[#E8DFD1] bg-white/70 backdrop-blur-sm p-5 mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                  Plan
                </span>
                <span className="text-[14px] font-medium text-[#1A1815]">Fee Insight Pro</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 uppercase">
                  Active
                </span>
              </div>
              {user.stripe_customer_id && <ManageBillingButton />}
            </div>
          </div>
        )}

        {/* ── Personalized Fee Insight ── */}
        {feeInsight && feeInsight.stateMedian !== null && feeInsight.nationalMedian !== null && (
          <div className="rounded-xl border border-[#E8DFD1] bg-white/70 backdrop-blur-sm p-5 mb-8">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C44B2E]/8 text-[#C44B2E]">
                <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                  Your State Insight
                </p>
                <p className="mt-1 text-[14px] text-[#1A1815]">
                  The median overdraft fee in{" "}
                  <span className="font-semibold">{stateName}</span> is{" "}
                  <span
                    className="font-semibold tabular-nums"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    {formatAmount(feeInsight.stateMedian)}
                  </span>
                  {" "}vs the national median of{" "}
                  <span className="tabular-nums">{formatAmount(feeInsight.nationalMedian)}</span>.
                  {feeInsight.stateMedian > feeInsight.nationalMedian
                    ? <span className="text-red-500 text-[12px] ml-1">+{(((feeInsight.stateMedian - feeInsight.nationalMedian) / feeInsight.nationalMedian) * 100).toFixed(0)}% above national</span>
                    : feeInsight.stateMedian < feeInsight.nationalMedian
                      ? <span className="text-emerald-600 text-[12px] ml-1">{(((feeInsight.stateMedian - feeInsight.nationalMedian) / feeInsight.nationalMedian) * 100).toFixed(0)}% below national</span>
                      : null
                  }
                </p>
                <p className="mt-1 text-[11px] text-[#6B6255]">
                  {VERIFIED_BENCHMARK_POLICY}; provisional rows are excluded from this benchmark.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Profile ── */}
        <div className="mb-8">
          <ProfileForm user={user} />
        </div>

        {isPro && (
          <div className="rounded-xl border border-[#E8DFD1] bg-white/70 backdrop-blur-sm p-5 mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                  Hamilton Context
                </p>
                <p className="mt-1 text-[15px] font-semibold text-[#1A1815] truncate">
                  {selectedInstitution?.name ?? "No selected institution"}
                </p>
                <p className="mt-1 text-[12px] text-[#6B6255]">
                  {selectedInstitution
                    ? `ID ${selectedInstitution.id} · ${selectedContextSourceLabel ?? "Selected"} · ${selectedInstitution.feePublicationLabel} · ${selectedInstitution.publishedFeeCount} verified / ${selectedInstitution.provisionalFeeCount} provisional · ${PROVISIONAL_ANALYSIS_POLICY}`
                    : "Set an institution once and Hamilton will carry it through Analyze, Reports, Scenarios, and Monitor."}
                </p>
                {selectedInstitution && (
                  <p className="mt-1 text-[11px] text-[#6B6255]">
                    Verified benchmark scores use approved rows only; provisional evidence stays labeled for directional analysis.
                  </p>
                )}
                {selectedMembership && (
                  <p className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                    Verified workspace {selectedMembership.role}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={hamiltonHref("/pro/settings")}
                  className="inline-flex items-center justify-center rounded-full border border-[#D8CDBD] px-4 py-2 text-[12px] font-semibold text-[#1A1815] no-underline hover:border-[#C44B2E]/40"
                >
                  Set Context
                </a>
                <a
                  href={hamiltonHref("/pro/analyze")}
                  className="inline-flex items-center justify-center rounded-full bg-[#1A1815] px-4 py-2 text-[12px] font-semibold text-white no-underline"
                >
                  Analyze
                </a>
              </div>
            </div>
          </div>
        )}

        {isPro && (
          <div className="rounded-xl border border-[#E8DFD1] bg-white/70 backdrop-blur-sm p-5 mb-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                  Institution Authority
                </p>
                <h2
                  className="mt-1 text-[18px] font-medium text-[#1A1815]"
                  style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                >
                  {institutionMemberships.length > 0
                    ? "Verified workspace access"
                    : "No verified institution authority yet"}
                </h2>
                <p className="mt-1 text-[13px] text-[#6B6255]">
                  Accepted claims grant workspace authority for Hamilton context, claim badges, and institution-specific workflows.
                </p>
              </div>
              <a
                href={hamiltonHref("/pro/settings")}
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#D8CDBD] px-4 py-2 text-[12px] font-semibold text-[#1A1815] no-underline hover:border-[#C44B2E]/40"
              >
                Manage Claims
              </a>
            </div>

            {institutionMemberships.length > 0 && (
              <div className="mt-4 grid gap-2">
                {institutionMemberships.slice(0, 3).map((membership) => (
                  <div
                    key={membership.id}
                    className="flex flex-col gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#1A1815]">
                        {membership.institutionName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6B6255]">
                        ID {membership.institutionId}
                        {[membership.city, membership.stateCode].filter(Boolean).length > 0
                          ? ` · ${[membership.city, membership.stateCode].filter(Boolean).join(", ")}`
                          : ""}{" "}
                        · {membership.role} · granted {formatDate(membership.grantedAt)}
                      </p>
                    </div>
                    <a
                      href={`/pro/analyze?instId=${membership.institutionId}`}
                      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#1A1815] px-3 py-1.5 text-[11px] font-semibold text-white no-underline"
                    >
                      Analyze
                    </a>
                  </div>
                ))}
              </div>
            )}

            {claimHistory.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                  Claim History
                </p>
                <div className="divide-y divide-[#E8DFD1] overflow-hidden rounded-lg border border-[#E8DFD1]">
                  {claimHistory.map((claim) => (
                    <div key={claim.id} className="grid gap-1 bg-white/60 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-[#1A1815]">
                          {claim.institutionName}
                        </p>
                        <p className="text-[11px] text-[#6B6255]">
                          Submitted {formatDate(claim.createdAt)}
                          {claim.reviewedAt ? ` · reviewed ${formatDate(claim.reviewedAt)}` : ""}
                          {claim.resolution ? ` · ${claim.resolution.replaceAll("_", " ")}` : ""}
                        </p>
                      </div>
                      <span className="inline-flex w-fit rounded-full border border-[#D8CDBD] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
                        {claim.reviewStatus.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
              Quick Actions
            </span>
            <span className="h-px flex-1 bg-[#E8DFD1]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <a
                key={action.label}
                href={action.href}
                className={`relative rounded-xl border bg-white/70 backdrop-blur-sm p-5 transition-all duration-300 group no-underline overflow-hidden ${
                  action.premium && !isPro
                    ? "border-[#E8DFD1] opacity-60"
                    : "border-[#E8DFD1]/80 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 hover:-translate-y-0.5"
                }`}
              >
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/0 to-transparent group-hover:via-[#C44B2E]/30 transition-all duration-700" />
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`h-6 w-6 mb-3 ${action.premium && !isPro ? "text-[#6B6255]" : "text-[#C44B2E]"}`}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={action.icon} />
                </svg>
                <div className="text-[14px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                  {action.label}
                  {action.premium && !isPro && <PremiumBadge />}
                </div>
                <div className="text-[12px] text-[#6B6255] mt-1">{action.description}</div>
              </a>
            ))}
          </div>
        </div>

        {/* ── API Access ── */}
        <div className="mb-8">
          <div className="rounded-xl border border-[#E8DFD1] bg-white/70 backdrop-blur-sm p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
                    API and Exports
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-600 uppercase">
                    Active
                  </span>
                </div>
                <p className="text-[13px] text-[#6B6255]">
                  REST endpoints and verified-only CSV exports are available now. Managed account API keys remain disabled in this account surface until key lifecycle and rate-limit ownership are reconciled.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href="/api-docs"
                  className="inline-flex items-center justify-center rounded-full border border-[#D8CDBD] px-3 py-1.5 text-[11px] font-semibold text-[#1A1815] no-underline hover:border-[#C44B2E]/40"
                >
                  API Docs
                </a>
                <a
                  href={isPro ? "/api/v1/fees?format=csv" : "/subscribe"}
                  className="inline-flex items-center justify-center rounded-full bg-[#1A1815] px-3 py-1.5 text-[11px] font-semibold text-white no-underline"
                >
                  {isPro ? "Export CSV" : "Upgrade to Export"}
                </a>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-[12px] text-[#6B6255] sm:grid-cols-3">
              <div className="rounded-lg border border-[#E8DFD1] bg-white/60 px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
                  API Docs
                </span>
                Public REST reference and OpenAPI schema.
              </div>
              <div className="rounded-lg border border-[#E8DFD1] bg-white/60 px-3 py-2">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
                  CSV Export
                </span>
                Pro export of verified-only fee medians.
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-amber-800">
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
                  API Keys
                </span>
                Not exposed until key storage, revocation, and usage ownership are aligned.
              </div>
            </div>
          </div>
        </div>
      </div>
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
