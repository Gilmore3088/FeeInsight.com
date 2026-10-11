// Auth-gated, renders live DB-backed data at request time; not statically prerendered.
export const dynamic = "force-dynamic";
// Report generation is a server action on this page: several Opus sections plus a
// figure-check retry can take minutes.
export const maxDuration = 300;

import { LandingResearchEntry } from "@/components/hamilton/landing/LandingResearchEntry";
import Link from "next/link";
import { BoardBriefEditor } from "@/components/hamilton/reports/BoardBriefEditor";
import { listSavedAnalyses, loadAnalysisRecord } from "../analyze/actions";
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
    from_analysis?: string;
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
  if (params.from_analysis) {
    if (params.report_id || params.report || params.scenario_id) return <p role="alert">Open the saved analysis separately from another artifact.</p>;
    const analysis = await loadAnalysisRecord(params.from_analysis);
    if (!analysis) return <p role="alert">Saved analysis not found or unavailable.</p>;
    return <BoardBriefEditor key={analysis.id} analysis={analysis.responseJson} analysisId={analysis.id} />;
  }
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
  if (initialReportId && !initialReport) {
    return <p role="alert">Saved report not found or unavailable.</p>;
  }
  if (initialReport?.report_type === "board_brief" && initialReport.report_json.boardBrief) {
    return <BoardBriefEditor key={initialReport.id} initialReport={initialReport.report_json} reportId={initialReport.id} metadata={initialReport.artifact_metadata} />;
  }
  if (!initialReportId && !params.scenario_id && !params.intent && !params.peerSetId) {
    const analyses = await listSavedAnalyses(10);
    return <div className="mx-auto flex max-w-5xl flex-col gap-8"><header><h1 className="text-3xl font-semibold">Reports</h1><p className="mt-2 text-warm-600">Turn saved research into a board brief. Edit, save and export your PDF.</p></header>
      <section className="intelligence-panel"><h2>Create a board brief</h2><p className="mt-2 text-sm text-warm-600">Choose an answer to reuse its findings and evidence. This makes no new AI request.</p><div className="ask-recent mt-3">{analyses.map(a => <Link key={a.id} href={`/pro/reports?from_analysis=${encodeURIComponent(a.id)}`}><span>{a.title}</span><span className="shrink-0 text-sm text-terra-text">Use this answer →</span></Link>)}</div>{analyses.length === 0 ? <Link href="/pro/analyze" className="mt-5 inline-block rounded bg-terra px-4 py-3 text-sm text-white no-underline">Start with Ask Hamilton</Link> : null}</section>
      <section><h2 className="text-lg font-semibold">Saved reports</h2><div className="ask-recent mt-3">{savedReports.map(r => <Link href={`/pro/reports?report_id=${encodeURIComponent(r.id)}`} key={r.id}><span>{r.report_json.title}</span><span className="text-xs text-warm-600">{r.created_at.slice(0,10)}</span></Link>)}</div>{savedReports.length === 0 ? <p className="mt-4 text-sm text-warm-600">Your saved reports will appear here.</p> : null}</section>
    </div>;
  }
  const contextInstitutionId = resolveArtifactContextInstitutionId({
    urlInstitutionId: params.instId,
    artifactInstitutionId: initialReport?.institution_id ?? savedScenario?.institution_id,
    preferArtifact: Boolean(initialReport),
  });
  const isArtifactContext = Boolean(initialReport) || (!params.instId && Boolean(contextInstitutionId));
  const {
    institution: selectedInstitution,
    source: selectedSource,
  } = initialReport && !initialReport.institution_id
    ? { institution: null, source: "artifact" as const }
    : await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: contextInstitutionId,
    intent: params.intent ?? "reports",
    persistUrlSelection: false,
    transientSource: isArtifactContext ? "artifact" : undefined,
  });

  // The workspace's peer groups, and the one set to "Use for all charts" as the default baseline.
  const [savedPeerSets, activePeerSet] = await Promise.all([
    getSavedPeerSets(String(user.id), selectedInstitution?.id ?? null).catch(() => []),
    getActivePeerSet({ userId: user.id, institutionId: selectedInstitution?.id ?? null }).catch(() => null),
  ]);

  // A free-text profile name cannot supply the numeric research subject used by
  // coverage or generation. The builder must display the same scope it submits.
  const institutionName = selectedInstitution?.name ?? "No research institution selected";

  return (
    <ReportWorkspace
      key={JSON.stringify([user.id, selectedInstitution?.id ?? null, params.intent ?? null, initialReport?.id ?? null])}
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
