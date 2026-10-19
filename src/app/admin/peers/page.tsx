export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getPeerIndexData } from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAmount } from "@/lib/format";
import { DISTRICT_NAMES, FDIC_TIER_LABELS } from "@/lib/fed-districts";

function deltaPill(delta: number | null): React.ReactNode {
  if (delta === null) return <span className="text-gray-400">-</span>;
  const isBelow = delta < 0;
  const cls = isBelow
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : delta > 0
      ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${cls}`}>
      {delta > 0 ? "+" : ""}{delta}%
    </span>
  );
}

export default async function PeersPage({
  searchParams,
}: {
  searchParams: Promise<{
    charter?: string;
    tier?: string;
    district?: string;
  }>;
}) {
  await requireAuth("operate");

  const params = await searchParams;
  const charter = params.charter ?? "";
  const tier = params.tier ?? "";
  const district = params.district ?? "";

  const hasFilters = !!(charter || tier || district);

  let entries: Awaited<ReturnType<typeof getPeerIndexData>> = [];

  try {
    entries = await getPeerIndexData({
      charter_type: charter || undefined,
      asset_tier: tier || undefined,
      fed_district: district ? Number(district) : undefined,
    });
  } catch (e) {
    console.error("Peers page load failed:", e);
  }

  const filterParts: string[] = [];
  if (charter) filterParts.push(`Charter: ${charter}`);
  if (tier) filterParts.push(`Tier: ${FDIC_TIER_LABELS[tier] ?? tier}`);
  if (district) filterParts.push(`District: ${DISTRICT_NAMES[Number(district)] ?? district}`);
  const filterLabel = filterParts.length > 0 ? filterParts.join(" / ") : null;

  const totalPeerInst = entries.length > 0
    ? Math.max(...entries.map((e) => e.peer_count))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[{ label: "Dashboard", href: "/admin" }, { label: "Peer Index" }]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Peer Analysis
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {hasFilters
            ? filterLabel
            : "Select filters to compare a peer group against the national index"}
        </p>
      </div>

      {/* Filter bar */}
      <div className="admin-card p-4">
        <form className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Charter Type
            </label>
            <select
              name="charter"
              defaultValue={charter}
              className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
            >
              <option value="">All</option>
              <option value="bank">Bank</option>
              <option value="credit_union">Credit Union</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Asset Tier
            </label>
            <select
              name="tier"
              defaultValue={tier}
              className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
            >
              <option value="">All</option>
              <option value="micro">Micro (&lt;$100M)</option>
              <option value="community">Community ($100M-$1B)</option>
              <option value="midsize">Mid-Size ($1B-$10B)</option>
              <option value="regional">Regional ($10B-$250B)</option>
              <option value="mega">Mega (&gt;$250B)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Fed District
            </label>
            <select
              name="district"
              defaultValue={district}
              className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
            >
              <option value="">All</option>
              {Object.entries(DISTRICT_NAMES).map(([id, name]) => (
                <option key={id} value={id}>
                  {id} - {name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            Apply
          </button>
          {hasFilters && (
            <Link
              href="/admin/peers"
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              Reset
            </Link>
          )}
        </form>
      </div>

      {/* Results */}
      {!hasFilters ? (
        <div className="admin-card p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose at least one filter above to generate a peer comparison.
          </p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50/80 dark:bg-white/[0.04] flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">
              Peer vs National
            </h2>
            <span className="text-[11px] text-gray-400 tabular-nums">
              {entries.length} categories
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/80 dark:bg-white/[0.03] text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    Peer Median
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    National Median
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    Delta
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-right">
                    Peer Inst.
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => (
                  <tr
                    key={item.fee_category}
                    className="border-b last:border-0 hover:bg-blue-50/30 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/fees/catalog/${item.fee_category}`}
                        className="text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-medium"
                      >
                        {item.display_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                      {formatAmount(item.peer_median)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {formatAmount(item.national_median)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {deltaPill(item.delta_pct)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {item.peer_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 && (
            <div className="text-center py-12 text-sm text-gray-400">
              No peer data found for this filter combination
            </div>
          )}
        </div>
      )}
    </div>
  );
}
