import type { ReportFreshness } from "@/lib/data-store/feed-freshness";

/**
 * Everything Fee Insight publishes or sends on a schedule, with the cadence set in
 * vercel.json, when it last came out and when it is next due. "Last" is read from
 * the tables (report_jobs, published_reports, agent_runs); "next" is computed from
 * the cron schedule, never guessed from history.
 */

export type Audience = "Public" | "Clients" | "You";

export interface Publication {
  key: string;
  name: string;
  audience: Audience;
  cadence: string;
  /** Where it is managed in the console. */
  href: string;
  /** Freshness key from getReportFreshness. */
  freshnessKey: string;
  next: (now: Date) => Date;
}

function nextDaily(hourUtc: number, minute: number) {
  return (now: Date) => {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minute));
    if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1);
    return at;
  };
}

/** `weekday` 0 = Sunday, as in cron. */
function nextWeekly(weekday: number, hourUtc: number, minute: number) {
  return (now: Date) => {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minute));
    at.setUTCDate(at.getUTCDate() + ((weekday - at.getUTCDay() + 7) % 7));
    if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 7);
    return at;
  };
}

function nextMonthly(day: number, hourUtc: number, minute: number, months?: number[]) {
  return (now: Date) => {
    for (let offset = 0; offset < 13; offset += 1) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, hourUtc, minute));
      if (months && !months.includes(at.getUTCMonth() + 1)) continue;
      if (at.getTime() > now.getTime()) return at;
    }
    throw new Error("no next date within a year");
  };
}

/** Keep in step with vercel.json. */
export const PUBLICATIONS: Publication[] = [
  {
    key: "national_index",
    name: "National Fee Index",
    audience: "Public",
    cadence: "Quarterly, 5th of Jan, Apr, Jul, Oct",
    href: "/admin/hamilton/reports",
    freshnessKey: "report_jobs:national_index",
    next: nextMonthly(5, 14, 30, [1, 4, 7, 10]),
  },
  {
    key: "monthly_pulse",
    name: "Monthly Pulse",
    audience: "Public",
    cadence: "Monthly, on the 3rd",
    href: "/admin/hamilton/reports",
    freshnessKey: "report_jobs:monthly_pulse",
    next: nextMonthly(3, 14, 30),
  },
  {
    key: "morning_brief",
    name: "Morning brief email",
    audience: "You",
    cadence: "Daily, 7am Central",
    href: "/admin",
    freshnessKey: "run:atlas.daily_brief",
    next: nextDaily(12, 0),
  },
  {
    key: "fee_alerts",
    name: "Fee change alerts",
    audience: "Clients",
    cadence: "Daily",
    href: "/admin/atlas/details",
    freshnessKey: "run:atlas.fee_alerts",
    next: nextDaily(13, 23),
  },
  {
    // Growth drafts; James approves each and posts it on the company page himself.
    key: "linkedin_posts",
    name: "LinkedIn post drafts",
    audience: "Public",
    cadence: "Weekly, Sundays (drafts for your approval)",
    href: "/admin/customers/content",
    freshnessKey: "run:hamilton.content",
    next: nextWeekly(0, 13, 37),
  },
  {
    // Growth drafts on the 1st; nothing sends until James approves the month.
    key: "marketing_email",
    name: "Monthly marketing email",
    audience: "Public",
    cadence: "Monthly, drafted on the 1st, sent when you approve",
    href: "/admin/customers/marketing",
    freshnessKey: "run:hamilton.marketing",
    next: nextMonthly(1, 14, 7),
  },
];

export interface CalendarRow {
  publication: Publication;
  lastAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  count: number | null;
  nextAt: string;
}

export function buildPublishingCalendar(reports: ReportFreshness[], now = new Date()): CalendarRow[] {
  return PUBLICATIONS.map((publication) => {
    const freshness = reports.find((report) => report.key === publication.freshnessKey);
    return {
      publication,
      lastAt: freshness?.lastAt ?? null,
      lastStatus: freshness?.lastStatus ?? null,
      lastError: freshness?.lastError ?? null,
      count: freshness?.count ?? null,
      nextAt: publication.next(now).toISOString(),
    };
  });
}
