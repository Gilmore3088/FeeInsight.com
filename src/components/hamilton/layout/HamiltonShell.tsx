"use client";

import "./workspace.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import type { HamiltonAccountContext } from "@/lib/hamilton/account-context";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { setViewAsCustomer } from "@/app/pro/(hamilton)/view-as-actions";
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

/** Shared customer shell; route-aware identity remains server-derived. */
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
        className="hamilton-shell hamilton-workspace min-h-screen print:bg-white"
      >
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

        <WorkspaceNavigation
          pathname={pathname}
          isAdmin={isAdmin}
          accountLabel={accountContext?.status === "identified" && accountContext.institution
            ? accountContext.institution.name
            : accountContext?.status === "ambiguous" ? "Multiple memberships"
            : accountContext?.status === "unavailable" ? "Unavailable" : "Not linked"}
          researchLabel={(["/pro/hamilton", "/pro/intelligence"].includes(pathname) && !selection.research) ? "United States · market intelligence" : selection.research?.scope.kind === "national" ? "United States · market intelligence" : selection.research?.scope.kind === "state" ? `${selection.research.scope.stateCode} · market intelligence` : researchLabel}
        />

        {canUseSeed && institutionContext.makeDefaultHref ? (
          <div className="workspace-preference-note print:hidden">
            You&apos;re researching {institutionContext.name ?? "another institution"}; your saved research preference is unchanged.{" "}
            <Link href={institutionContext.makeDefaultHref} className="font-medium text-terra-text underline">
              Change research preference in Settings
            </Link>
          </div>
        ) : null}

        <main id="hamilton-content" className="workspace-content" tabIndex={-1}>{children}</main>
      </div>
      </HamiltonNavigationProvider>
    </SessionChromeProvider>
  );
}
