"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonReportLibraryItem } from "@/lib/hamilton/pro-tables";

type ReportLibraryItem = HamiltonReportLibraryItem;

interface ReportLibraryProps {
  reports: ReportLibraryItem[];
  title?: string;
  subtitle?: string;
  emptyCopy?: string;
  getReportHref?: (report: ReportLibraryItem) => string;
  onViewReport: (
    report: ReportSummaryResponse,
    reportType: string,
    artifactMetadata: ReportArtifactMetadata | null,
    reportId: string,
  ) => void;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  quarterly_strategy: "Quarterly Report",
  monthly_pulse: "Monthly Pulse",
  state_index: "Regional Analysis",
  peer_brief: "Peer Brief",
  peer_benchmarking: "Peer Benchmarking",
  regional_landscape: "Regional Landscape",
  category_deep_dive: "Category Deep Dive",
  competitive_positioning: "Competitive Positioning",
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Pull a 1-2 sentence preview from the report JSON for card display. */
function getCardSnippet(json: ReportSummaryResponse): string {
  if (json.executiveSummary?.length) {
    return json.executiveSummary[0].replace(/\*\*/g, "").trim();
  }
  if (json.strategicRationale) {
    return json.strategicRationale.replace(/\*\*/g, "").trim().split(". ")[0] + ".";
  }
  return "";
}

function formatPolicy(policy: ReportArtifactMetadata["evidencePolicy"]): string {
  if (policy === "verified-only") return "Verified only";
  if (policy === "source-diligence") return "Source diligence";
  return "Provisional first";
}

export function ReportLibrary({
  reports,
  title = "Published Reports",
  subtitle = "Curated Hamilton intelligence publications",
  emptyCopy = "No published reports available yet.",
  getReportHref,
  onViewReport,
}: ReportLibraryProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownloadPdf(report: ReportLibraryItem) {
    setDownloadingId(report.id);
    setDownloadError(null);
    try {
      const res = await fetch("/api/pro/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "report", reportId: report.id }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = report.title.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      a.href = url;
      a.download = `hamilton-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(`The PDF for "${report.title}" couldn't be created. Please try again.`);
    } finally {
      setDownloadingId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <section className="mb-16">
        <div className="mb-6">
          <h2
            className="font-headline text-3xl italic text-on-surface mb-1"
          >
            {title}
          </h2>
          <p
            className="text-xs"
            style={{ color: "var(--hamilton-secondary)" }}
          >
            {subtitle}
          </p>
        </div>
        <p
          className="text-sm"
          style={{ color: "var(--hamilton-secondary)" }}
        >
          {emptyCopy}
        </p>
      </section>
    );
  }

  return (
    <section className="mb-16">
      {/* Section header with report count. */}
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-headline text-3xl italic text-on-surface mb-1">
            {title}
          </h2>
          <p
            className="text-xs"
            style={{ color: "var(--hamilton-secondary)" }}
          >
            {subtitle}
          </p>
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: "var(--hamilton-secondary)" }}
        >
          {reports.length} {reports.length === 1 ? "report" : "reports"}
        </span>
      </div>

      {downloadError && (
        <p role="alert" className="mb-4 text-sm" style={{ color: "#b91c1c" }}>
          {downloadError}
        </p>
      )}

      {/* Report card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reports.map((report) => {
          const typeLabel =
            REPORT_TYPE_LABELS[report.report_type] ?? report.report_type;
          const isDownloading = downloadingId === report.id;
          const snippet = getCardSnippet(report.report_json);
          const snapshotCount = report.report_json.snapshot?.length ?? 0;

          return (
            <article
              key={report.id}
              className="bg-surface-container-lowest p-6 editorial-shadow hover:shadow-md transition-shadow flex flex-col"
            >
              {/* Top row: report type badge + relative time (audit H-2) */}
              <div className="flex items-baseline justify-between mb-3 gap-3">
                <span
                  className="text-[10px] uppercase tracking-[0.2em] font-semibold text-primary"
                >
                  {typeLabel}
                </span>
                <span
                  className="text-[10px] tabular-nums shrink-0"
                  style={{ color: "var(--hamilton-secondary)" }}
                  title={formatDate(report.created_at)}
                >
                  {formatRelative(report.created_at)}
                </span>
              </div>

              {/* Title */}
              <h3 className="font-headline text-xl italic text-on-surface mb-3 leading-tight">
                {report.title}
              </h3>

              {/* Snippet (audit H-3) — first sentence of executive summary */}
              {snippet && (
                <p
                  className="text-sm leading-relaxed mb-4 line-clamp-2"
                  style={{ color: "var(--hamilton-secondary)" }}
                >
                  {snippet}
                </p>
              )}

              {/* Metadata row — snapshot count (peer rows covered) + full date */}
              <div
                className="flex flex-wrap items-center gap-3 mb-5 text-[11px] tabular-nums"
                style={{ color: "var(--hamilton-secondary)" }}
              >
                {snapshotCount > 0 && (
                  <span>
                    {snapshotCount} fee {snapshotCount === 1 ? "category" : "categories"}
                  </span>
                )}
                {snapshotCount > 0 && <span aria-hidden="true">·</span>}
                <span>{formatDate(report.created_at)}</span>
                {report.artifact_metadata && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatPolicy(report.artifact_metadata.evidencePolicy)}</span>
                    {report.artifact_metadata.selectedSourceLabel && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{report.artifact_metadata.selectedSourceLabel}</span>
                      </>
                    )}
                  </>
                )}
              </div>

              {report.artifact_metadata?.peerBaselineLabel && (
                <p
                  className="mb-5 truncate text-[11px]"
                  title={[
                    report.artifact_metadata.peerBaselineLabel,
                    report.artifact_metadata.peerFallbackReason,
                  ].filter(Boolean).join(" · ")}
                  style={{ color: "var(--hamilton-secondary)" }}
                >
                  Baseline: {report.artifact_metadata.peerBaselineLabel}
                </p>
              )}

              {/* Action buttons — pinned to bottom for consistent card heights */}
              <div className="flex items-center gap-6 mt-auto">
                {getReportHref && (
                  <Link
                    href={getReportHref(report)}
                    className="text-primary text-xs uppercase tracking-widest font-bold hover:opacity-70 transition-opacity no-underline"
                  >
                    Open
                  </Link>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onViewReport(
                      report.report_json,
                      report.report_type,
                      report.artifact_metadata ?? null,
                      report.id,
                    )
                  }
                  className="text-primary text-xs uppercase tracking-widest font-bold hover:opacity-70 transition-opacity"
                >
                  Read
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadPdf(report)}
                  disabled={isDownloading}
                  className="flex items-center gap-1.5 text-xs uppercase tracking-widest transition-opacity hover:opacity-70"
                  style={{
                    color: "var(--hamilton-secondary)",
                    opacity: isDownloading ? 0.5 : 1,
                  }}
                  aria-label={isDownloading ? "Preparing PDF" : "Download PDF"}
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    download
                  </span>
                  <span>{isDownloading ? "Preparing..." : "PDF"}</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
