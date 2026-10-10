"use client";

import type { ReportClientGoal } from "@/lib/hamilton/report-goal";
import { useState, useEffect } from "react";
import Link from "next/link";
import { TemplateCard } from "./TemplateCard";
import { ConfigSidebar } from "./ConfigSidebar";
import { ReportOutput } from "./ReportOutput";
import { ReportBasketPanel } from "./ReportBasketPanel";
import { useReportBasket } from "@/components/hamilton/basket/AddToReportButton";
import { basketItemsFor } from "@/lib/hamilton/report-basket";
import { GeneratingState } from "./GeneratingState";
import { ReportLibrary } from "./ReportLibrary";
import { PRODUCT_NAME, RESEARCH_IMPRINT } from "@/lib/constants";
import { Callout, MemoHeader, MemoPage, MemoSection, SERIF } from "@/components/hamilton/memo/memo";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
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
}> = [
  {
    type: "peer_benchmarking",
    title: "How the research institution's fees compare with peers",
    description: "Each published fee set against the selected peer group, one fee at a time.",
  },
  {
    type: "regional_landscape",
    title: "Fees in the research institution's region",
    description: "What institutions in its state and Federal Reserve district charge, and how that differs from elsewhere.",
  },
  {
    type: "category_deep_dive",
    title: "One fee in detail",
    description: "A single fee: the range peers charge, the research institution's position, and how it has moved.",
  },
  {
    type: "competitive_positioning",
    title: "Where the research institution stands against competitors",
    description: "Which research institution fees sit above or below its competitors, across its published schedule.",
  },
];

/** Studies are their own pages (plain links), not report templates. */
const STUDIES: Array<{ href: string; title: string; description: string }> = [
  {
    href: "/pro/studies/market",
    title: "Study a new market",
    description: "Map a county you don't serve yet: who holds the deposits, their fees beside yours, and households.",
  },
  {
    href: "/pro/studies/merger",
    title: "Screen a merger",
    description: "Two banks side by side: where their branches meet, earnings, capital, local deposit share and fees.",
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
  const basketItems = basketItemsFor(useReportBasket(), selectedInstitution?.id?.toString() ?? null);
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
        // A raw server error is no use to a banker; the console keeps it for us.
        console.error("[reports] coverage check failed:", err);
        setPeerCoverageError("the coverage check didn't respond. Try again in a moment.");
      })
      .finally(() => {
        if (!cancelled) setIsPeerCoverageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTemplate, focusArea, selectedInstitution?.id, peerSetId]);

  function handleTemplateClick(type: ReportTemplateType) {
    // Selecting only: a second click on the chosen card used to clear it, which
    // silently disabled the write button.
    setSelectedTemplate(type);
  }

  function handleStartNewReport() {
    setGeneratedReport(null);
    setGeneratedReportId(null);
    setGeneratedReportType("");
    setGeneratedReportMetadata(null);
    setError(null);
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

  async function handleGenerate(override?: { template: ReportTemplateType; focus?: string | null }) {
    const template = override?.template ?? selectedTemplate;
    if (!template) return;
    const focus = override?.focus ?? focusArea;
    if (override) {
      setSelectedTemplate(override.template);
      if (override.focus) setFocusArea(override.focus);
    }
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
      templateType: template,
      dateFrom,
      dateTo: today,
      // focusArea is already a real fee_category key — no transform needed
      focusCategory: template === "category_deep_dive" ? focus : undefined,
      scenarioId: initialScenarioId ?? undefined,
      institutionId: selectedInstitution?.id,
      selectedInstitutionName: selectedInstitution?.name,
      peerSetId: peerSetId ?? undefined,
      evidencePolicy: "provisional-first",
      selectedSource,
      selectedSourceLabel,
      narrativeTone,
      addedFindings: basketItems,
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
      setGeneratedReportType(template);
      setGeneratedReportMetadata(result.artifactMetadata);
    } else {
      setError(result.error);
      // The banner sits at the top of the page; bring it into view so a failed run is never silent.
      setTimeout(() => document.getElementById("report-error")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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

  const setupVisible = !reportGenerated;

  return (
    <MemoPage>
      <MemoHeader
        kicker="Reports"
        title="Write a fee report for your board or team"
        dek="Choose a report and who will read it. Hamilton writes it from published fees, each verified against the institution's own schedule. It lays out the evidence; management makes the call."
        actions={
          reportGenerated ? (
            <>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isPdfExporting}
                className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-60"
              >
                {isPdfExporting ? "Preparing PDF…" : "Download PDF"}
              </button>
              <button
                type="button"
                onClick={handleStartNewReport}
                className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500"
              >
                Start a new report
              </button>
            </>
          ) : undefined
        }
      />

      {selectedInstitution && (
        <p className="-mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-700">
          <span className="font-medium text-warm-900">{selectedInstitution.name}</span>
          <span aria-hidden="true">·</span>
          <span>{selectedInstitution.feePublicationLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="[font-variant-numeric:tabular-nums]">
            {/* The report reads published fees only, so the header counts the same set. */}
            {selectedInstitution.publishedFeeCount.toLocaleString()} published fees
          </span>
          {selectedInstitution.assetSizeLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span>{selectedInstitution.assetSizeLabel} in assets</span>
            </>
          )}
        </p>
      )}

      {(error || pdfError) && (
        <div id="report-error" role="alert" className="rounded-md border border-terra bg-terra-soft px-4 py-3 text-sm text-terra-text">
          {error ?? pdfError}
        </div>
      )}

      {setupVisible && !isGenerating && basketItems.length > 0 && (
        <ReportBasketPanel
          items={basketItems}
          onBuild={() => {
            const categories = [...new Set(basketItems.map((item) => item.feeCategory).filter(Boolean))];
            void handleGenerate(
              categories.length === 1
                ? { template: "category_deep_dive", focus: categories[0] }
                : { template: "competitive_positioning" },
            );
          }}
        />
      )}

      {setupVisible && (
        <MemoSection title="Choose a report">
          {legacyPeerFilterLabel && (
            <Callout>
              This link carried older peer filters: <strong>{legacyPeerFilterLabel}</strong>. Reports now use saved peer
              groups so the same report can be run again; pick the matching group under &ldquo;Compare against&rdquo;
              before writing it.
            </Callout>
          )}

          <div role="radiogroup" aria-label="Report" className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.type}
                type={t.type}
                title={t.title}
                description={t.description}
                isSelected={selectedTemplate === t.type}
                onClick={() => handleTemplateClick(t.type)}
              />
            ))}
          </div>

          {/* Category picker — only for the one-fee report, so focusArea is always a
              real fee_category key the user chose. */}
          {selectedTemplate === "category_deep_dive" && (
            <div className="rounded-lg border border-warm-300 bg-warm-50 p-5">
              <p id="deep-dive-category" className="mb-3 text-sm font-medium text-warm-900">
                Which fee?
              </p>
              <div role="radiogroup" aria-labelledby="deep-dive-category" className="flex flex-wrap gap-1.5">
                {SPOTLIGHT.map((cat) => {
                  const isActive = focusArea === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => setFocusArea(cat)}
                      className={
                        "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                        (isActive
                          ? "border-warm-900 bg-warm-900 text-warm-ink-50"
                          : "border-warm-300 bg-white text-warm-700 hover:border-warm-500")
                      }
                    >
                      {getDisplayName(cat)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            onGenerate={() => handleGenerate()}
            peerCoveragePreview={peerCoveragePreview}
            isPeerCoverageLoading={isPeerCoverageLoading}
            peerCoverageError={peerCoverageError}
          />
        </MemoSection>
      )}

      {setupVisible && (
        <MemoSection title="Studies" note="Pages built straight from live data, ready to read on screen or print.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {STUDIES.map((study) => (
              <Link
                key={study.href}
                href={hrefWithInstitutionContext(study.href, selectedInstitution?.id?.toString() ?? null)}
                className="flex flex-col rounded-lg border border-warm-300 bg-warm-50 p-5 text-left no-underline hover:border-warm-500"
              >
                <span className="text-lg leading-snug text-warm-900" style={SERIF}>
                  {study.title}
                </span>
                <span className="mt-1.5 text-sm leading-relaxed text-pretty text-warm-700">{study.description}</span>
              </Link>
            ))}
          </div>
        </MemoSection>
      )}

      <div id="report-preview-section" className="flex scroll-mt-24 flex-col gap-4">
        {isGenerating && <GeneratingState />}

        {!isGenerating && reportGenerated && generatedReport && (
          <>
            <ReportOutput
              report={generatedReport}
              reportType={generatedReportType}
              artifactMetadata={generatedReportMetadata}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isPdfExporting}
                className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:opacity-60"
              >
                {isPdfExporting ? "Preparing PDF…" : "Download PDF"}
              </button>
              <button
                type="button"
                onClick={handleStartNewReport}
                className="rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500"
              >
                Start a new report
              </button>
            </div>
          </>
        )}
      </div>

      {/* The user's own saved reports. */}
      <ReportLibrary
        reports={savedReports}
        title="Your reports"
        subtitle="Reports Hamilton has written for you recently, saved so you can reopen or download them."
        emptyCopy="Reports you write here are saved in this list."
        getReportHref={(report) => `/pro/reports?report_id=${report.id}`}
        onViewReport={handleViewPublishedReport}
      />

      {publishedReports.length > 0 && (
        <ReportLibrary
          reports={publishedReports}
          title="Published reports"
          subtitle={`From ${RESEARCH_IMPRINT}, built on the ${PRODUCT_NAME}.`}
          onViewReport={handleViewPublishedReport}
        />
      )}
    </MemoPage>
  );
}
