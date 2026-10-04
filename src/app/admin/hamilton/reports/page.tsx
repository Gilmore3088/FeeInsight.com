import { getSql } from "@/lib/data-store/connection";
import type { ReportJob } from "@/lib/report-engine/types";
import { getReportTitle } from "./report-title";
import { ReportControls } from "../report-controls";
import { publishReport, retryReport, cancelReport, cancelAllPending } from "../actions";
import { ReportsTable } from "./reports-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Hamilton Reports — Admin" };

// T-16-12: validate filter params against explicit allowlists
const VALID_STATUSES = new Set([
  "pending", "assembling", "rendering", "complete", "failed",
  "cancel_requested", "cancelled",
]);
const VALID_TYPES = new Set<string>(["national_index", "state_index", "peer_brief", "monthly_pulse"]);

const REPORT_TYPE_LABELS: Record<string, string> = {
  national_index: "National Index",
  state_index: "State Index",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
};

export default async function HamiltonReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const statusFilter = params.status && VALID_STATUSES.has(params.status) ? params.status : null;
  const typeFilter = params.type && VALID_TYPES.has(params.type) ? params.type : null;

  const sql = getSql();

  // Fetch jobs with optional filters
  const jobs = await sql<ReportJob[]>`
    SELECT id, report_type, status, params, artifact_key, error, created_at, completed_at, user_id, data_manifest
    FROM report_jobs
    ${statusFilter ? sql`WHERE status = ${statusFilter}` : sql``}
    ${typeFilter && !statusFilter ? sql`WHERE report_type = ${typeFilter}` : typeFilter ? sql`AND report_type = ${typeFilter}` : sql``}
    ORDER BY created_at DESC
    LIMIT 100
  `.catch(() => [] as ReportJob[]);

  // Fetch published_reports to mark which jobs are already published
  const publishedRows = await sql<Array<{ job_id: string }>>`
    SELECT job_id FROM published_reports
  `.catch(() => [] as Array<{ job_id: string }>);

  const publishedJobIds = publishedRows.map((r) => r.job_id);
  const publishedSet = new Set(publishedJobIds);
  const actionsById: Record<string, React.ReactNode> = Object.fromEntries(
    jobs.map((job) => [
      job.id,
      <ReportActions key={job.id} job={job} title={getReportTitle(job)} isPublished={publishedSet.has(job.id)} />,
    ]),
  );

  return (
    <div className="space-y-6">
      {/* Generation controls -- client component */}
      <ReportControls publishedJobIds={publishedJobIds} />

      {/* Jobs table */}
      <div>
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 shrink-0">
            Report Jobs
          </h2>

          {/* Filter form */}
          <form method="GET" className="flex items-center gap-2 ml-auto">
            <select
              name="status"
              defaultValue={statusFilter ?? ""}
              className="text-[11px] border border-gray-200 dark:border-white/[0.08] rounded px-2 py-1 bg-white dark:bg-white/[0.04] text-gray-700 dark:text-gray-300"
            >
              <option value="">All statuses</option>
              {Array.from(VALID_STATUSES).map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <select
              name="type"
              defaultValue={typeFilter ?? ""}
              className="text-[11px] border border-gray-200 dark:border-white/[0.08] rounded px-2 py-1 bg-white dark:bg-white/[0.04] text-gray-700 dark:text-gray-300"
            >
              <option value="">All types</option>
              {Array.from(VALID_TYPES).map((t) => (
                <option key={t} value={t}>
                  {REPORT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="text-[11px] px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.07] text-gray-700 dark:text-gray-300 font-medium transition-colors"
            >
              Filter
            </button>
            {(statusFilter || typeFilter) && (
              <a
                href="/admin/hamilton/reports"
                className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                Clear
              </a>
            )}
          </form>
          <form
            action={async () => {
              "use server";
              await cancelAllPending();
            }}
          >
            <button
              type="submit"
              className="text-[11px] px-2.5 py-1 rounded border border-red-200 bg-white hover:bg-red-50 dark:border-red-800 dark:bg-white/[0.04] dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 font-medium transition-colors"
            >
              Cancel All Pending
            </button>
          </form>
        </div>

        <ReportsTable
          jobs={jobs}
          actionsById={actionsById}
        />
      </div>
    </div>
  );
}

function ReportActions({ job, title, isPublished }: { job: ReportJob; title: string; isPublished: boolean }) {
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
                <form
                  action={async () => {
                    "use server";
                    await publishReport(job.id, title, job.report_type, true);
                  }}
                >
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  >
                    Publish
                  </button>
                </form>
              )}

              {job.status === "complete" && isPublished && (
                <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                  Published
                </span>
              )}

              {["pending", "assembling", "rendering"].includes(job.status) && (
                <form
                  action={async () => {
                    "use server";
                    await cancelReport(job.id);
                  }}
                >
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[11px] font-medium rounded bg-gray-500 text-white hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {job.status === "failed" && (
                <form
                  action={async () => {
                    "use server";
                    await retryReport(job.id);
                  }}
                >
                  <button
                    type="submit"
                    className="px-2.5 py-1 text-[11px] font-medium rounded bg-red-600 text-white hover:bg-red-700 transition-colors ml-2"
                  >
                    Retry
                  </button>
                </form>
              )}
            </div>
  );
}
