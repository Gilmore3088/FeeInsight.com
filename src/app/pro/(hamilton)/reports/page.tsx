// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";
// Report generation is a server action on this page: several Opus sections plus a
// figure-check retry can take minutes.
export const maxDuration = 300;

import { LandingResearchEntry } from "@/components/hamilton/landing/LandingResearchEntry";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getHamiltonReportById,
  getHamiltonScenarioById,
  getPublishedReports,
  getRecentHamiltonReports,
} from "@/lib/hamilton/pro-tables";
import { ReportWorkspace } from "@/components/hamilton/reports/ReportWorkspace";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { getHamiltonContextSourceLabel } from "@/lib/hamilton/context-source";
import { getSavedPeerSets } from "@/lib/data-store/saved-peers";
import { getActivePeerSet } from "@/lib/hamilton/active-peer-set";
import {
  resolveArtifactContextInstitutionId,
  shouldPersistUrlInstitutionSelection,
} from "@/lib/hamilton/artifact-context";
import { DISTRICT_NAMES, FDIC_TIER_LABELS } from "@/lib/fed-districts";

export const metadata: Metadata = { title: "Reports" };

function buildLegacyPeerFilterLabel(params: {
  legacyPeerFilters?: string;
  charter?: string;
  tier?: string;
  district?: string;
}): string | null {
  if (params.legacyPeerFilters !== "1") return null;

  const parts: string[] = [];
  if (params.charter === "bank") parts.push("Banks");
  if (params.charter === "credit_union") parts.push("Credit unions");

  const tiers = params.tier?.split(",").filter(Boolean) ?? [];
  if (tiers.length > 0) {
    parts.push(tiers.map((tier) => FDIC_TIER_LABELS[tier] || tier).join(", "));
  }

  const districts =
    params.district
      ?.split(",")
      .map(Number)
      .filter((district) => Number.isInteger(district) && district >= 1 && district <= 12) ?? [];
  if (districts.length > 0) {
    parts.push(
      districts
        .map((district) => `District ${district} (${DISTRICT_NAMES[district]})`)
        .join(", "),
    );
  }

  return parts.length > 0 ? parts.join(" / ") : "All institutions";
}

/**
 * ReportsPage — Server component that gates and hydrates the Reports memo page.
 * Auth enforced at the layout level (canAccessPremium), but we also verify here
 * to ensure server-side redirect on direct navigation.
 *
 * Reads ?scenario_id= URL param (Next.js 16 Promise-based searchParams pattern).
 * Loads published BFI-authored reports server-side for the library section.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    research?: string;
    scenario_id?: string;
    report_id?: string;
    report?: string;
    instId?: string;
    intent?: string;
    peerSetId?: string;
    legacyPeerFilters?: string;
    charter?: string;
    tier?: string;
    district?: string;
  }>;
}) {
  const params = await searchParams;
  if (params.research !== undefined) return <LandingResearchEntry raw={params.research} task="board_report" conflictingArtifact={Boolean(params.report_id || params.report || params.scenario_id)} />;
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const initialReportId = params.report_id ?? params.report ?? null;
  const [publishedReports, savedReports, savedScenario, initialReport] = await Promise.all([
    getPublishedReports().catch(() => []),
    getRecentHamiltonReports(user.id).catch(() => []),
    params.scenario_id
      ? getHamiltonScenarioById(params.scenario_id, user.id).catch(() => null)
      : null,
    initialReportId
      ? getHamiltonReportById(initialReportId, user.id).catch(() => null)
      : null,
  ]);
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: params.instId,
    artifactInstitutionId: initialReport?.institution_id ?? savedScenario?.institution_id,
  });
  const isArtifactContext = !params.instId && Boolean(contextInstitutionId);
  const {
    institution: selectedInstitution,
    source: selectedSource,
  } = initialReport?.report_type === "landing_research" && !initialReport.institution_id
    ? { institution: null, source: "url" as const }
    : await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: contextInstitutionId,
    intent: params.intent ?? "reports",
    persistUrlSelection: shouldPersistUrlInstitutionSelection(params.instId),
    transientSource: isArtifactContext ? "artifact" : undefined,
  });

  // The workspace's peer groups, and the one set to "Use for all charts" as the default baseline.
  const [savedPeerSets, activePeerSet] = await Promise.all([
    getSavedPeerSets(String(user.id), selectedInstitution?.id ?? null).catch(() => []),
    getActivePeerSet({ userId: user.id, institutionId: selectedInstitution?.id ?? null }).catch(() => null),
  ]);

  // Pull the user's real institution name (audit H-4 round 2) so the report
  // setup names it instead of a hardcoded "Your institution".
  const institutionName =
    selectedInstitution?.name ||
    user.institution_name?.trim() ||
    user.display_name ||
    "Your institution";

  return (
    <ReportWorkspace
      key={`${params.intent ?? ""}:${initialReport?.id ?? ""}`}
      userId={user.id}
      institutionName={institutionName}
      publishedReports={publishedReports}
      savedReports={savedReports}
      initialReport={initialReport}
      initialScenarioId={params.scenario_id ?? null}
      selectedInstitution={selectedInstitution}
      initialIntent={params.intent ?? null}
      initialPeerSetId={params.peerSetId ?? (activePeerSet ? String(activePeerSet.id) : null)}
      savedPeerSets={savedPeerSets}
      selectedSource={selectedSource}
      selectedSourceLabel={getHamiltonContextSourceLabel(selectedSource)}
      legacyPeerFilterLabel={buildLegacyPeerFilterLabel(params)}
    />
  );
}
