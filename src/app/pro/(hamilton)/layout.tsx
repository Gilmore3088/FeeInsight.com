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
import {
  getHamiltonArtifactContextLookup,
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";
import { getHamiltonArtifactInstitutionId } from "@/lib/hamilton/artifact-context-store";
import { subscribeReason } from "@/lib/subscribe-reason";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

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
  // Material Symbols stylesheet hoisted to root app/layout.tsx (was here, but
  // Next.js 16 streaming emitted it after the body painted, breaking icons on
  // first render — see audit C-1 2026-04-17).
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
    redirect(`/subscribe?from=${encodeURIComponent(returnTo)}&reason=${subscribeReason(user)}`);
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
  const artifactInstitutionId = await getHamiltonArtifactInstitutionId({
    userId: user.id,
    lookup: getHamiltonArtifactContextLookup({
      pathname,
      searchParams: requestSearchParams,
    }),
  }).catch(() => null);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: selectedInstId,
    artifactInstitutionId,
  });
  const isArtifactContext = !selectedInstId && Boolean(artifactInstitutionId);
  const { institution: selectedInstitution, source: selectedSource, isWorkspaceBank } =
    hasResearch && !selectedInstId ? { institution: null, source: "none" as const, isWorkspaceBank: false } : await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId: contextInstitutionId,
      intent: selectedIntent,
      persistUrlSelection: hasResearch ? false : shouldPersistUrlInstitutionSelection(selectedInstId),
      makeDefault: !hasResearch && requestSearchParams.get("setBank") === "1",
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
            ? `${pathname}?${(() => {
                const next = new URLSearchParams(requestSearchParams);
                next.set("setBank", "1");
                return next.toString();
              })()}`
            : null,
        feePublicationLabel: selectedInstitution.feePublicationLabel,
        publishedFeeCount: selectedInstitution.publishedFeeCount,
        provisionalFeeCount: selectedInstitution.provisionalFeeCount,
        selectedSource,
        selectedFromUrl: selectedSource === "url",
      }
    : {
        name: hasResearch ? "Market research" : user.institution_name,
        type: user.institution_type,
        assetTier: user.asset_tier,
        fedDistrict: user.fed_district ?? null,
        stateCode: user.state_code ?? null,
        feePublicationLabel: null,
        publishedFeeCount: null,
        provisionalFeeCount: null,
        selectedSource: user.institution_name ? ("profile" as const) : ("none" as const),
        selectedFromUrl: false,
      };
  return (
    <HamiltonShell
      isAdmin={isAdmin}
      session={sessionChromeFor(user)}
      viewAsCustomer={isAdmin && isViewAsCustomerCookie((await cookies()).get(VIEW_AS_CUSTOMER_COOKIE)?.value)}
      institutionContext={institutionContext}
      selectedInstitutionId={selectedInstitutionId}
    >
      {children}
    </HamiltonShell>
  );
}
