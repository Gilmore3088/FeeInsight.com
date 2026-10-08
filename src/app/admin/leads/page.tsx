export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth";
import { describeLeadEmailConfig } from "@/lib/email/lead-notification";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getLeads } from "@/lib/admin-queries";
import type { LeadRow } from "@/lib/admin-queries";
import {
  HEADLINE_FEE_KEYS,
  MIN_RICH_COMPETITORS,
  RICH_MIN_CATEGORIES,
  countInstitutionsPassingReportRule,
  getMarketReadiness,
  listReportReadyWeeks,
  type MarketReadiness,
  type ReportReadyWeek,
} from "@/lib/data-store/market-readiness";
import { EmailDeliveryPanel } from "./email-delivery-panel";
import { LeadsTable } from "./leads-table";

export default async function LeadsPage() {
  const user = await requireAuth("view");

  let leads: LeadRow[] = [];
  try {
    leads = await getLeads();
  } catch {
    leads = [];
  }

  let markets: MarketReadiness[] | null = null;
  try {
    markets = await getMarketReadiness();
  } catch {
    markets = null;
  }

  let weeks: ReportReadyWeek[] | null = null;
  try {
    weeks = await listReportReadyWeeks();
  } catch {
    weeks = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Admin", href: "/admin" },
            { label: "Leads" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Leads
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {leads.length} lead{leads.length !== 1 ? "s" : ""} collected
        </p>
      </div>

      <ReportRulePanel markets={markets} weeks={weeks} />

      <EmailDeliveryPanel config={describeLeadEmailConfig()} defaultTo={user.email ?? ""} />

      <LeadsTable leads={leads} />
    </div>
  );
}

const charterLabel = (type: string) => (type === "credit_union" ? "credit unions" : "banks");

/** How many institutions could get an institution report today under James's rule. */
function ReportRulePanel({ markets, weeks }: { markets: MarketReadiness[] | null; weeks: ReportReadyWeek[] | null }) {
  const ready = (markets ?? []).filter((m) => m.ready).sort((a, b) => b.rich - a.rich);
  const closest = (markets ?? [])
    .filter((m) => !m.ready && m.rich > 0)
    .sort((a, b) => b.rich - a.rich)
    .slice(0, 3);
  const viaDistrict = (markets ?? [])
    .filter((m) => !m.ready && (m.richViaDistrict ?? 0) > 0)
    .sort((a, b) => (b.richViaDistrict ?? 0) - (a.richViaDistrict ?? 0));
  const viaDistrictTotal = viaDistrict.reduce((sum, m) => sum + (m.richViaDistrict ?? 0), 0);
  return (
    <section className="rounded-md border border-gray-200 p-4 text-sm dark:border-gray-800">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">Institution reports you can quote today</h2>
      {markets === null ? (
        <p className="mt-1 text-gray-500 dark:text-gray-400">The count could not be loaded.</p>
      ) : (
        <>
          <p className="mt-1 text-gray-700 dark:text-gray-300">
            <span className="text-lg font-bold tabular-nums">{countInstitutionsPassingReportRule(markets)}</span>{" "}
            institutions pass the report rule
            {ready.length > 0
              ? `: ${ready.map((m) => `${m.state_code} ${charterLabel(m.charter_type)} ${m.rich}`).join(", ")}.`
              : "."}
          </p>
          {viaDistrictTotal > 0 && (
            <p className="mt-1 text-gray-700 dark:text-gray-300">
              {viaDistrictTotal} of them on Fed district peers, where their state has too few:{" "}
              {viaDistrict.map((m) => `${m.state_code} ${charterLabel(m.charter_type)} ${m.richViaDistrict}`).join(", ")}.
            </p>
          )}
          {closest.length > 0 && (
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              Closest next: {closest.map((m) => `${m.state_code} ${charterLabel(m.charter_type)} ${m.rich}`).join(", ")}.
            </p>
          )}
        </>
      )}
      <ReportReadyWeeks weeks={weeks} />
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        The rule: the institution has {RICH_MIN_CATEGORIES}+ of the {HEADLINE_FEE_KEYS.length} headline fees live, and{" "}
        {MIN_RICH_COMPETITORS}+ other institutions of its type in its state do too, or in its Fed district when the
        state has too few. Each request&apos;s report check also
        needs its local market (FDIC branch counties) to have enough data. Source document age is not checked yet.
      </p>
    </section>
  );
}

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Week over week, from Atlas's daily scoreboard (the newest snapshot of each week). */
function ReportReadyWeeks({ weeks }: { weeks: ReportReadyWeek[] | null }) {
  if (weeks === null) {
    return <p className="mt-3 text-gray-500 dark:text-gray-400">The weekly history could not be loaded.</p>;
  }
  if (weeks.length === 0) {
    return (
      <p className="mt-3 text-gray-500 dark:text-gray-400">
        Week over week: Atlas starts recording this count with its next daily scoreboard.
      </p>
    );
  }
  return (
    <table className="mt-3 w-full max-w-lg text-left tabular-nums">
      <caption className="mb-1 text-left text-gray-700 dark:text-gray-300">Week over week</caption>
      <thead className="text-xs text-gray-500 dark:text-gray-400">
        <tr>
          <th className="py-1 pr-4 font-medium">Week of</th>
          <th className="py-1 pr-4 text-right font-medium">Pass the rule</th>
          <th className="py-1 pr-4 text-right font-medium">Change</th>
          <th className="py-1 text-right font-medium">On district peers</th>
        </tr>
      </thead>
      <tbody className="text-gray-700 dark:text-gray-300">
        {weeks.map((week, index) => {
          const previous = weeks[index + 1];
          const change = previous ? week.count.institutions - previous.count.institutions : null;
          return (
            <tr key={week.weekStart} className="border-t border-gray-100 dark:border-gray-800">
              <td className="py-1 pr-4">
                {shortDay(week.weekStart)}
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">(as of {shortDay(week.snapshotDate)})</span>
              </td>
              <td className="py-1 pr-4 text-right">{week.count.institutions.toLocaleString("en-US")}</td>
              <td className="py-1 pr-4 text-right">
                {change === null ? "\u2013" : `${change > 0 ? "+" : ""}${change.toLocaleString("en-US")}`}
              </td>
              <td className="py-1 text-right">{week.count.viaDistrict.toLocaleString("en-US")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
