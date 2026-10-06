export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import {
  getFeeCategoryDetail,
  type DimensionBreakdown,
} from "@/lib/data-store";
import { formatAmount } from "@/lib/format";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  getDisplayName,
  getFeeFamily,
  getFamilyColor,
  DISPLAY_NAMES,
} from "@/lib/fee-taxonomy";
import { InstitutionTable } from "./institution-table";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { FeeHistogram } from "@/components/fee-histogram";
import { BreakdownChart } from "@/components/breakdown-chart";

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: DimensionBreakdown[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="admin-card">
      <div className="px-4 py-3 border-b bg-gray-50/80">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50/80 text-left">
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Segment</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Count</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Min</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Median</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Max</th>
              <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.dimension_value}
                className="border-b last:border-0 hover:bg-gray-50/50 transition-colors"
              >
                <td className="px-4 py-2 font-medium text-gray-900">
                  {row.dimension_value}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {row.count}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {formatAmount(row.min_amount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                  {formatAmount(row.median_amount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {formatAmount(row.max_amount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                  {formatAmount(row.avg_amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "breakdowns", label: "Breakdowns" },
  { key: "institutions", label: "Institutions" },
] as const;

export default async function FeeCategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAuth("view");

  const { category } = await params;
  const { tab = "overview" } = await searchParams;

  if (!(category in DISPLAY_NAMES) && !category.includes("_")) {
    notFound();
  }

  const detail = await getFeeCategoryDetail(category);

  if (detail.fees.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">
          No fee data found for &quot;{getDisplayName(category)}&quot;
        </p>
        <Link
          href="/admin/fees/catalog"
          className="text-gray-500 hover:text-gray-700 transition-colors text-sm mt-2 inline-block"
        >
          Back to Fee Catalog
        </Link>
      </div>
    );
  }

  const displayName = getDisplayName(category);
  const family = getFeeFamily(category);
  const familyColors = family ? getFamilyColor(family) : null;

  const amounts = detail.fees
    .map((f) => f.amount)
    .filter((a): a is number => a !== null && a >= 0)
    .sort((a, b) => a - b);

  const stats = {
    count: detail.fees.length,
    withAmount: amounts.length,
    min: amounts.length > 0 ? amounts[0] : null,
    max: amounts.length > 0 ? amounts[amounts.length - 1] : null,
    median:
      amounts.length > 0
        ? amounts.length % 2 === 0
          ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
          : amounts[Math.floor(amounts.length / 2)]
        : null,
    avg:
      amounts.length > 0
        ? Math.round(
            (amounts.reduce((s, v) => s + v, 0) / amounts.length) * 100
          ) / 100
        : null,
    banks: detail.fees.filter((f) => f.charter_type === "bank").length,
    cus: detail.fees.filter((f) => f.charter_type !== "bank").length,
  };

  return (
    <>
      {/* Breadcrumb + header */}
      <div className="mb-6">
        <Breadcrumbs items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Fee Catalog", href: "/admin/fees/catalog" },
          { label: displayName },
        ]} />
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            {displayName}
          </h1>
          {family && familyColors && (
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${familyColors.bg} ${familyColors.text}`}
            >
              {family}
            </span>
          )}
        </div>
      </div>

      {/* Stat cards - always visible */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Institutions" value={String(stats.count)} />
        <StatCard
          label="Median"
          value={formatAmount(stats.median)}
          highlight
        />
        <StatCard label="Min" value={formatAmount(stats.min)} />
        <StatCard label="Max" value={formatAmount(stats.max)} />
        <StatCard label="Average" value={formatAmount(stats.avg)} />
        <StatCard
          label="Spread"
          value={
            stats.min !== null && stats.max !== null
              ? formatAmount(stats.max - stats.min)
              : "-"
          }
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/fees/catalog/${category}?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.key === "institutions" && (
              <span className="ml-1 text-xs text-gray-400 tabular-nums">
                ({detail.fees.length})
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <>
          {/* Charter type quick bar */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="admin-card px-4 py-3 flex items-center gap-3">
              <span className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                Banks
              </span>
              <span className="text-lg font-bold tabular-nums text-gray-900">
                {stats.banks}
              </span>
              <span className="text-xs text-gray-500 tabular-nums">
                {stats.count > 0
                  ? `${((stats.banks / stats.count) * 100).toFixed(0)}%`
                  : "0%"}
              </span>
            </div>
            <div className="admin-card px-4 py-3 flex items-center gap-3">
              <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                Credit Unions
              </span>
              <span className="text-lg font-bold tabular-nums text-gray-900">
                {stats.cus}
              </span>
              <span className="text-xs text-gray-500 tabular-nums">
                {stats.count > 0
                  ? `${((stats.cus / stats.count) * 100).toFixed(0)}%`
                  : "0%"}
              </span>
            </div>
          </div>

          {/* Fee distribution histogram */}
          <FeeHistogram fees={detail.fees} median={stats.median} />

          {/* Quick breakdown preview */}
          {detail.by_charter_type.length > 0 && (
            <div className="admin-card mb-6">
              <div className="px-4 py-3 border-b bg-gray-50/80 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">
                  Fee Range by Charter Type
                </h3>
                <Link
                  href={`/admin/fees/catalog/${category}?tab=breakdowns`}
                  className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  View all breakdowns
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/80 text-left">
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Count</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Min</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Median</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.by_charter_type.map((row) => (
                      <tr
                        key={row.dimension_value}
                        className="border-b last:border-0 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {row.dimension_value}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {row.count}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {formatAmount(row.min_amount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                          {formatAmount(row.median_amount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {formatAmount(row.max_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fee change events */}
          {detail.change_events.length > 0 && (
            <div className="admin-card">
              <div className="px-4 py-3 border-b bg-gray-50/80">
                <h3 className="text-sm font-bold text-gray-800">
                  Recent Fee Changes
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/80 text-left">
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Institution</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">Previous</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">New</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                      <th className="px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.change_events.map((evt, i) => (
                      <tr
                        key={i}
                        className="border-b last:border-0 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {evt.institution_name}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                          {formatAmount(evt.previous_amount)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                          {formatAmount(evt.new_amount)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              evt.change_type === "increase"
                                ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                : evt.change_type === "decrease"
                                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400"
                            }`}
                          >
                            {evt.change_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {evt.detected_at ? new Date(evt.detected_at).toISOString().slice(0, 10) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "breakdowns" && (
        <div className="space-y-6">
          {/* Visual comparison charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BreakdownChart
              title="Median by Charter Type"
              rows={detail.by_charter_type}
            />
            <BreakdownChart
              title="Median by Asset Tier"
              rows={detail.by_asset_tier}
            />
          </div>

          {/* Detailed breakdown tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BreakdownTable title="By Charter Type" rows={detail.by_charter_type} />
            <BreakdownTable title="By Asset Size Tier" rows={detail.by_asset_tier} />
            <BreakdownTable title="By Fed District" rows={detail.by_fed_district} />
            <BreakdownTable title="By State (Top 15)" rows={detail.by_state} />
          </div>
        </div>
      )}

      {tab === "institutions" && (
        <InstitutionTable fees={detail.fees} median={stats.median} highestTier={HIGHEST_TIER_CATEGORIES.has(category)} />
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="admin-card px-4 py-3">
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
      <p
        className={`text-xl font-bold tabular-nums mt-1 ${
          highlight ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
