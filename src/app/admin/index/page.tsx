export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { requireAuth } from "@/lib/auth";
import { getNationalIndexData } from "@/lib/admin-queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAmount } from "@/lib/format";
import { IndexTable } from "./index-table";

// maturityColor moved to index-table.tsx (client component)
function _maturityColor(maturity: string): string {
  if (maturity === "strong")
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (maturity === "provisional")
    return "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
}

export default async function NationalIndexPage() {
  await requireAuth("view");

  let entries: Awaited<ReturnType<typeof getNationalIndexData>> = [];

  try {
    entries = await getNationalIndexData();
  } catch (e) {
    console.error("National index page load failed:", e);
  }

  const totalCategories = entries.length;
  const strongCount = entries.filter((e) => e.maturity === "strong").length;
  const totalObservations = entries.reduce((s, e) => s + e.observation_count, 0);
  const medians = entries
    .map((e) => e.median)
    .filter((m): m is number => m !== null);
  const overallMedian =
    medians.length > 0
      ? medians.sort((a, b) => a - b)[Math.floor(medians.length / 2)]
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[{ label: "Dashboard", href: "/admin" }, { label: "Fee Index" }]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          National Fee Index
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Benchmark medians across all 49 fee categories
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="admin-card p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Categories
          </p>
          <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 mt-1">
            {totalCategories}
          </p>
        </div>
        <div className="admin-card p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Typical Median
          </p>
          <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 mt-1">
            {overallMedian !== null ? formatAmount(overallMedian) : "-"}
          </p>
        </div>
        <div className="admin-card p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Observations
          </p>
          <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 mt-1">
            {totalObservations.toLocaleString()}
          </p>
        </div>
        <div className="admin-card p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Strong Maturity
          </p>
          <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100 mt-1">
            {totalCategories > 0
              ? `${Math.round((strongCount / totalCategories) * 100)}%`
              : "0%"}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {strongCount} of {totalCategories} with 10+ approved
          </p>
        </div>
      </div>

      {/* Index table — sortable */}
      {entries.length > 0 ? (
        <Suspense fallback={<div className="admin-card p-8 text-center text-gray-400">Loading...</div>}>
          <IndexTable entries={entries} />
        </Suspense>
      ) : (
        <div className="admin-card text-center py-12 text-sm text-gray-400">
          No index data available. Run publish-index to populate the cache.
        </div>
      )}
    </div>
  );
}
