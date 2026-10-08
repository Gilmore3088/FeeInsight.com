export const dynamic = "force-dynamic";
import Link from "next/link";
import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import {
  getFeeCategorySummaries,
  type FeeCategorySummary,
} from "@/lib/data-store";
import { formatAmount } from "@/lib/format";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ServerSortableTable, type ServerColumn } from "@/components/server-sortable-table";
import {
  FEE_FAMILIES,
  getDisplayName,
  getFeeFamily,
  getFamilyColor,
  isFeaturedFee,
  getFeeTier,
  TAXONOMY_COUNT,
  FEATURED_COUNT,
} from "@/lib/fee-taxonomy";
import { CatalogFilterBar } from "./catalog-filter-bar";
import { CatalogActions } from "@/components/catalog-actions";
import { getMarketData, type MarketIndexRow } from "@/lib/admin-queries";
import {
  parseSegment,
  segmentLabel,
  segmentParams,
  SEGMENT_CHARTERS,
  SEGMENT_TIERS,
} from "./segment";

function deltaPill(delta: number | null): React.ReactNode {
  if (delta === null) return <span className="text-gray-300 dark:text-gray-600">-</span>;
  const cls =
    delta < 0
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : delta > 0
        ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${cls}`}>
      {delta > 0 ? "+" : ""}
      {delta}%
    </span>
  );
}

const VALID_PER = [25, 50, 100] as const;

export default async function FeeCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    family?: string;
    sort?: string;
    dir?: string;
    show?: string;
    page?: string;
    per?: string;
    charter?: string;
    tier?: string;
    state?: string;
  }>;
}) {
  await requireAuth("view");

  const params = await searchParams;
  const searchTerm = params.search ?? "";
  const activeFamily = params.family ?? "";
  const sortKey = params.sort ?? "institution_count";
  const sortDir = params.dir ?? "desc";
  const showFeatured = params.show === "featured";
  const currentPage = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const perPage = VALID_PER.includes(Number(params.per) as 25 | 50 | 100) ? Number(params.per) : 50;

  const segment = parseSegment(params);

  let summaries = await getFeeCategorySummaries();

  // A picked segment adds its median and the gap to national, per fee type.
  const segmentRows = new Map<string, MarketIndexRow>();
  if (segment) {
    const rows = await getMarketData({
      charter_type: segment.charter || undefined,
      asset_tier: segment.tier || undefined,
      state_code: segment.state || undefined,
    });
    for (const row of rows) segmentRows.set(row.fee_category, row);
  }

  // Search always searches all categories
  if (searchTerm) {
    summaries = summaries.filter((s) =>
      getDisplayName(s.fee_category)
        .toLowerCase()
        .includes(searchTerm.toLowerCase())
    );
  }

  // Apply tier filter: default to ALL, unless show=featured is explicitly set
  if (showFeatured && !searchTerm) {
    summaries = summaries.filter((s) => isFeaturedFee(s.fee_category));
  }

  // Family filter
  if (activeFamily) {
    summaries = summaries.filter(
      (s) => getFeeFamily(s.fee_category) === activeFamily
    );
  }

  // Sort
  const SORT_FNS: Record<
    string,
    (a: FeeCategorySummary, b: FeeCategorySummary) => number
  > = {
    institution_count: (a, b) => a.institution_count - b.institution_count,
    median_amount: (a, b) =>
      (a.median_amount ?? 0) - (b.median_amount ?? 0),
    spread: (a, b) => {
      const sa =
        a.max_amount !== null && a.min_amount !== null
          ? a.max_amount - a.min_amount
          : 0;
      const sb =
        b.max_amount !== null && b.min_amount !== null
          ? b.max_amount - b.min_amount
          : 0;
      return sa - sb;
    },
    fee_category: (a, b) =>
      getDisplayName(a.fee_category).localeCompare(
        getDisplayName(b.fee_category)
      ),
  };

  if (SORT_FNS[sortKey]) {
    summaries.sort(SORT_FNS[sortKey]);
    if (sortDir === "desc") summaries.reverse();
  }

  // Available families for filter
  const allFamilies = Object.keys(FEE_FAMILIES).filter((f) =>
    summaries.some((s) => getFeeFamily(s.fee_category) === f)
  );

  // Stats
  const totalCategories = summaries.length;
  const totalObservations = summaries.reduce(
    (s, r) => s + r.total_observations,
    0
  );
  const totalInstitutions = new Set(
    summaries.flatMap((s) => Array(s.institution_count).fill(s.fee_category))
  ).size;

  const highestMedian = [...summaries].sort(
    (a, b) => (b.median_amount ?? 0) - (a.median_amount ?? 0)
  )[0];
  const widestSpread = [...summaries].sort((a, b) => {
    const sa =
      a.max_amount !== null && a.min_amount !== null
        ? a.max_amount - a.min_amount
        : 0;
    const sb =
      b.max_amount !== null && b.min_amount !== null
        ? b.max_amount - b.min_amount
        : 0;
    return sb - sa;
  })[0];
  const mostCommon = [...summaries].sort(
    (a, b) => b.institution_count - a.institution_count
  )[0];

  // Global max for range bar scaling
  const globalMax = Math.max(
    ...summaries
      .map((s) => s.p75_amount ?? s.max_amount ?? 0)
      .filter((v) => v > 0),
    1
  );

  // Paginate after sorting/filtering
  const paginatedSummaries = summaries.slice((currentPage - 1) * perPage, currentPage * perPage);

  const catalogColumns: ServerColumn<FeeCategorySummary>[] = [
    {
      key: "fee_category",
      label: "Fee Type",
      sortable: true,
      className: "sticky left-0 bg-gray-50/80 dark:bg-[oklch(0.17_0_0)] z-10 min-w-[220px]",
      render: (item) => {
        const family = getFeeFamily(item.fee_category);
        const colors = family ? getFamilyColor(family) : null;
        const tier = getFeeTier(item.fee_category);
        const isFeatured = tier === "spotlight" || tier === "core";
        return (
          <div className="flex items-center gap-2">
            {colors && (
              <span
                className={`w-1 h-5 rounded-full flex-shrink-0 ${colors.dot}`}
              />
            )}
            <div>
              <Link
                href={`/admin/fees/catalog/${item.fee_category}`}
                className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-medium"
              >
                {getDisplayName(item.fee_category)}
              </Link>
              {!isFeatured && (
                <span className="ml-1.5 text-[9px] font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-wider">
                  {tier}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "family",
      label: "Family",
      sortable: false,
      render: (item) => {
        const family = getFeeFamily(item.fee_category);
        const colors = family ? getFamilyColor(family) : null;
        return family && colors ? (
          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}>
            {family}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">Other</span>
        );
      },
    },
    {
      key: "institution_count",
      label: "Inst.",
      sortable: true,
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {item.institution_count}
        </span>
      ),
    },
    {
      key: "median_amount",
      label: "Median",
      sortable: true,
      align: "right",
      render: (item) => (
        <span className="tabular-nums font-semibold text-gray-900 dark:text-gray-100">
          {formatAmount(item.median_amount)}
        </span>
      ),
    },
    {
      key: "p25",
      label: "P25",
      sortable: false,
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-gray-500 dark:text-gray-400">
          {formatAmount(item.p25_amount)}
        </span>
      ),
    },
    {
      key: "p75",
      label: "P75",
      sortable: false,
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-gray-500 dark:text-gray-400">
          {formatAmount(item.p75_amount)}
        </span>
      ),
    },
    {
      key: "max",
      label: "Max",
      sortable: false,
      align: "right",
      render: (item) =>
        item.max_amount !== null && item.p75_amount !== null && item.max_amount > item.p75_amount * 2 ? (
          <span className="text-red-600 dark:text-red-400 font-semibold tabular-nums">
            {formatAmount(item.max_amount)}
          </span>
        ) : (
          <span className="text-gray-500 dark:text-gray-400 tabular-nums">
            {formatAmount(item.max_amount)}
          </span>
        ),
    },
    {
      key: "spread",
      label: "Range",
      sortable: true,
      className: "min-w-[120px]",
      render: (item) => {
        const spread =
          item.max_amount !== null && item.min_amount !== null
            ? item.max_amount - item.min_amount
            : null;
        const p25 = item.p25_amount ?? 0;
        const p75 = item.p75_amount ?? 0;
        const barLeft = globalMax > 0 ? (p25 / globalMax) * 100 : 0;
        const barWidth = globalMax > 0 ? Math.max(((p75 - p25) / globalMax) * 100, 1) : 0;
        const family = getFeeFamily(item.fee_category);
        const colors = family ? getFamilyColor(family) : null;
        return item.p25_amount !== null && item.p75_amount !== null ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden relative">
              <div
                className={`absolute h-full rounded-full opacity-60 ${
                  colors ? colors.dot : "bg-gray-400"
                }`}
                style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500 w-12 text-right flex-shrink-0">
              {formatAmount(spread)}
            </span>
          </div>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">-</span>
        );
      },
    },
    {
      key: "banks",
      label: "Banks",
      sortable: false,
      align: "center",
      render: (item) =>
        item.bank_count > 0 ? (
          <span className="inline-block rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
            {item.bank_count}
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">-</span>
        ),
    },
    {
      key: "cus",
      label: "CUs",
      sortable: false,
      align: "center",
      render: (item) =>
        item.cu_count > 0 ? (
          <span className="inline-block rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {item.cu_count}
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">-</span>
        ),
    },
  ];

  if (segment) {
    const medianAt = catalogColumns.findIndex((col) => col.key === "median_amount");
    catalogColumns.splice(
      medianAt + 1,
      0,
      {
        key: "segment_median",
        label: "Segment",
        sortable: false,
        align: "right",
        render: (item) => (
          <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-300">
            {formatAmount(segmentRows.get(item.fee_category)?.segment_median ?? null)}
          </span>
        ),
      },
      {
        key: "segment_delta",
        label: "vs national",
        sortable: false,
        align: "right",
        render: (item) => deltaPill(segmentRows.get(item.fee_category)?.delta_pct ?? null),
      },
    );
  }

  // Preserve filter params for sort/pagination links
  const filterParams: Record<string, string> = { ...segmentParams(segment) };
  if (showFeatured) filterParams.show = "featured";
  if (activeFamily) filterParams.family = activeFamily;
  if (searchTerm) filterParams.search = searchTerm;

  return (
    <>
      <div className="mb-6">
        <div className="print:hidden">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/admin" },
              { label: "Fee Catalog" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              Fee Catalog
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalCategories} fee types across{" "}
              {totalObservations.toLocaleString()} observations
              {segment ? ` · compared with ${segmentLabel(segment)}` : ""}
            </p>
          </div>
          <CatalogActions />
        </div>
      </div>

      {/* Insight cards */}
      {summaries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
          <div className="admin-card px-4 py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Categories
            </p>
            <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
              {totalCategories}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              of {showFeatured ? FEATURED_COUNT : TAXONOMY_COUNT}{" "}
              {showFeatured ? "featured" : "total"}
            </p>
          </div>
          {mostCommon && (
            <Link
              href={`/admin/fees/catalog/${mostCommon.fee_category}`}
              className="admin-card px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Most Common
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1 truncate">
                {getDisplayName(mostCommon.fee_category)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                {mostCommon.institution_count} institutions
              </p>
            </Link>
          )}
          {highestMedian && (
            <Link
              href={`/admin/fees/catalog/${highestMedian.fee_category}`}
              className="admin-card px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Highest Median
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
                {formatAmount(highestMedian.median_amount)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {getDisplayName(highestMedian.fee_category)}
              </p>
            </Link>
          )}
          {widestSpread && (
            <Link
              href={`/admin/fees/catalog/${widestSpread.fee_category}`}
              className="admin-card px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Widest Spread
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1 tabular-nums">
                {formatAmount(
                  (widestSpread.max_amount ?? 0) -
                    (widestSpread.min_amount ?? 0)
                )}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                {getDisplayName(widestSpread.fee_category)}
              </p>
            </Link>
          )}
        </div>
      )}

      {/* Sticky filter bar */}
      <Suspense fallback={null}>
        <CatalogFilterBar families={allFamilies} />
      </Suspense>

      {/* Segment comparison (formerly the separate Market page) */}
      <details open={!!segment} className="admin-card mb-4 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800 dark:text-gray-200">
          {segment ? `Compared with ${segmentLabel(segment)}` : "Compare a segment"}
          <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
            Banks or credit unions, a size, or a state, against the national median
          </span>
        </summary>
        <form action="/admin/fees/catalog" className="mt-3 flex flex-wrap items-end gap-3">
          {showFeatured ? <input type="hidden" name="show" value="featured" /> : null}
          {activeFamily ? <input type="hidden" name="family" value={activeFamily} /> : null}
          {searchTerm ? <input type="hidden" name="search" value={searchTerm} /> : null}
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Type
            <select
              name="charter"
              defaultValue={segment?.charter ?? ""}
              className="mt-1 block min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 sm:min-h-0 sm:py-1.5 dark:border-white/[0.12] dark:bg-[oklch(0.18_0_0)] dark:text-gray-100"
            >
              <option value="">All</option>
              {SEGMENT_CHARTERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Size
            <select
              name="tier"
              defaultValue={segment?.tier ?? ""}
              className="mt-1 block min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 sm:min-h-0 sm:py-1.5 dark:border-white/[0.12] dark:bg-[oklch(0.18_0_0)] dark:text-gray-100"
            >
              <option value="">All</option>
              {SEGMENT_TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            State
            <input
              name="state"
              defaultValue={segment?.state ?? ""}
              placeholder="TX"
              maxLength={2}
              className="mt-1 block min-h-11 w-20 rounded-md border border-gray-300 bg-white px-3 text-sm uppercase text-gray-700 sm:min-h-0 sm:py-1.5 dark:border-white/[0.12] dark:bg-[oklch(0.18_0_0)] dark:text-gray-100"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 sm:min-h-0 sm:py-1.5 dark:bg-gray-100 dark:text-gray-900"
          >
            Compare
          </button>
          {segment ? (
            <Link
              href={`/admin/fees/catalog?${new URLSearchParams(
                Object.fromEntries(Object.entries(filterParams).filter(([k]) => !["charter", "tier", "state"].includes(k))),
              ).toString()}`}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </details>

      {/* Flat table with inline family colors */}
      <div className="admin-card overflow-hidden">
        {summaries.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No fee categories found
            {searchTerm ? ` matching "${searchTerm}"` : ""}.
          </div>
        ) : (
          <ServerSortableTable
            columns={catalogColumns}
            rows={paginatedSummaries}
            rowKey={(r) => r.fee_category}
            basePath="/admin/fees/catalog"
            sort={sortKey}
            dir={sortDir as "asc" | "desc"}
            page={currentPage}
            perPage={perPage}
            totalItems={summaries.length}
            params={filterParams}
            caption="Fee catalog"
          />
        )}
      </div>
    </>
  );
}
