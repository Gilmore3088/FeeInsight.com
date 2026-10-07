"use client";

import type { ReportClientGoal } from "@/lib/hamilton/report-goal";
import { useState, useEffect } from "react";
import { TemplateCard } from "./TemplateCard";
import { ConfigSidebar } from "./ConfigSidebar";
import { ReportOutput } from "./ReportOutput";
import { GeneratingState } from "./GeneratingState";
import { ReportLibrary } from "./ReportLibrary";
import {
  generateReport,
  loadActiveScenarios,
  loadScenarioById,
  previewReportPeerCoverage,
  type ReportTemplateType,
} from "@/app/pro/(hamilton)/reports/actions";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import type { ReportPeerCoveragePreview } from "@/lib/hamilton/report-evidence";
import type { HamiltonReportLibraryItem } from "@/lib/hamilton/pro-tables";
import { getSpotlightCategories, getDisplayName } from "@/lib/fee-taxonomy";
import type { HamiltonPeerSetOption } from "@/components/hamilton/PeerBaselineSelector";

type NarrativeTone = "consulting" | "academic" | "executive" | "technical";

const TEMPLATES: Array<{
  type: ReportTemplateType;
  title: string;
  description: string;
  tags: string[];
  icon: string;
}> = [
  {
    type: "peer_benchmarking",
    title: "Peer Benchmarking Report",
    description:
      "Compare your institution's fee schedule against your configured peer set with category-by-category analysis.",
    tags: ["Peer Analysis", "Comparative"],
    icon: "group_work",
  },
  {
    type: "regional_landscape",
    title: "Regional Fee Landscape",
    description:
      "Fee patterns across Federal Reserve districts and state-level pricing trends in your market.",
    tags: ["Geographic", "Market Intel"],
    icon: "map",
  },
  {
    type: "category_deep_dive",
    title: "Category Deep Dive",
    description:
      "Single fee category analysis: distribution, percentile positioning, peer comparison, and trend context.",
    tags: ["Focused", "Tactical"],
    icon: "analytics",
  },
  {
    type: "competitive_positioning",
    title: "Competitive Positioning",
    description:
      "Identify pricing power and vulnerability across your fee schedule relative to direct competitors.",
    tags: ["Strategy", "Competitive"],
    icon: "leaderboard",
  },
];

interface ReportWorkspaceProps {
  userId: number;
  /** Real institution name from server (audit H-4 round 2). */
  institutionName: string;
  publishedReports: Array<{
    id: string;
    institution_id: string | null;
    report_type: string;
    title: string;
    created_at: string;
    report_json: ReportSummaryResponse;
    artifact_metadata: ReportArtifactMetadata;
  }>;
  savedReports: HamiltonReportLibraryItem[];
  initialReport?: Pick<
    HamiltonReportLibraryItem,
    "id" | "report_type" | "report_json" | "artifact_metadata"
  > | null;
  initialScenarioId: string | null;
  selectedInstitution?: HamiltonSelectedInstitutionContext | null;
  initialIntent?: string | null;
  initialPeerSetId?: string | null;
  savedPeerSets: HamiltonPeerSetOption[];
  selectedSource?: HamiltonContextSource;
  selectedSourceLabel?: string | null;
  legacyPeerFilterLabel?: string | null;
}

function getInitialTemplateFromIntent(
  intent: string | null | undefined,
): ReportTemplateType | null {
  switch (intent) {
    case "competitive-brief":
    case "executive-briefing":
      return "competitive_positioning";
    case "peer-brief":
      return "peer_benchmarking";
    default:
      return null;
  }
}

export function ReportWorkspace({
  userId,
  institutionName,
  publishedReports,
  savedReports,
  initialReport,
  initialScenarioId,
  selectedInstitution,
  initialIntent,
  initialPeerSetId,
  savedPeerSets,
  selectedSource,
  selectedSourceLabel,
  legacyPeerFilterLabel,
}: ReportWorkspaceProps) {
  // Spotlight categories are the 6 most-used fees — the ones a banker is
  // most likely to want to drill into for Category Deep Dive. The default
  // is the first one (typically monthly_maintenance) so the focusArea is
  // always a real fee_category key, not a generic placeholder.
  const SPOTLIGHT = getSpotlightCategories();
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplateType | null>(() =>
    getInitialTemplateFromIntent(initialIntent),
  );
  const [focusArea, setFocusArea] = useState<string>(SPOTLIGHT[0] ?? "monthly_maintenance");
  const [narrativeTone, setNarrativeTone] = useState<NarrativeTone>("consulting");
  const [clientGoal, setClientGoal] = useState<ReportClientGoal>("balanced");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [generatedReport, setGeneratedReport] =
    useState<ReportSummaryResponse | null>(initialReport?.report_json ?? null);
  const [generatedReportType, setGeneratedReportType] = useState<string>(
    initialReport?.report_type ?? "",
  );
  const [generatedReportMetadata, setGeneratedReportMetadata] =
    useState<ReportArtifactMetadata | null>(initialReport?.artifact_metadata ?? null);
  const [generatedReportId, setGeneratedReportId] = useState<string | null>(initialReport?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [peerSetId, setPeerSetId] = useState<string | null>(initialPeerSetId ?? null);
  const [peerCoveragePreview, setPeerCoveragePreview] =
    useState<ReportPeerCoveragePreview | null>(null);
  const [isPeerCoverageLoading, setIsPeerCoverageLoading] = useState(false);
  const [peerCoverageError, setPeerCoverageError] = useState<string | null>(null);

  // Load scenarios on mount (kept for future scenario linking)
  useEffect(() => {
    loadActiveScenarios().catch(() => {});
  }, [userId]);

  // Scenario pre-fill: when arriving from /pro/simulate?scenario_id=X,
  // auto-select Category Deep Dive and pre-fill the focus area from the scenario's fee_category.
  useEffect(() => {
    if (!initialScenarioId) return;
    let cancelled = false;
    loadScenarioById(initialScenarioId).then((scenario) => {
      if (cancelled || !scenario) return;
      setSelectedTemplate("category_deep_dive");
      // focusArea is now a raw fee_category key (e.g. "monthly_maintenance")
      // — pass it through directly without the underscore-to-space transform
      // that the prior version did (which silently broke the lookup downstream).
      setFocusArea(scenario.fee_category);
      setPeerSetId(scenario.peer_set_id ?? null);
    });
    return () => { cancelled = true; };
  }, [initialScenarioId]);

  useEffect(() => {
    if (!selectedTemplate) {
      setPeerCoveragePreview(null);
      setPeerCoverageError(null);
      setIsPeerCoverageLoading(false);
      return;
    }

    let cancelled = false;
    setIsPeerCoverageLoading(true);
    setPeerCoverageError(null);

    previewReportPeerCoverage({
      templateType: selectedTemplate,
      focusCategory: selectedTemplate === "category_deep_dive" ? focusArea : undefined,
      institutionId: selectedInstitution?.id,
      peerSetId: peerSetId ?? undefined,
      evidencePolicy: "provisional-first",
    })
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPeerCoveragePreview(result.preview);
          setPeerCoverageError(null);
        } else {
          setPeerCoveragePreview(null);
          setPeerCoverageError(result.error);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPeerCoveragePreview(null);
        setPeerCoverageError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsPeerCoverageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, focusArea, selectedInstitution?.id, peerSetId]);

  function handleTemplateClick(type: ReportTemplateType) {
    setSelectedTemplate((prev) => (prev === type ? null : type));
  }

  function handlePeerSetChange(nextPeerSetId: string | null) {
    setPeerSetId(nextPeerSetId);
    setGeneratedReport(null);
    setGeneratedReportId(null);
    setGeneratedReportType("");
    setGeneratedReportMetadata(null);
    setError(null);
  }

  /**
   * Show a published report inline by loading its pre-built report_json into state.
   * No generation step required — reuses ReportOutput directly.
   */
  function handleViewPublishedReport(
    report: ReportSummaryResponse,
    reportType: string,
    artifactMetadata: ReportArtifactMetadata | null,
    reportId: string,
  ) {
    setGeneratedReport(report);
    setGeneratedReportId(reportId);
    setGeneratedReportType(reportType);
    setGeneratedReportMetadata(artifactMetadata);
    setError(null);
    setIsGenerating(false);
    // Scroll the preview area into view
    setTimeout(() => {
      const previewEl = document.getElementById("report-preview-section");
      if (previewEl) {
        previewEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  async function handleGenerate() {
    if (!selectedTemplate) return;
    setIsGenerating(true);
    setError(null);
    setGeneratedReport(null);
    setGeneratedReportId(null);
    setGeneratedReportMetadata(null);

    const today = new Date().toISOString().split("T")[0];
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const dateFrom = threeMonthsAgo.toISOString().split("T")[0];

    let result: Awaited<ReturnType<typeof generateReport>>;
    try {
      result = await generateReport({
      templateType: selectedTemplate,
      dateFrom,
      dateTo: today,
      // focusArea is already a real fee_category key — no transform needed
      focusCategory: selectedTemplate === "category_deep_dive" ? focusArea : undefined,
      scenarioId: initialScenarioId ?? undefined,
      institutionId: selectedInstitution?.id,
      selectedInstitutionName: selectedInstitution?.name,
      peerSetId: peerSetId ?? undefined,
      evidencePolicy: "provisional-first",
      selectedSource,
      selectedSourceLabel,
      narrativeTone,
      clientGoal,
    });
    } catch {
      result = { success: false, error: "Hamilton couldn't reach the server. Check your connection and try again." };
    } finally {
      setIsGenerating(false);
    }

    if (result.success) {
      setGeneratedReport(result.report);
      setGeneratedReportId(result.reportId);
      setGeneratedReportType(selectedTemplate);
      setGeneratedReportMetadata(result.artifactMetadata);
    } else {
      setError(result.error);
    }
  }

  async function handleExportPdf() {
    if (!generatedReport || !generatedReportId) return;
    setIsPdfExporting(true);
    setPdfError(null);
    try {
      const res = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "report", reportId: generatedReportId }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `hamilton-report-${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setPdfError("The PDF couldn't be created. Please try again.");
    } finally {
      setIsPdfExporting(false);
    }
  }

  const reportGenerated = generatedReport !== null;
  const selectedPeerSet = peerSetId
    ? savedPeerSets.find((peerSet) => String(peerSet.id) === peerSetId)
    : null;
  const defaultPeerSetLabel = selectedInstitution
    ? `${selectedInstitution.stateCode ?? "Regional"} ${selectedInstitution.charterType.replace(/_/g, " ")} peer default`
    : "Verified national index";
  const peerSetLabel = selectedPeerSet
    ? selectedPeerSet.name
    : peerSetId
      ? `Saved peer set #${peerSetId}`
      : defaultPeerSetLabel;

  return (
    <div className="min-w-0 pb-20 sm:px-6">
      {/* Page header */}
      <header className="mb-12">
        <h1 className="font-headline text-6xl italic tracking-tighter text-on-surface mb-2">
          Report
        </h1>
        <p
          className="font-body max-w-xl"
          style={{ color: "var(--hamilton-secondary)" }}
        >
          Turn verified fee data into board-ready narratives. Choose a report type,
          set the audience, and Hamilton writes it from your peer evidence.
        </p>
        {selectedInstitution && (
          <div
            className="mt-5 flex flex-wrap items-center gap-2 rounded-md px-4 py-3 text-xs"
            style={{
              backgroundColor: "var(--hamilton-surface-container-lowest)",
              border: "1px solid rgba(216,194,184,0.35)",
            }}
          >
            <span
              className="font-semibold"
              style={{ color: "var(--hamilton-on-surface)" }}
            >
              {selectedInstitution.name}
            </span>
            <span style={{ color: "var(--hamilton-secondary)" }}>
              {selectedInstitution.feePublicationLabel}
            </span>
            <span style={{ color: "var(--hamilton-secondary)" }}>
              {selectedInstitution.publishedFeeCount.toLocaleString()} verified
            </span>
            <span style={{ color: "var(--hamilton-secondary)" }}>
              {selectedInstitution.provisionalFeeCount.toLocaleString()} provisional
            </span>
            {selectedInstitution.assetSizeLabel && (
              <span style={{ color: "var(--hamilton-secondary)" }}>
                {selectedInstitution.assetSizeLabel} assets
              </span>
            )}
          </div>
        )}
      </header>

      {/* Error banner */}
      {(error || pdfError) && (
        <div
          role="alert"
          className="mb-8 p-4 text-sm border"
          style={{
            borderColor: "#dc2626",
            color: "#dc2626",
            backgroundColor: "rgba(220,38,38,0.05)",
          }}
        >
          {error ?? pdfError}
        </div>
      )}

      {/* Generate New Report — primary workflow above the fold (audit H-1).
          Page is named "Report Builder" — the build affordance must be the
          dominant action. Published library appears below as recent-history. */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-12 lg:items-start lg:gap-12">
        {/* Left: Template Gallery + Preview */}
        <section className="min-w-0 lg:col-span-8">
          {/* Section label — "Generate New Report" per D-02 */}
          <div className="mb-6">
            <h2
              className="font-sans text-[10px] uppercase tracking-[0.2em] text-primary"
            >
              Generate New Report
            </h2>
          </div>

          {legacyPeerFilterLabel && (
            <div
              className="mb-6 rounded-md border px-4 py-3 text-[12px] leading-relaxed"
              style={{
                borderColor: "rgba(133,77,14,0.22)",
                backgroundColor: "rgba(133,77,14,0.08)",
                color: "var(--hamilton-on-surface)",
              }}
            >
              Legacy peer filters detected: <strong>{legacyPeerFilterLabel}</strong>.
              Hamilton reports now use saved peer sets for repeatable board-ready
              outputs; select the matching peer set in the sidebar before generating.
            </div>
          )}

          {/* 2×2 template card grid */}
          <div
            role="radiogroup"
            aria-label="Report template"
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.type}
                type={t.type}
                title={t.title}
                description={t.description}
                tags={t.tags}
                icon={t.icon}
                isSelected={selectedTemplate === t.type}
                onClick={() => handleTemplateClick(t.type)}
              />
            ))}
          </div>

          {/* Category picker — only when Category Deep Dive is selected.
              Without this, focusArea defaulted to a placeholder ('Fee
              Benchmarking') that didn't match any real fee_category, so
              the action picked the first 9 categories — appearing 'random'.
              User now picks an actual fee. */}
          {selectedTemplate === "category_deep_dive" && (
            <div className="mt-6 p-5 rounded-md" style={{ backgroundColor: "var(--hamilton-surface-container-low)" }}>
              <label
                htmlFor="deep-dive-category"
                className="block text-[10px] uppercase tracking-[0.2em] mb-3"
                style={{ color: "var(--hamilton-secondary)" }}
              >
                Which fee category?
              </label>
              <div className="flex flex-wrap gap-2">
                {SPOTLIGHT.map((cat) => {
                  const isActive = focusArea === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFocusArea(cat)}
                      className="px-4 py-2 rounded-full text-[12px] transition-colors"
                      style={{
                        border: isActive
                          ? "1px solid var(--hamilton-primary)"
                          : "1px solid var(--hamilton-outline-variant, rgba(216,194,184,0.5))",
                        backgroundColor: isActive
                          ? "var(--hamilton-surface-container-lowest)"
                          : "transparent",
                        color: isActive
                          ? "var(--hamilton-on-surface)"
                          : "var(--hamilton-secondary)",
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {getDisplayName(cat)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Narrative Preview Section.
              Removed PREVIEW/BOARD/ANALYST/EXPORT tab strip — ReportOutput
              ignored activePreviewTab entirely so the tabs were cosmetic.
              The audience picker (sidebar) now covers what those tabs were
              trying to express; Export is its own button below the report. */}
          <div
            id="report-preview-section"
            className="mt-16 pt-12"
            style={{ borderTop: "1px solid rgba(216,194,184,0.2)" }}
          >
            {/* Generating overlay */}
            {isGenerating && <GeneratingState />}

            {/* Generated or published report output */}
            {!isGenerating && reportGenerated && generatedReport && (
              <ReportOutput
                report={generatedReport}
                reportType={generatedReportType}
                artifactMetadata={generatedReportMetadata}
              />
            )}

            {/* Empty-state hint (audit M-5 round 2) — small inline cue.
                Was a 12-padding card with quote + 2 paragraphs (~400px tall).
                Now ~80px: tells the user what to do, doesn't dominate. */}
            {!isGenerating && !reportGenerated && (
              <div
                className="flex items-center gap-3 text-sm py-3"
                style={{ color: "var(--hamilton-secondary)" }}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={{ color: "var(--hamilton-primary)", opacity: 0.6 }}
                  aria-hidden="true"
                >
                  arrow_upward
                </span>
                <span>
                  Pick a template above and click <strong style={{ color: "var(--hamilton-on-surface)" }}>Generate Intelligence</strong> to draft a report from your live fee data.
                </span>
              </div>
            )}

            {/* Export PDF — shown after generation */}
            {reportGenerated && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isPdfExporting}
                  className="burnished-cta text-white py-3 px-6 text-[10px] uppercase tracking-[0.3em] font-bold transition-transform active:scale-95"
                  style={{ opacity: isPdfExporting ? 0.7 : 1 }}
                >
                  {isPdfExporting ? "Preparing PDF..." : "Export PDF"}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Configuration sidebar — right side for now, moves to left rail in v8.2 */}
        <ConfigSidebar
          selectedTemplate={selectedTemplate}
          selectedInstitutionId={selectedInstitution?.id?.toString() ?? null}
          institutionName={institutionName}
          peerSetLabel={peerSetLabel}
          peerSetId={peerSetId}
          defaultPeerSetLabel={defaultPeerSetLabel}
          savedPeerSets={savedPeerSets}
          narrativeTone={narrativeTone}
          isGenerating={isGenerating}
          onPeerSetChange={handlePeerSetChange}
          onNarrativeToneChange={setNarrativeTone}
          clientGoal={clientGoal}
          onClientGoalChange={setClientGoal}
          onGenerate={handleGenerate}
          peerCoveragePreview={peerCoveragePreview}
          isPeerCoverageLoading={isPeerCoverageLoading}
          peerCoverageError={peerCoverageError}
        />
      </div>

      {/* Visual separator between generator and library */}
      <div
        className="mt-20 mb-12"
        style={{ borderTop: "1px solid rgba(216,194,184,0.2)" }}
      />

      {/* User-owned generated reports — reusable consulting artifacts. */}
      <ReportLibrary
        reports={savedReports}
        title="Your Reports"
        subtitle="Saved Hamilton consulting briefs and board-ready exports"
        emptyCopy="Generated reports will appear here after Hamilton saves them."
        getReportHref={(report) => `/pro/reports?report_id=${report.id}`}
        onViewReport={handleViewPublishedReport}
      />

      {/* Published Reports library — recent-history reference, below the
          generator (audit H-1 reordering). */}
      <ReportLibrary
        reports={publishedReports}
        title="Published Reports"
        subtitle="Curated Hamilton intelligence publications"
        onViewReport={handleViewPublishedReport}
      />
    </div>
  );
}
