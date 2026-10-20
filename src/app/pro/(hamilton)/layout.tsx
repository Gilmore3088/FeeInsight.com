import { decodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HamiltonPageSkeleton } from "@/components/hamilton/layout/HamiltonPageSkeleton";
import { cookies, headers } from "next/headers";
import { isViewAsCustomerCookie, VIEW_AS_CUSTOMER_COOKIE } from "@/lib/hamilton/view-as";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { HamiltonShell } from "@/components/hamilton/layout/HamiltonShell";
import { sessionChromeFor } from "@/lib/session-chrome";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import {
  getHamiltonArtifactContextLookup,
  resolveArtifactContextInstitutionId,
} from "@/lib/hamilton/artifact-context";
import { getHamiltonArtifactInstitutionId } from "@/lib/hamilton/artifact-context-store";
import { redirectWithoutPremium } from "@/lib/team-billing";
import { getActivePeerSet } from "@/lib/hamilton/peer-index";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { sql } from "@/lib/data-store/connection";
import { getPendingInstitutionLink } from "@/lib/pro-institution-link";

export const metadata: Metadata = {
  title: {
    default: "Hamilton",
    template: "%s | Hamilton",
  },
};

export default function HamiltonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<HamiltonPageSkeleton />}>
      <HamiltonLayoutInner>{children}</HamiltonLayoutInner>
    </Suspense>
  );
}

async function HamiltonLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // DB not available or session expired
  }

  if (!user || !canAccessPremium(user)) {
    // Nested layouts may resolve concurrently. Preserve the selection whichever
    // access gate redirects first, just as the outer /pro layout does.
    const requestHeaders = await headers();
    const returnTo = sanitizeInternalRedirect(
      requestHeaders.get("x-invoke-path") || requestHeaders.get("x-next-url") || requestHeaders.get("x-pathname") || "/pro/hamilton",
      "/pro/hamilton",
    );
    if (!user) redirect(`/login?from=${encodeURIComponent(returnTo)}`);
    // Same targets as the outer /pro layout: billing-issue, team-billing or /subscribe.
    await redirectWithoutPremium(user, returnTo);
  }

  const isAdmin = user.role === "admin" || user.role === "analyst";

  // Derive activeHref server-side from request headers so the initial HTML
  // contains the correct active nav state without waiting for client JS (SC-2).
  const headersList = await headers();
  const requestPath =
    headersList.get("x-invoke-path") ||
    headersList.get("x-next-url") ||
    headersList.get("x-pathname") ||
    "/pro/monitor";
  const pathname = requestPath.split("?")[0] || requestPath;
  const queryString = requestPath.includes("?") ? requestPath.split("?")[1] : "";
  const requestSearchParams = new URLSearchParams(queryString);
  const hasResearch = requestSearchParams.has("research");
  let research = null;
  try { research = decodeLandingResearch(requestSearchParams.get("research")); } catch { /* Page shows validation error. */ }
  const selectedInstId = hasResearch
    ? research?.scope.kind === "local" ? String(research.scope.institutionId) : null
    : requestSearchParams.get("instId");
  const selectedIntent = requestSearchParams.get("intent");
  const artifactLookup = hasResearch ? null : getHamiltonArtifactContextLookup({ pathname, searchParams: requestSearchParams });
  const savedArtifactRequested = artifactLookup?.kind === "analysis" || artifactLookup?.kind === "report"
    || (pathname === "/pro/simulate" && artifactLookup?.kind === "scenario");
  // null means the artifact is missing or unscoped (its page 404s). A failed read is different:
  // log it and let it reach the Pro error boundary, rather than open an unscoped shell (#975).
  const artifactInstitutionId = await getHamiltonArtifactInstitutionId({
    userId: user.id,
    lookup: artifactLookup,
  }).catch((error: unknown) => {
    console.error(
      "[hamilton-shell] saved artifact context read failed",
      { userId: user.id, kind: artifactLookup?.kind, artifactId: artifactLookup?.artifactId, pathname },
      error,
    );
    throw error;
  });
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: selectedInstId,
    artifactInstitutionId,
    preferArtifact: savedArtifactRequested,
  });
  const isArtifactContext = savedArtifactRequested || (!selectedInstId && Boolean(artifactInstitutionId));
  const { institution: selectedInstitution, source: selectedSource, isWorkspaceBank } =
    (hasResearch && !selectedInstId) || (savedArtifactRequested && !contextInstitutionId)
      ? { institution: null, source: "none" as const, isWorkspaceBank: false }
      : await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId: contextInstitutionId,
      intent: selectedIntent,
      persistUrlSelection: false,
      transientSource: isArtifactContext ? "artifact" : undefined,
    });
  const selectedInstitutionId = selectedInstitution?.id.toString() ?? null;
  const institutionContext = selectedInstitution
    ? {
        name: selectedInstitution.name,
        type: selectedInstitution.charterType,
        assetTier: selectedInstitution.assetTierLabel ?? selectedInstitution.assetTier,
        fedDistrict: selectedInstitution.fedDistrict,
        city: selectedInstitution.city,
        stateCode: selectedInstitution.stateCode,
        feesCheckedAt: selectedInstitution.latestSourceCollectedAt,
        makeDefaultHref:
          !hasResearch && isWorkspaceBank === false
            ? `/pro/settings?instId=${selectedInstitution.id}`
            : null,
        feePublicationLabel: selectedInstitution.feePublicationLabel,
        publishedFeeCount: selectedInstitution.publishedFeeCount,
        provisionalFeeCount: selectedInstitution.provisionalFeeCount,
        selectedSource,
        selectedFromUrl: selectedSource === "url",
      }
    : {
        name: null,
        type: null,
        assetTier: null,
        fedDistrict: null,
        stateCode: null,
        feePublicationLabel: null,
        publishedFeeCount: null,
        provisionalFeeCount: null,
        selectedSource: "none" as const,
        selectedFromUrl: false,
      };
  // The comparison group is the third context the bar names: the subject's active peer set, the
  // one Ask, Reports and the briefing read. Read beside the account; a failed read names no group.
  const [accountContext, activePeers] = await Promise.all([
    loadHamiltonAccountContext(user),
    selectedInstitution
      ? getActivePeerSet({ userId: user.id, institutionId: selectedInstitution.id }).then((set) => set ?? null, () => undefined)
      : Promise.resolve(undefined),
  ]);
  // No membership yet: the institution named at signup may be waiting for the admin check
  // (#1407). The bar names it as pending, as Settings does; it grants no access.
  const pendingLink = accountContext.status === "unlinked" ? await getPendingInstitutionLink(sql, user.id) : null;
  return (
    <HamiltonShell
      initialRequestPath={requestPath}
      isAdmin={isAdmin}
      session={sessionChromeFor(user)}
      viewAsCustomer={isAdmin && isViewAsCustomerCookie((await cookies()).get(VIEW_AS_CUSTOMER_COOKIE)?.value)}
      institutionContext={institutionContext}
      selectedInstitutionId={selectedInstitutionId}
      peerLabel={activePeers === undefined ? undefined : activePeers?.label ?? null}
      accountContext={accountContext}
      pendingInstitution={pendingLink ? { name: pendingLink.institutionName, needsInfo: pendingLink.needsInfo } : null}
    >
      {children}
    </HamiltonShell>
  );
}
