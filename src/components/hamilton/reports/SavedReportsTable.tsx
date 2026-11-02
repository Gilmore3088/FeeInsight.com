"use client";

import { useState } from "react";
import Link from "next/link";
import { DashboardCard, FilterChips } from "@/components/hamilton/dashboard";
import { formatLocalDate, LocalDate } from "@/components/hamilton/common/LocalDate";
import type { HamiltonReportLibraryItem } from "@/lib/hamilton/pro-tables";
import type { ReportArtifactMetadata, ReportSummaryResponse } from "@/lib/hamilton/types";
import { SAVED_STATUS_LABEL, savedReportStatus, type SavedReportStatus } from "@/lib/hamilton/report-builder";
import { reportTypeLabel } from "./report-labels";
import { downloadReportPdf } from "./report-pdf-download";
import "./reports-dashboard.css";

const LONG_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

type Filter = "all" | SavedReportStatus;

function subLine(report: HamiltonReportLibraryItem): string {
  const peer = report.artifact_metadata?.peerBaselineLabel;
  if (report.report_json.boardBrief) return "From a saved answer";
  if (report.report_json.monthlyBriefing) return report.report_json.monthlyBriefing.monthLabel;
  return peer ? `Against ${peer}` : "";
}

/**
 * The user's saved reports as a table: type, status (as written, or edited with a team note or a
 * changed section), date, and Open / Read here / PDF on each row. Status chips filter the list.
 */
export function SavedReportsTable({
  reports,
  getReportHref,
  onViewReport,
}: {
  reports: HamiltonReportLibraryItem[];
  getReportHref: (report: HamiltonReportLibraryItem) => string;
  onViewReport: (report: ReportSummaryResponse, reportType: string, artifactMetadata: ReportArtifactMetadata | null, reportId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const withStatus = reports.map((report) => ({ report, status: savedReportStatus(report) }));
  const count = (s: SavedReportStatus) => withStatus.filter((r) => r.status === s).length;
  const shown = withStatus.filter((r) => filter === "all" || r.status === filter);

  async function download(report: HamiltonReportLibraryItem) {
    setDownloadingId(report.id);
    setDownloadError(null);
    try {
      const slug = report.title.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      await downloadReportPdf({ type: "report", reportId: report.id }, `hamilton-${slug}.pdf`);
    } catch {
      setDownloadError(`The PDF for "${report.title}" couldn't be created. Please try again.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <DashboardCard
      title="Your saved reports"
      titleId="saved-reports"
      actions={reports.length > 0 ? (
        <FilterChips<Filter>
          label="Show saved reports"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: reports.length },
            { value: "as_written", label: SAVED_STATUS_LABEL.as_written, count: count("as_written") },
            { value: "edited", label: SAVED_STATUS_LABEL.edited, count: count("edited") },
          ]}
        />
      ) : null}
      footnote={reports.length > 0 ? "Saved for 90 days. Edited: a team note was added or a section was changed." : undefined}
    >
      {downloadError ? <p role="alert" className="hd-card-note" style={{ color: "var(--fi-brick)" }}>{downloadError}</p> : null}
      {reports.length === 0 ? (
        <p className="hd-card-note">Reports you write here are saved in this list.</p>
      ) : (
        <div className="sr-table" role="table" aria-label="Your saved reports">
          <div className="sr-head" role="row">
            <span role="columnheader">Report</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Saved</span>
            <span role="columnheader"><span className="hd-sr">Actions</span></span>
          </div>
          {shown.length === 0 ? <p className="hd-card-note" style={{ padding: 8 }}>No saved report has this status.</p> : null}
          {shown.map(({ report, status }) => (
            <div key={report.id} className="sr-row" role="row">
              <span role="cell" className="min-w-0">
                <span className="sr-title">{report.title}</span>
                {subLine(report) ? <span className="sr-sub">{subLine(report)}</span> : null}
              </span>
              <span role="cell">{reportTypeLabel(report.report_type)}</span>
              <span role="cell"><span className={`sr-chip sr-chip--${status}`}>{SAVED_STATUS_LABEL[status]}</span></span>
              <span role="cell" className="hd-mono" title={formatLocalDate(report.created_at, { month: "long", day: "numeric", year: "numeric" }, "UTC")}>
                <LocalDate iso={report.created_at} options={LONG_DATE} />
              </span>
              <span role="cell" className="sr-actions">
                <Link href={getReportHref(report)} aria-label={`Open ${report.title}`}>Open</Link>
                <button type="button" aria-label={`Read ${report.title} here`} onClick={() => onViewReport(report.report_json, report.report_type, report.artifact_metadata ?? null, report.id)}>Read here</button>
                <button type="button" aria-label={`Download the PDF of ${report.title}`} onClick={() => download(report)} disabled={downloadingId === report.id}>
                  {downloadingId === report.id ? "Preparing PDF…" : "PDF"}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}
