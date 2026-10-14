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
  "census-acs": "Census income and population (ACS)",
  "irs-zip-income": "IRS income by ZIP code",
  "fomc-minutes": "FOMC minutes",
  "fed-publications": "Fed publications",
  "federal-bills": "Federal bills in Congress",
  "federal-register": "Federal Register rules",
  "wire-research": "Wire research notes",
  "ffiec-overdraft": "FFIEC overdraft and fee revenue",
  "ncua-branches": "NCUA branch list",
  "ncua-branch-geocode": "NCUA branch locations",
  "state-bills": "State fee bills",
  "state-enforcement": "State enforcement actions",
};

/** The Data room's sections, top to bottom; a feed not listed here lands in Other. */
export const FEED_GROUPS = [
  { key: "national", title: "National: banks and credit unions", note: "FDIC, NCUA, FFIEC and SEC" },
  { key: "oversight", title: "National: rules, regulators and news", note: "Congress, Federal Register, enforcement, CFPB" },
  { key: "economy", title: "Economy and markets", note: "FRED, Fed, Census and IRS" },
  { key: "state", title: "State", note: "fee bills, enforcement, regulators and news" },
  { key: "other", title: "Other", note: "feeds not yet sorted into a section" },
] as const;

const FEED_GROUP_OF: Record<string, (typeof FEED_GROUPS)[number]["key"]> = {
  "fdic-universe": "national",
  "fdic-financials": "national",
  "ncua-financials": "national",
  "fdic-sod": "national",
  "sec-links": "national",
  "sec-filings": "national",
  "ffiec-overdraft": "national",
  "ncua-branches": "national",
  "ncua-branch-geocode": "national",
  "federal-bills": "oversight",
  "federal-register": "oversight",
  "wire-research": "oversight",
  "reg-news": "oversight",
  enforcement: "oversight",
  cfpb: "oversight",
  fred: "economy",
  "beige-book": "economy",
  "fomc-minutes": "economy",
  "fed-publications": "economy",
  "census-acs": "economy",
  "irs-zip-income": "economy",
  "state-regulators": "state",
  "state-reg-news": "state",
  "state-bills": "state",
  "state-enforcement": "state",
  "state-bill-news": "state",
};

export function feedGroup(source: string): (typeof FEED_GROUPS)[number]["key"] {
  return FEED_GROUP_OF[source] ?? "other";
}

const CALL_REPORT_LABELS: Record<string, string> = {
  fdic: "FDIC call report figures",
  ncua: "NCUA call report figures",
  ffiec: "FFIEC call report figures",
};

/**
 * The registry feed that loads each call-report source's figures
 * (institution_financial_records.source -> registry_ingest_partitions.source). Matched figures
 * show on their feed's row, so one feed never appears twice with two statuses.
 */
export const CALL_REPORT_FEED: Record<string, string> = {
  fdic: "fdic-financials",
  ncua: "ncua-financials",
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

function snapshotAge(readAt: string, now: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(readAt)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "1 minute old" : `${minutes} minutes old`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour old" : `${hours} hours old`;
}

function when(value: string | null): string {
  return value ? formatAdminDateTime(value) : "Never";
}

// On a phone each row stacks into a short card: the first cell is its title, the others
// carry their column name inline, so dates no longer squeeze into four narrow columns.
const cell = "block px-2 py-0.5 align-top sm:table-cell sm:py-1.5";
const titleCell = "block px-2 pt-2 font-medium align-top sm:table-cell sm:py-1.5 sm:font-normal";
const row = "block py-1 sm:table-row sm:py-0";
const head = "px-2 py-1.5 text-left text-[11px] font-medium text-gray-500 dark:text-gray-400";
const headRow = "hidden border-b border-black/[0.06] sm:table-row dark:border-white/[0.08]";
const table = "block w-full text-sm sm:table";
const body = "block divide-y divide-black/[0.06] sm:table-row-group dark:divide-white/[0.06]";

/** The column name, shown in front of a value only when the row is stacked (phone). */
function PhoneLabel({ children }: { children: string }) {
  return <span className="admin-meta sm:hidden">{children}: </span>;
}
const warn = "font-semibold text-red-700 dark:text-red-400";

/**
 * What data is coming in and what reports are going out, read live from the
 * registry ledger, the call-report table, report tables and scheduled runs.
 * Read-only: it shows dates and counts and changes nothing.
 */
export function DataFeedsPanel({ freshness, now }: { freshness: FeedFreshness; now?: string }) {
  const { readAt, feeds, callReports, reports } = freshness;
  const figuresFor = (feedSource: string) => callReports.find((report) => CALL_REPORT_FEED[report.source] === feedSource);
  const unmatched = callReports.filter((report) => !feeds.some((feed) => feed.source === CALL_REPORT_FEED[report.source]));
  return (
    <section aria-label="Data feeds and reports" className="space-y-5">
      <p className="text-sm text-gray-700 dark:text-gray-200">
        Snapshot read <span className="font-semibold">{when(readAt)}</span>
        {now ? <span className="font-semibold"> ({snapshotAge(readAt, now)})</span> : null}
        <span className="admin-meta">; it refreshes every five minutes.</span>
      </p>
      <div className="flex items-baseline justify-between">
        <p className="admin-section-title">Data coming in</p>
        <Link href="/admin/magellan/registry" className="text-xs font-semibold text-[var(--brand-primary)]">
          Registry details
        </Link>
      </div>
      {FEED_GROUPS.map((group) => {
        const groupFeeds = feeds.filter((feed) => feedGroup(feed.source) === group.key);
        const groupCalls = group.key === "national" ? unmatched : [];
        if (groupFeeds.length === 0 && groupCalls.length === 0) return null;
        const failed = groupFeeds.filter((feed) => feed.failed > 0).length;
        return (
          <details key={group.key} open className="group rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {group.title}
                <span className="admin-meta ml-2 font-normal">{group.note}</span>
              </span>
              <span className={`text-xs ${failed > 0 ? warn : "admin-meta"}`}>
                {groupFeeds.length + groupCalls.length} {groupFeeds.length + groupCalls.length === 1 ? "feed" : "feeds"}
                {failed > 0 ? ` · ${failed} failing` : ""}
              </span>
            </summary>
            <div className="overflow-x-auto px-1 pb-2">
              <table className={table}>
                <thead>
                  <tr className={headRow}>
                    <th className={head}>Feed</th>
                    <th className={head}>Newest period</th>
                    <th className={head}>Last pulled</th>
                    <th className={head}>Waiting or failed</th>
                  </tr>
                </thead>
                <tbody className={body}>
                  {groupFeeds.map((feed) => {
                    const figures = figuresFor(feed.source);
                    return (
                      <tr key={feed.source} className={row}>
                        <td className={titleCell}>{FEED_LABELS[feed.source] ?? feed.source}</td>
                        <td className={`${cell} tabular-nums`}>
                          <PhoneLabel>Newest period</PhoneLabel>
                          {feed.latestPeriod ?? "None loaded"}
                          {figures?.latestPeriod ? (
                            <span className={`block text-xs ${figures.behind ? warn : "admin-meta"}`}>
                              Figures through {figures.latestPeriod}
                              {figures.behind ? " (behind other sources)" : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className={`${cell} tabular-nums`}>
                          <PhoneLabel>Last pulled</PhoneLabel>
                          {when(feed.lastSuccessAt)} <span className="admin-meta">({ago(feed.lastSuccessAt, readAt)})</span>
                        </td>
                        <td className={cell}>
                          <PhoneLabel>Waiting or failed</PhoneLabel>
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
                    );
                  })}
                  {groupCalls.map((source) => (
                    <tr key={`call-${source.source}`} className={row}>
                      <td className={titleCell}>{CALL_REPORT_LABELS[source.source] ?? `${source.source} call report figures`}</td>
                      <td className={`${cell} tabular-nums ${source.behind ? warn : ""}`}>
                        <PhoneLabel>Newest period</PhoneLabel>
                        {source.latestPeriod ? `Quarter ending ${source.latestPeriod}` : "None loaded"}
                        {source.behind ? " (behind other sources)" : ""}
                      </td>
                      <td className={`${cell} tabular-nums`}>
                        <PhoneLabel>Last pulled</PhoneLabel>
                        {when(source.lastFetchedAt)} <span className="admin-meta">({ago(source.lastFetchedAt, readAt)})</span>
                      </td>
                      <td className={cell}>No registry feed loads this source, so it has no ledger status</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}

      <p className="admin-section-title">Reports going out</p>
      <div className="overflow-x-auto">
        <table className={table}>
          <thead>
            <tr className={headRow}>
              <th className={head}>Report</th>
              <th className={head}>Made so far</th>
              <th className={head}>Last made</th>
              <th className={head}>Last result</th>
            </tr>
          </thead>
          <tbody className={body}>
            {reports.map((report) => {
              const failed = report.lastStatus === "failed" || Boolean(report.lastError);
              return (
                <tr key={report.key} className={row}>
                  <td className={titleCell}>{REPORT_LABELS[report.key] ?? report.key}</td>
                  <td className={`${cell} tabular-nums`}><PhoneLabel>Made so far</PhoneLabel>{report.count === null ? "Scheduled" : report.count.toLocaleString("en-US")}</td>
                  <td className={`${cell} tabular-nums`}>
                    <PhoneLabel>Last made</PhoneLabel>
                    {when(report.lastAt)} <span className="admin-meta">({ago(report.lastAt, readAt)})</span>
                  </td>
                  <td className={`${cell} ${failed ? warn : ""}`} title={report.lastError ?? undefined}>
                    <PhoneLabel>Last result</PhoneLabel>
                    {report.lastError ? report.lastError.slice(0, 120) : report.lastStatus ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
