"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import type { HamiltonAccountContext } from "@/lib/hamilton/account-context";
import "@/brand/tokens/tokens.css";
import "@/brand/styles/fee-insight.css";
import { NavAccount } from "@/components/nav-account";
import { SearchTrigger } from "@/components/search-trigger";
import { SkipLink } from "@/components/public/skip-link";
import { HamiltonSidebar } from "./HamiltonSidebar";
import { setViewAsCustomer } from "@/app/pro/(hamilton)/view-as-actions";
import { HamiltonAskDock } from "./HamiltonAskDock";
import { SearchModal } from "@/components/public/search-modal";
import { SessionChromeProvider, type SessionChrome } from "@/components/use-session-chrome";
import { hamiltonNavigationSelection, isHamiltonSubjectPath } from "@/lib/hamilton/navigation-context";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { loadHamiltonNavigationInstitution } from "@/lib/hamilton/navigation-institution-action";
import { HamiltonNavigationProvider } from "./hamilton-navigation-context";

interface HamiltonShellProps {
  initialRequestPath: string;
  isAdmin: boolean;
  /** The signed-in user as the header needs it, read by the layout so the Pro nav shows on first paint. */
  session: SessionChrome;
  /** Admin is previewing the customer experience */
  viewAsCustomer?: boolean;
  institutionContext: {
    name: string | null;
    type: string | null;
    assetTier: string | null;
    fedDistrict: number | null;
    city?: string | null;
    stateCode?: string | null;
    feesCheckedAt?: string | null;
    makeDefaultHref?: string | null;
    feePublicationLabel?: string | null;
    publishedFeeCount?: number | null;
    provisionalFeeCount?: number | null;
    selectedSource?: HamiltonContextSource;
    selectedFromUrl?: boolean;
  };
  selectedInstitutionId?: string | null;
  accountContext?: Pick<HamiltonAccountContext, "status" | "institution">;
  children: React.ReactNode;
}

/**
 * HamiltonShell - Client component.
 * Outer shell wrapper applying .hamilton-shell CSS isolation boundary.
 * Composes: the left navigation, admin bar (admins only), the institution bar, the page, and the
 * docked Ask bar. Layout follows James's Oct 15 mockups on the Fee Insight design system (#1285);
 * it replaces the Oct 6 single-header shell.
 * Per D-13, ARCH-01: .hamilton-shell class scopes all editorial design tokens.
 * Per D-10: admin mode bar shown only to admin/analyst users.
 */
export function HamiltonShell({
  initialRequestPath,
  isAdmin,
  session,
  viewAsCustomer = false,
  institutionContext,
  selectedInstitutionId,
  accountContext,
  children,
}: HamiltonShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const requestPath = `${pathname}${search ? `?${search}` : ""}`;
  const [initialPath, initialQuery = ""] = initialRequestPath.split("?");
  const isInitialRoute = requestPath === `${initialPath}${initialQuery ? `?${new URLSearchParams(initialQuery)}` : ""}`;
  const [routeVersion, setRouteVersion] = useState({ path: requestPath, generation: 0 });
  if (routeVersion.path !== requestPath) {
    setRouteVersion({ path: requestPath, generation: routeVersion.generation + 1 });
  }
  const requestKey = JSON.stringify([requestPath, routeVersion.generation]);
  const canUseSeed = isInitialRoute && routeVersion.generation === 0;
  const selection = hamiltonNavigationSelection(pathname, new URLSearchParams(search));
  const seedId = normalizeCanonicalInstitutionId(selectedInstitutionId);
  const canResolveLive = isHamiltonSubjectPath(pathname) && !selection.artifact && !selection.invalid
    && (!selection.research || selection.research.scope.kind === "local");
  const seededInstitution = canUseSeed && !selection.invalid && seedId && institutionContext.name
    && (selection.artifact || !selection.institutionId || selection.institutionId === seedId)
    ? { id: seedId, name: institutionContext.name } : null;
  const [resolved, setResolved] = useState<{ requestKey: string; institution: { id: string; name: string } | null } | null>(null);
  const candidateId = selection.institutionId;
  const seededName = seededInstitution?.name;
  useEffect(() => {
    if (!canResolveLive || seededName) return;
    let active = true;
    loadHamiltonNavigationInstitution(candidateId).then((institution) => {
      if (active) setResolved({ requestKey, institution });
    }).catch(() => { if (active) setResolved({ requestKey, institution: null }); });
    return () => { active = false; };
  }, [candidateId, requestKey, seededName, canResolveLive]);
  const currentInstitution = seededInstitution ?? (resolved?.requestKey === requestKey
    && (!candidateId || resolved.institution?.id === candidateId) ? resolved.institution : null);
  const navigation = {
    ...selection,
    // An explicit URL is navigation intent, not a confirmed identity. Preserve it
    // while metadata loads so the destination resolves B rather than default A.
    institutionId: currentInstitution?.id ?? (selection.artifact ? null : selection.institutionId),
    unresolved: canResolveLive && !currentInstitution,
  };
  const researchLabel = selection.invalid ? "Research selection unavailable"
    : currentInstitution?.name
    ?? (selection.artifact ? canUseSeed && institutionContext.name ? institutionContext.name : "Saved artifact · original research context shown below"
    : canResolveLive
      ? resolved?.requestKey === requestKey ? "Research subject unavailable" : "Research subject is being resolved"
      : selection.research ? "Market research" : "Research selection unavailable");
  return (
    <SessionChromeProvider value={session}>
      <HamiltonNavigationProvider value={navigation}>
      <div
        className="hamilton-shell min-h-screen bg-[var(--fi-paper)] print:bg-white"
      >
        {/* display: contents keeps the navigation out of the shell's page-reveal animation, which
            would otherwise fade and shift the phone drawer each time it opens. */}
        <div className="contents">
          <SkipLink />
          <HamiltonSidebar />
        </div>
        <div className="min-w-0 lg:pl-60">
        {/* Admin mode bar - only for admin/analyst users (T-40-05) */}
        {isAdmin && (
          <div className="bg-warm-900 text-white flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs print:hidden">
            <span className="text-gray-400">
              {viewAsCustomer
                ? "Viewing as a customer: Hamilton answers exactly as a paying customer sees it"
                : "Admin view: Hamilton answers with pipeline detail"}
            </span>
            <span className="flex items-center gap-4">
              <form action={setViewAsCustomer}>
                <input type="hidden" name="mode" value={viewAsCustomer ? "admin" : "customer"} />
                <button type="submit" className="text-blue-400 hover:text-blue-300 font-medium">
                  {viewAsCustomer ? "Back to admin view" : "View as customer"}
                </button>
              </form>
              <Link
                href="/admin"
                className="text-blue-400 hover:text-blue-300 font-medium no-underline"
              >
                Back to Admin
              </Link>
            </span>
          </div>
        )}

        {/* The signed-in institution, kept apart from the institution being researched (design brief). */}
        <div className="flex min-h-14 items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--fi-border)] bg-[var(--fi-surface-0)] px-4 py-2 sm:px-8 print:hidden">
          <div aria-label="Institution context" className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            <p className="text-[var(--fi-muted)]">
              Your institution:{" "}
              <span className="font-semibold text-[var(--fi-ink)]">{accountLabel(accountContext)}</span>
              <span className="sr-only">.</span>
            </p>
            <p className="text-[var(--fi-muted)]">
              Researching: <span className="text-[var(--fi-ink)]">{researchLabel}</span>
              <span className="sr-only">.</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span suppressHydrationWarning className="hidden text-sm text-[var(--fi-muted)] sm:inline">{todayLabel()}</span>
            <SearchTrigger />
            <NavAccount />
          </div>
        </div>

        {canUseSeed && institutionContext.makeDefaultHref ? (
          <div className="border-b border-warm-300 bg-warm-150 px-4 py-2 text-center text-sm text-warm-800 print:hidden">
            You&apos;re researching {institutionContext.name ?? "another institution"}; your saved research preference is unchanged.{" "}
            <Link href={institutionContext.makeDefaultHref} className="font-medium text-terra-text underline">
              Change research preference in Settings
            </Link>
          </div>
        ) : null}

        <main id="main-content" className="mx-auto min-w-0 max-w-page px-4 pb-32 pt-8 sm:px-8 lg:pt-10 print:max-w-none print:p-0">{children}</main>
        </div>

        {/* Ask Hamilton, docked on every screen */}
        <HamiltonAskDock selectedInstitutionId={navigation.institutionId} navigationContext={navigation} />

        {/* The header's Search button and Cmd/Ctrl+K open this; the public layout mounts its own. */}
        <SearchModal />
      </div>
      </HamiltonNavigationProvider>
    </SessionChromeProvider>
  );
}

function accountLabel(accountContext: HamiltonShellProps["accountContext"]): string {
  if (!accountContext) return "not linked";
  if (accountContext.status === "identified" && accountContext.institution) return accountContext.institution.name;
  if (accountContext.status === "ambiguous") return "multiple memberships; none selected";
  if (accountContext.status === "unavailable") return "unavailable";
  return "not linked";
}

/** "October 15, 2026", the date the workspace is read on. */
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
