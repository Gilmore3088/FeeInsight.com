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
  type MarketReadiness,
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

      <ReportRulePanel markets={markets} />

      <EmailDeliveryPanel config={describeLeadEmailConfig()} defaultTo={user.email ?? ""} />

      <LeadsTable leads={leads} />
    </div>
  );
}

const charterLabel = (type: string) => (type === "credit_union" ? "credit unions" : "banks");

/** How many institutions could get an institution report today under James's rule. */
function ReportRulePanel({ markets }: { markets: MarketReadiness[] | null }) {
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
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        The rule: the institution has {RICH_MIN_CATEGORIES}+ of the {HEADLINE_FEE_KEYS.length} headline fees live, and{" "}
        {MIN_RICH_COMPETITORS}+ other institutions of its type in its state do too. Each request&apos;s report check also
        needs its local market (FDIC branch counties) to have enough data. Source document age is not checked yet.
      </p>
    </section>
  );
}
