"use client";

import { Suspense } from "react";
import { SortableTable, type Column } from "@/components/sortable-table";
import { timeAgo } from "@/lib/format";
import type { ReportJob, ReportType } from "@/lib/report-engine/types";
import { ReportActions } from "./report-actions";

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  national_index: "National Index",
  state_index: "State Index",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600",
  assembling: "bg-blue-50 text-blue-600",
  rendering: "bg-blue-50 text-blue-600",
  complete: "bg-emerald-50 text-emerald-600",
  failed: "bg-red-50 text-red-600",
};

function getReportTitle(job: ReportJob): string {
  const typeLabel = REPORT_TYPE_LABELS[job.report_type] ?? job.report_type;
  if (job.report_type === "state_index" && job.params?.state_code) {
    return `${typeLabel} — ${job.params.state_code}`;
  }
  const year = new Date(job.created_at).getFullYear();
  const quarter = Math.ceil((new Date(job.created_at).getMonth() + 1) / 3);
  return `${typeLabel} Q${quarter} ${year}`;
}

type ReportRow = ReportJob & Record<string, unknown>;

export function ReportsTable({
  jobs,
  publishedJobIds,
}: {
  jobs: ReportJob[];
  publishedJobIds: string[];
}) {
  const publishedSet = new Set(publishedJobIds);
  if (jobs.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
        No report jobs yet. Use the controls above to generate a report.
      </div>
    );
  }

  const columns: Column<ReportRow>[] = [
    {
      key: "report_type",
      label: "Type",
      sortable: true,
      format: (_, row) => (
        <span className="text-gray-900 dark:text-gray-200 text-[12px] font-medium">
          {getReportTitle(row as unknown as ReportJob)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      format: (v) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASSES[v as string] ?? "bg-gray-50 text-gray-500"}`}
        >
          {v as string}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      format: (v) => (
        <span className="text-[12px] text-gray-500 dark:text-gray-400">
          {timeAgo(v as string)}
        </span>
      ),
    },
    {
      key: "completed_at",
      label: "Completed",
      sortable: true,
      format: (v) => (
        <span className="text-[12px] text-gray-500 dark:text-gray-400">
          {v ? timeAgo(v as string) : "\u2014"}
        </span>
      ),
    },
    {
      key: "error",
      label: "Error",
      sortable: false,
      format: (v) =>
        v ? (
          <span className="text-red-500 text-[11px] line-clamp-2" title={v as string}>
            {v as string}
          </span>
        ) : null,
    },
    {
      key: "id",
      label: "Actions",
      sortable: false,
      format: (_, row) => {
        const job = row as unknown as ReportJob;
        return <ReportActions job={job} title={getReportTitle(job)} isPublished={publishedSet.has(job.id)} />;
      },
    },
  ];

  return (
    <Suspense fallback={null}>
      <SortableTable
        columns={columns}
        rows={jobs as ReportRow[]}
        rowKey={(r) => r.id as string}
        defaultSort="created_at"
        defaultDir="desc"
        pageSize={50}
      />
    </Suspense>
  );
}
