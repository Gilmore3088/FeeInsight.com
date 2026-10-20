export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getUsageDashboard } from "@/lib/research/history";
import { AgentUsageTable, UserUsageTable, DailyUsageTable } from "@/components/usage-tables";

export default async function ResearchUsagePage() {
  await requireAuth("operate");

  const dashboard = await getUsageDashboard();

  return (
    <div className="admin-content space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            Hamilton Research Usage
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            Query volume, cost tracking, and usage analytics for Hamilton research
            agents.
          </p>
        </div>
        <Link
          href="/admin/hamilton/research"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Back to Hamilton Research
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Today
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            {dashboard.today_queries}
          </p>
          <p className="text-[11px] text-gray-400">
            ${(dashboard.today_cost_cents / 100).toFixed(2)} est. cost
          </p>
        </div>
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            This Month
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            {dashboard.month_queries}
          </p>
          <p className="text-[11px] text-gray-400">
            ${(dashboard.month_cost_cents / 100).toFixed(2)} est. cost
          </p>
        </div>
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            All Time
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            {dashboard.total_queries}
          </p>
          <p className="text-[11px] text-gray-400">
            ${(dashboard.total_cost_cents / 100).toFixed(2)} total cost
          </p>
        </div>
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Daily Budget
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            ${(dashboard.today_cost_cents / 100).toFixed(2)}
            <span className="text-[13px] font-normal text-gray-400">
              {" "}
              / $50.00
            </span>
          </p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className={`h-1.5 rounded-full transition-all ${
                dashboard.today_cost_cents >= 4000
                  ? "bg-red-500"
                  : dashboard.today_cost_cents >= 2500
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{
                width: `${Math.min(100, (dashboard.today_cost_cents / 5000) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By Agent */}
        <div>
          <div className="px-4 py-3">
            <h2 className="text-sm font-bold text-gray-800">Usage by Agent</h2>
          </div>
          <AgentUsageTable agents={dashboard.by_agent} />
        </div>

        {/* Top Users */}
        <div>
          <div className="px-4 py-3">
            <h2 className="text-sm font-bold text-gray-800">
              Top Users (This Month)
            </h2>
          </div>
          <UserUsageTable users={dashboard.top_users} />
        </div>
      </div>

      {/* Daily breakdown */}
      <div>
        <div className="px-4 py-3">
          <h2 className="text-sm font-bold text-gray-800">
            Daily Usage (Last 30 Days)
          </h2>
        </div>
        <DailyUsageTable days={dashboard.by_day} />
      </div>
    </div>
  );
}
