export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAdminDateTime } from "@/lib/admin-time";
import { sql } from "@/lib/data-store/connection";
import { loadStateExpertIndex, STATE_EXPERT_QUERIES, type StateExpertIndex } from "@/lib/agents/state-expert/admin-view";

export default async function StateExpertsPage() {
  await requireAuth("operate");

  let index: StateExpertIndex = { rows: [], gapsRead: false, memoryError: null };
  let loadError: string | null = null;
  try {
    index = await loadStateExpertIndex(sql);
  } catch (error) {
    console.error("State experts page load failed:", error);
    loadError = error instanceof Error ? error.message : String(error);
  }
  const refreshed = index.rows.filter((row) => row.refreshedAt).length;

  return (
    <div className="space-y-6">
      <header>
        <Breadcrumbs
          items={[
            { label: "Atlas", href: "/admin" },
            { label: "State Lanes", href: "/admin/states" },
            { label: "State Experts" },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">State Experts</h1>
        <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          One expert per state, DC and territory. Ranked by how many more institutions with live fees the state&apos;s size
          groups under $10B need to reach the coverage target (30 per group, or 75% of a group under 40).
        </p>
      </header>

      {loadError ? (
        <p className="admin-card p-4 text-sm text-red-600 dark:text-red-400">Could not load the state experts: {loadError}</p>
      ) : null}
      {!loadError && !index.gapsRead ? (
        <p className="admin-card p-4 text-sm text-amber-700 dark:text-amber-300">
          The coverage read returned nothing, so every gap below shows as 0 and the ranking is by state code only.
        </p>
      ) : null}
      {index.memoryError ? (
        <p className="admin-card p-4 text-sm text-amber-700 dark:text-amber-300">State memory unread: {index.memoryError}</p>
      ) : null}

      <div className="admin-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="px-4 pt-3 text-left text-[11px] text-gray-400">
            {refreshed} of {index.rows.length} experts have a stored memory. Gap and groups: {STATE_EXPERT_QUERIES.coverageGaps}.
            Institutions, published fees and refresh time: {STATE_EXPERT_QUERIES.memory}.
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-400 dark:border-white/[0.08]">
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">State</th>
              <th className="px-4 py-2">Expert</th>
              <th className="px-4 py-2 text-right">Institutions short</th>
              <th className="px-4 py-2 text-right">Groups at target</th>
              <th className="px-4 py-2 text-right">Institutions</th>
              <th className="px-4 py-2 text-right">Published fees</th>
              <th className="px-4 py-2">Memory refreshed</th>
            </tr>
          </thead>
          <tbody>
            {index.rows.map((row, position) => (
              <tr key={row.stateCode} className="border-b border-gray-100 last:border-0 dark:border-white/[0.04]">
                <td className="px-4 py-2 tabular-nums text-gray-400">{position + 1}</td>
                <td className="px-4 py-2">
                  <Link href={`/admin/states/${row.stateCode}/expert`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">
                    {row.stateName ?? row.stateCode} ({row.stateCode})
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{row.expertName}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                  {row.institutionsShort.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {row.totalGroups > 0 ? `${row.readyGroups} of ${row.totalGroups}` : "No groups"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {row.institutions == null ? "Not stored" : row.institutions.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {row.publishedFees == null ? "Not stored" : row.publishedFees.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                  {row.refreshedAt ? formatAdminDateTime(row.refreshedAt) : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
