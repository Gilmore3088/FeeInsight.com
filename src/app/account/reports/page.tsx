export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { loadOwnReportLibrary } from "@/lib/account-reports";
import { ACCOUNT_REPORTS_PATH } from "@/lib/report-access";
import { UtilityHeading, UtilityShell } from "@/components/utility/utility-shell";
import { UTILITY_CARD, UTILITY_LINK, UTILITY_QUIET_LINK } from "@/components/utility/form-style";
import { SavedReportDownload } from "./saved-report-download";

export const metadata: Metadata = { title: "Your reports", robots: { index: false } };

const JOB_LABELS: Record<string, string> = {
  national_index: "National fee index report",
  state_index: "State fee index report",
  peer_brief: "Peer brief",
  monthly_pulse: "Monthly pulse",
};

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Read-only list of the signed-in account's own reports, outside the Pro shell, so an account
 * whose subscription ended can still view and download what it already has (James, 2026-10-20;
 * #1999). No start, re-run or edit controls here.
 */
export default async function AccountReportsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect(`/login?from=${encodeURIComponent(ACCOUNT_REPORTS_PATH)}`);

  const { jobs, saved } = await loadOwnReportLibrary(user.id);
  const empty = jobs.length === 0 && saved.length === 0;

  return (
    <UtilityShell width="wide">
      <UtilityHeading
        title="Your reports"
        lede="Every report you've made is yours to view and download, whether or not your subscription is active."
      />
      <div className={`${UTILITY_CARD} space-y-6`}>
        {empty ? (
          <p className="text-[15px] leading-relaxed text-ink-soft">
            You don&apos;t have any reports yet. Reports you make in Hamilton will show here.
          </p>
        ) : null}

        {saved.length > 0 ? (
          <section aria-labelledby="saved-reports">
            <h2 id="saved-reports" className="text-[15px] font-semibold text-ink">
              Hamilton reports
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {saved.map((report) => (
                <li key={report.id} className="flex items-start justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[15px] text-ink">{report.title}</span>
                    {shortDate(report.createdAt) ? (
                      <span className="block text-[13px] text-ink-muted">{shortDate(report.createdAt)}</span>
                    ) : null}
                  </span>
                  <SavedReportDownload reportId={report.id} title={report.title} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {jobs.length > 0 ? (
          <section aria-labelledby="report-files">
            <h2 id="report-files" className="text-[15px] font-semibold text-ink">
              Report files
            </h2>
            <ul className="mt-2 divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-start justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[15px] text-ink">{JOB_LABELS[job.reportType] ?? "Report"}</span>
                    {shortDate(job.completedAt) ? (
                      <span className="block text-[13px] text-ink-muted">{shortDate(job.completedAt)}</span>
                    ) : null}
                  </span>
                  <a href={job.downloadHref} className={`shrink-0 text-[14px] ${UTILITY_LINK}`}>
                    Download PDF
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-[14px] text-ink-soft">
          To make a new report, you need an active Hamilton subscription.{" "}
          <Link href="/account" className={UTILITY_QUIET_LINK}>
            Account and billing
          </Link>
        </p>
      </div>
    </UtilityShell>
  );
}
