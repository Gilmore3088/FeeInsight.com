export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getInstitutionsByFilter } from "@/lib/data-store";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Pagination } from "@/components/pagination";
import { formatAssets } from "@/lib/format";
import {
  parsePeerFilters,
  buildFilterDescription,
  FDIC_TIER_LABELS,
  DISTRICT_NAMES,
} from "@/lib/fed-districts";

export default async function ExplorePeersPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    tier?: string;
    district?: string;
    gap?: string;
    page?: string;
  }>;
}) {
  await requireAuth("operate");
  const params = await searchParams;

  const peerFilters = parsePeerFilters({
    charter: params.type,
    tier: params.tier,
    district: params.district,
  });

  const showGap = params.gap === "1";
  const currentPage = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const pageSize = 50;

  const { rows: institutions, total } = await getInstitutionsByFilter({
    charter_type: peerFilters.charter,
    asset_tiers: peerFilters.tiers,
    fed_districts: peerFilters.districts,
    gap: showGap,
    page: currentPage,
    pageSize,
  });

  const totalPages = Math.ceil(total / pageSize);
  const filterDescription = buildFilterDescription(peerFilters);

  // Build summary context for when navigating from quality page
  const hasTierFilter = peerFilters.tiers && peerFilters.tiers.length === 1;
  const hasDistrictFilter =
    peerFilters.districts && peerFilters.districts.length === 1;
  const showSummaryBar = hasTierFilter || hasDistrictFilter;

  // For summary bar, get both total and gap counts
  let totalAll = total;
  let totalGaps = 0;
  if (showSummaryBar) {
    if (showGap) {
      // We have gap count from current query; need total
      const { total: allTotal } = await getInstitutionsByFilter({
        charter_type: peerFilters.charter,
        asset_tiers: peerFilters.tiers,
        fed_districts: peerFilters.districts,
        gap: false,
        page: 1,
        pageSize: 1,
      });
      totalAll = allTotal;
      totalGaps = total;
    } else {
      // We have total; need gap count
      const { total: gapTotal } = await getInstitutionsByFilter({
        charter_type: peerFilters.charter,
        asset_tiers: peerFilters.tiers,
        fed_districts: peerFilters.districts,
        gap: true,
        page: 1,
        pageSize: 1,
      });
      totalAll = total;
      totalGaps = gapTotal;
    }
  }
  const withFees = totalAll - totalGaps;
  const coveragePct = totalAll > 0 ? ((withFees / totalAll) * 100).toFixed(1) : "0.0";

  // Build context-aware breadcrumb
  const fromQuality = hasTierFilter || hasDistrictFilter;
  const breadcrumbLabel = hasTierFilter
    ? FDIC_TIER_LABELS[peerFilters.tiers![0]] || "Tier"
    : hasDistrictFilter
      ? `District ${peerFilters.districts![0]} - ${DISTRICT_NAMES[peerFilters.districts![0]] || ""}`
      : "Explore";

  // Build back link
  const backParams = new URLSearchParams();
  if (params.tier) backParams.set("tier", params.tier);
  if (params.district) backParams.set("district", params.district);
  if (params.type) backParams.set("type", params.type);
  const backQs = backParams.toString();
  const backHref = fromQuality
    ? "/admin/quality"
    : backQs
      ? `/admin/peers?${backQs}`
      : "/admin/peers";

  // Pagination params to preserve
  const paginationParams: Record<string, string> = {};
  if (params.tier) paginationParams.tier = params.tier;
  if (params.district) paginationParams.district = params.district;
  if (params.type) paginationParams.type = params.type;
  if (params.gap) paginationParams.gap = params.gap;

  return (
    <>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/admin" },
            fromQuality
              ? { label: "Data Quality", href: "/admin/quality" }
              : { label: "Peer Index", href: "/admin/peers" },
            { label: breadcrumbLabel },
          ]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              {showGap ? "Coverage Gaps" : "Explore Peers"}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {filterDescription}
              {showGap ? " (no fee data)" : ""} &mdash;{" "}
              {total.toLocaleString()} institutions
            </p>
          </div>
          <div className="flex items-center gap-3">
            {showGap ? (
              <Link
                href={`/admin/peers/explore?${new URLSearchParams(
                  Object.fromEntries(
                    Object.entries(paginationParams).filter(
                      ([k]) => k !== "gap"
                    )
                  )
                ).toString()}`}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Show all
              </Link>
            ) : (hasTierFilter || hasDistrictFilter) ? (
              <Link
                href={`/admin/peers/explore?${new URLSearchParams({
                  ...paginationParams,
                  gap: "1",
                }).toString()}`}
                className="text-sm text-amber-600 hover:text-amber-700 transition-colors font-medium"
              >
                View gaps only
              </Link>
            ) : null}
            <Link
              href={backHref}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              {fromQuality ? "Back to quality" : "Back to segmentation"}
            </Link>
          </div>
        </div>
      </div>

      {showSummaryBar && (
        <div className="admin-card mb-4 px-4 py-3 flex items-center gap-6 text-sm">
          <span className="font-semibold text-gray-900">
            {hasTierFilter
              ? FDIC_TIER_LABELS[peerFilters.tiers![0]]
              : `District ${peerFilters.districts![0]} - ${DISTRICT_NAMES[peerFilters.districts![0]] || ""}`}
          </span>
          <span className="text-gray-400">|</span>
          <span className="tabular-nums text-gray-600">
            {totalAll.toLocaleString()} total
          </span>
          <span className="text-gray-400">|</span>
          <span className="tabular-nums text-gray-600">
            {withFees.toLocaleString()} with fees
          </span>
          <span className="text-gray-400">|</span>
          <span className="tabular-nums text-amber-600 font-medium">
            {totalGaps.toLocaleString()} gaps
          </span>
          <span className="text-gray-400">|</span>
          <span
            className={`tabular-nums font-medium ${
              parseFloat(coveragePct) < 25 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {coveragePct}% coverage
          </span>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/80 text-left">
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Institution
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  State
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                  Assets
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
                  District
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                  Fees
                </th>
                <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Fee URL
                </th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((inst) => (
                <tr
                  key={inst.id}
                  className="border-b last:border-0 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/peers/${inst.id}`}
                      className="text-gray-900 hover:text-blue-600 transition-colors font-medium"
                    >
                      {inst.institution_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {inst.state_code || "-"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        inst.charter_type === "bank"
                          ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                          : "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                      }`}
                    >
                      {inst.charter_type === "bank" ? "Bank" : "CU"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {formatAssets(inst.asset_size)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {inst.asset_size_tier
                      ? FDIC_TIER_LABELS[inst.asset_size_tier] ||
                        inst.asset_size_tier
                      : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-500 tabular-nums">
                    {inst.fed_district || "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {inst.fee_count > 0 ? (
                      <span className="font-semibold tabular-nums text-gray-900">
                        {inst.fee_count}
                      </span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {inst.fee_schedule_url ? (
                      <a
                        href={inst.fee_schedule_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-xs truncate max-w-[200px] inline-block"
                        title={inst.fee_schedule_url}
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-gray-300 text-xs">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {institutions.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {showGap
              ? "All institutions in this segment have fee data"
              : "No institutions match the current filters"}
          </div>
        )}

        <div className="px-4 pb-4">
          <Pagination
            basePath="/admin/peers/explore"
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
            params={paginationParams}
          />
        </div>
      </div>
    </>
  );
}
