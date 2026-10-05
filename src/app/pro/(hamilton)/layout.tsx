import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HamiltonPageSkeleton } from "@/components/hamilton/layout/HamiltonPageSkeleton";
import { cookies, headers } from "next/headers";
import { isViewAsCustomerCookie, VIEW_AS_CUSTOMER_COOKIE } from "@/lib/hamilton/view-as";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { HAMILTON_NAV } from "@/lib/hamilton/navigation";
import { HamiltonShell } from "@/components/hamilton/layout/HamiltonShell";
import { sql } from "@/lib/data-store/connection";
import { getSavedPeerSets } from "@/lib/data-store/saved-peers";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import {
  getHamiltonArtifactContextLookup,
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";
import { getHamiltonArtifactInstitutionId } from "@/lib/hamilton/artifact-context-store";

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
    // The /pro layout normally handles this first; never render a dead-end gate here.
    redirect("/subscribe?from=%2Fpro%2Fhamilton");
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
  const selectedInstId = requestSearchParams.get("instId");
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
    await resolveHamiltonInstitutionContext({
      userId: user.id,
      instId: contextInstitutionId,
      intent: selectedIntent,
      persistUrlSelection: shouldPersistUrlInstitutionSelection(selectedInstId),
      makeDefault: requestSearchParams.get("setBank") === "1",
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
          isWorkspaceBank === false
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
        name: user.institution_name,
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
  const activeHref =
    HAMILTON_NAV.find(
      (n) => pathname === n.href || pathname.startsWith(n.href + "/")
    )?.href ?? "/pro/monitor";

  // Fetch saved analyses for left rail — user-scoped (T-40-04)
  let savedAnalyses: Array<{
    id: string;
    title: string;
    analysis_focus: string;
    institution_id: string | null;
    updated_at: string;
  }> = [];
  try {
    const rows = await sql`
      SELECT id, title, analysis_focus, institution_id, updated_at
      FROM hamilton_saved_analyses
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    savedAnalyses = rows.map((r) => ({
      id: String(r.id),
      title: r.title as string,
      analysis_focus: r.analysis_focus as string,
      institution_id: r.institution_id == null ? null : String(r.institution_id),
      updated_at: String(r.updated_at),
    }));
  } catch {
    // Table may not have data yet — empty array is fine
  }

  // Fetch recent scenarios for left rail — user-scoped (T-40-04)
  let recentScenarios: Array<{
    id: string;
    fee_category: string;
    institution_id: string | null;
    updated_at: string;
  }> = [];
  try {
    const rows = await sql`
      SELECT id, fee_category, institution_id, updated_at
      FROM hamilton_scenarios
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    recentScenarios = rows.map((r) => ({
      id: String(r.id),
      fee_category: r.fee_category as string,
      institution_id: r.institution_id == null ? null : String(r.institution_id),
      updated_at: String(r.updated_at),
    }));
  } catch {
    // Table may not have data yet — empty array is fine
  }

  // Fetch pinned institutions (watchlist) for left rail (D-10)
  let pinnedInstitutions: Array<{ id: string; name: string }> = [];
  try {
    const rows = await sql`
      SELECT institution_ids
      FROM hamilton_watchlists
      WHERE user_id = ${user.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const ids = Array.isArray(rows[0]?.institution_ids)
      ? (rows[0].institution_ids as unknown[]).map((id) => String(id)).filter((id) => /^[1-9]\d*$/.test(id)).slice(0, 12)
      : [];
    if (ids.length > 0) {
      // One query for every name, in watchlist order.
      const nameRows = await sql`
        SELECT id::text AS id, institution_name
          FROM institution_sources
         WHERE id = ANY(${ids.map(Number)}::int[])
      `;
      const names = new Map(nameRows.map((row) => [String(row.id), String(row.institution_name)]));
      pinnedInstitutions = ids.map((id) => ({ id, name: names.get(id) ?? `Institution ${id}` }));
    }
  } catch {
    // Table may not have data yet — empty array is fine
  }

  // Fetch saved peer sets for left rail (D-11)
  let peerSets: Array<{ id: number; name: string }> = [];
  try {
    const sets = await getSavedPeerSets(String(user.id));
    peerSets = sets.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    // Empty is fine
  }

  return (
    <HamiltonShell
      user={user}
      isAdmin={isAdmin}
      viewAsCustomer={isAdmin && isViewAsCustomerCookie((await cookies()).get(VIEW_AS_CUSTOMER_COOKIE)?.value)}
      institutionContext={institutionContext}
      selectedInstitutionId={selectedInstitutionId}
      activeHref={activeHref}
      savedAnalyses={savedAnalyses}
      recentScenarios={recentScenarios}
      pinnedInstitutions={pinnedInstitutions}
      peerSets={peerSets}
    >
      {children}
    </HamiltonShell>
  );
}
