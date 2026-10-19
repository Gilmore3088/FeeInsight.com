export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getHamilton } from "@/lib/research/agents";
import { ensureResearchTables, getUsageStats } from "@/lib/research/history";

export default async function ResearchHubPage() {
  const user = await requireAuth("operate");
  await ensureResearchTables();

  const hamilton = await getHamilton("admin");
  const usage = await getUsageStats(user.id);

  return (
    <div className="admin-content space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Hamilton Research Hub
        </h1>
        <p className="mt-1 text-[13px] text-gray-500">
          Internal Hamilton research with access to the Bank Fee Index database.
          Ask questions in natural language.
        </p>
      </div>

      {/* Usage summary */}
      <div className="flex items-end gap-4">
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Queries Today
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            {usage.today}
          </p>
        </div>
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            This Month
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            {usage.month}
          </p>
        </div>
        <div className="admin-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Est. Cost
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
            ${(usage.total_cost_cents / 100).toFixed(2)}
          </p>
        </div>
        <Link
          href="/admin/hamilton/research/usage"
          className="mb-0.5 text-[12px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          View detailed usage →
        </Link>
      </div>

      {/* Hamilton card */}
      <div className="admin-card px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-800">{hamilton.name}</h2>
            <p className="mt-1 text-[12px] text-gray-500">{hamilton.description}</p>
          </div>
        </div>
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Example Questions
          </p>
          <ul className="mt-1.5 space-y-1">
            {hamilton.exampleQuestions.slice(0, 3).map((q, i) => (
              <li key={i} className="text-[11px] text-gray-500 leading-relaxed">
                &ldquo;{q}&rdquo;
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4">
          <Link
            href="/admin/hamilton/research/hamilton"
            className="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-gray-800"
          >
            Open Hamilton
          </Link>
        </div>
      </div>
    </div>
  );
}
