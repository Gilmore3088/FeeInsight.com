"use client";

import { Suspense } from "react";
import { SortableTable, type Column } from "@/components/sortable-table";
import { timeAgo } from "@/lib/format";
import type { ReportJob } from "@/lib/report-engine/types";
import { getReportTitle } from "./report-title";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-600",
  assembling: "bg-blue-50 text-blue-600",
  rendering: "bg-blue-50 text-blue-600",
  complete: "bg-emerald-50 text-emerald-600",
  failed: "bg-red-50 text-red-600",
};

type ReportRow = ReportJob & Record<string, unknown>;

export function ReportsTable({
  jobs,
  actionsById,
}: {
  jobs: ReportJob[];
  /** Server-rendered action cells keyed by job id (functions cannot cross the client boundary). */
  actionsById: Record<string, React.ReactNode>;
}) {
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
      format: (_, row) => actionsById[(row as unknown as ReportJob).id] ?? null,
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
