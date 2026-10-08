import Link from "next/link";
import { formatAdminDateTime } from "@/lib/admin-time";
import type { FeedFreshness } from "@/lib/data-store/feed-freshness";

const FEED_LABELS: Record<string, string> = {
  "fdic-universe": "FDIC bank list",
  "fdic-financials": "FDIC call reports",
  "ncua-financials": "NCUA call reports",
  "fdic-sod": "FDIC branch deposits (SOD)",
  fred: "FRED economic series",
  "beige-book": "Fed Beige Book",
  "reg-news": "Regulator news",
  cfpb: "CFPB complaints",
  "sec-links": "SEC holding-company links",
  "sec-filings": "SEC filings",
  "state-regulators": "State regulators",
  "state-reg-news": "State regulator news",
  "state-bill-news": "News on state fee bills",
  enforcement: "OCC and Fed enforcement actions",
};

const CALL_REPORT_LABELS: Record<string, string> = {
  fdic: "FDIC call report figures",
  ncua: "NCUA call report figures",
  ffiec: "FFIEC call report figures",
};

const REPORT_LABELS: Record<string, string> = {
  "report_jobs:national_index": "National Quarterly report files",
  "report_jobs:monthly_pulse": "Monthly Pulse report files",
  "report_jobs:state_index": "State Index report files",
  published_reports: "Reports published to the public library",
  hamilton_reports: "Hamilton Pro reports saved by users",
  "run:atlas.daily_brief": "Daily brief email",
  "run:atlas.fee_alerts": "Fee alert emails",
  "run:atlas.lead_watch": "Lead watch",
  "run:atlas.scoreboard": "Pipeline scoreboard",
};

export function daysBetween(from: string | null, to: string): number | null {
  if (!from) return null;
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function ago(from: string | null, readAt: string): string {
  const days = daysBetween(from, readAt);
  if (days === null) return "never";
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function when(value: string | null): string {
  return value ? formatAdminDateTime(value) : "Never";
}

const cell = "px-2 py-1.5 align-top";
const head = "px-2 py-1.5 text-left text-[11px] font-medium text-gray-500 dark:text-gray-400";
const warn = "font-semibold text-red-700 dark:text-red-400";

/**
 * What data is coming in and what reports are going out, read live from the
 * registry ledger, the call-report table, report tables and scheduled runs.
 * Read-only: it shows dates and counts and changes nothing.
 */
export function DataFeedsPanel({ freshness }: { freshness: FeedFreshness }) {
  const { readAt, feeds, callReports, reports } = freshness;
  return (
    <section aria-label="Data feeds and reports" className="space-y-5">
      <div className="flex items-baseline justify-between">
        <p className="admin-section-title">Data coming in</p>
        <Link href="/admin/magellan/registry" className="text-xs font-semibold text-[var(--brand-primary)]">
          Registry details
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.08]">
              <th className={head}>Feed</th>
              <th className={head}>Newest period</th>
              <th className={head}>Last pulled</th>
              <th className={head}>Waiting or failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {feeds.map((feed) => (
              <tr key={feed.source}>
                <td className={cell}>{FEED_LABELS[feed.source] ?? feed.source}</td>
                <td className={`${cell} tabular-nums`}>{feed.latestPeriod ?? "None loaded"}</td>
                <td className={`${cell} tabular-nums`}>
                  {when(feed.lastSuccessAt)} <span className="admin-meta">({ago(feed.lastSuccessAt, readAt)})</span>
                </td>
                <td className={cell}>
                  {feed.failed > 0 ? (
                    <span className={warn} title={feed.lastError ?? undefined}>
                      {feed.failed} failed{feed.lastError ? `: ${feed.lastError.slice(0, 120)}` : ""}
                    </span>
                  ) : feed.scheduled > 0 ? (
                    `${feed.scheduled} waiting${feed.nextAttemptAt ? `, next ${when(feed.nextAttemptAt)}` : ""}`
                  ) : (
                    "None"
                  )}
                </td>
              </tr>
            ))}
            {callReports.map((source) => (
              <tr key={`call-${source.source}`}>
                <td className={cell}>{CALL_REPORT_LABELS[source.source] ?? `${source.source} call report figures`}</td>
                <td className={`${cell} tabular-nums ${source.behind ? warn : ""}`}>
                  {source.latestPeriod ? `Quarter ending ${source.latestPeriod}` : "None loaded"}
                  {source.behind ? " (behind other sources)" : ""}
                </td>
                <td className={`${cell} tabular-nums`}>
                  {when(source.lastFetchedAt)} <span className="admin-meta">({ago(source.lastFetchedAt, readAt)})</span>
                </td>
                <td className={cell}>Not in the registry ledger</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="admin-section-title">Reports going out</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.08]">
              <th className={head}>Report</th>
              <th className={head}>Made so far</th>
              <th className={head}>Last made</th>
              <th className={head}>Last result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {reports.map((report) => {
              const failed = report.lastStatus === "failed" || Boolean(report.lastError);
              return (
                <tr key={report.key}>
                  <td className={cell}>{REPORT_LABELS[report.key] ?? report.key}</td>
                  <td className={`${cell} tabular-nums`}>{report.count === null ? "Scheduled" : report.count.toLocaleString("en-US")}</td>
                  <td className={`${cell} tabular-nums`}>
                    {when(report.lastAt)} <span className="admin-meta">({ago(report.lastAt, readAt)})</span>
                  </td>
                  <td className={`${cell} ${failed ? warn : ""}`} title={report.lastError ?? undefined}>
                    {report.lastError ? report.lastError.slice(0, 120) : report.lastStatus ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="admin-meta">Read {when(readAt)}.</p>
    </section>
  );
}
