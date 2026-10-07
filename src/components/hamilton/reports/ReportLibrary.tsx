"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { HamiltonReportLibraryItem } from "@/lib/hamilton/pro-tables";
import { SERIF } from "@/components/hamilton/memo/memo";
import { evidencePolicyLabel, reportTypeLabel } from "./report-labels";

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
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (days < 7) return ago(days, "day");
  if (days < 30) return ago(Math.floor(days / 7), "week");
  if (days < 365) return ago(Math.floor(days / 30), "month");
  return ago(Math.floor(days / 365), "year");
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

export function ReportLibrary({
  reports,
  title = "Published reports",
  subtitle,
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

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl text-warm-900 sm:text-2xl" style={SERIF}>
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-pretty text-sm text-warm-600">{subtitle}</p> : null}
      </div>
      {reports.length > 0 ? (
        <span className="shrink-0 text-sm text-warm-600 [font-variant-numeric:tabular-nums]">
          {reports.length} {reports.length === 1 ? "report" : "reports"}
        </span>
      ) : null}
    </div>
  );

  if (reports.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <p className="rounded-lg border border-dashed border-warm-300 px-5 py-4 text-sm text-warm-600">{emptyCopy}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {header}

      {downloadError && (
        <p role="alert" className="rounded-md border border-terra bg-terra-soft px-4 py-2 text-sm text-terra-text">
          {downloadError}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {reports.map((report) => {
          const typeLabel = reportTypeLabel(report.report_type);
          const isDownloading = downloadingId === report.id;
          const snippet = getCardSnippet(report.report_json);
          const snapshotCount = report.report_json.snapshot?.length ?? 0;

          return (
            <li key={report.id} className="flex flex-col rounded-lg border border-warm-300 bg-warm-50 p-5">
              <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-terra-text">{typeLabel}</span>
                <span className="shrink-0 text-xs text-warm-600" title={formatDate(report.created_at)}>
                  {formatRelative(report.created_at)}
                </span>
              </div>

              <h3 className="mb-2 text-lg leading-snug text-warm-900" style={SERIF}>
                {report.title}
              </h3>

              {snippet && <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-pretty text-warm-700">{snippet}</p>}

              <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
                {snapshotCount > 0 && (
                  <>
                    <span>
                      {snapshotCount} {snapshotCount === 1 ? "fee" : "fees"}
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>{formatDate(report.created_at)}</span>
                {report.artifact_metadata && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{evidencePolicyLabel(report.artifact_metadata.evidencePolicy)}</span>
                  </>
                )}
              </p>

              {report.artifact_metadata?.peerBaselineLabel && (
                <p
                  className="truncate text-xs text-warm-600"
                  title={[report.artifact_metadata.peerBaselineLabel, report.artifact_metadata.peerFallbackReason]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  Peer group: {report.artifact_metadata.peerBaselineLabel}
                </p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 text-sm">
                {getReportHref && (
                  <Link href={getReportHref(report)} className="font-medium text-terra-text underline-offset-2 hover:underline">
                    Open
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onViewReport(report.report_json, report.report_type, report.artifact_metadata ?? null, report.id)
                  }
                  className="font-medium text-terra-text underline-offset-2 hover:underline"
                >
                  Read here
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(report)}
                  disabled={isDownloading}
                  className="text-warm-700 underline-offset-2 hover:text-warm-900 hover:underline disabled:opacity-60"
                >
                  {isDownloading ? "Preparing PDF…" : "Download PDF"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
