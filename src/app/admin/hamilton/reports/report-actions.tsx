"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReportJob } from "@/lib/report-engine/types";
import { cancelReport, publishReport, retryReport } from "../actions";

/**
 * Row actions for a report job. A client component that calls the server actions
 * itself: a server page cannot hand a render function to the client table.
 */
export function ReportActions({ job, title, isPublished }: { job: ReportJob; title: string; isPublished: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {job.status === "complete" && (
        <a
          href={`/api/reports/${job.id}/download`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-[12px] font-medium transition-colors"
        >
          Preview PDF
        </a>
      )}

      {job.status === "complete" && !isPublished && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => publishReport(job.id, title, job.report_type, true))}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          Publish
        </button>
      )}

      {job.status === "complete" && isPublished && (
        <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">Published</span>
      )}

      {["pending", "assembling", "rendering"].includes(job.status) && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => cancelReport(job.id))}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      )}

      {job.status === "failed" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => retryReport(job.id))}
          className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors ml-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}
