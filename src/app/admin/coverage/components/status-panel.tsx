"use client";

import { formatAdminDateTime } from "@/lib/admin-time";
import type { MagellanStatus } from "../types";

export function StatusPanel({ status }: { status: MagellanStatus }) {
  const tiles = [
    { label: "Waiting for rescue", value: status.pending, color: "text-gray-900 dark:text-gray-100", detail: "Need a usable source" },
    { label: "Resolved", value: status.rescued, color: "text-emerald-700 dark:text-emerald-400", detail: "URL or fees found" },
    { label: "No source found", value: status.dead, color: "text-gray-500 dark:text-gray-400", detail: "Exhausted attempts" },
    { label: "Needs human", value: status.needs_human, color: "text-amber-700 dark:text-amber-400", detail: "Manual review queue" },
    { label: "Retry later", value: status.retry_after, color: "text-blue-700 dark:text-blue-400", detail: "Temporary block" },
    {
      label: "Spend today",
      value: status.today_cost_usd == null ? "Couldn't read" : `$${status.today_cost_usd.toFixed(2)}`,
      color: "text-gray-900 dark:text-gray-100",
      // Same ledger and UTC day as Controls: every Magellan provider call, scheduled or manual.
      detail: status.spend_read_at
        ? `All Magellan provider calls, UTC day · as of ${formatAdminDateTime(status.spend_read_at)}`
        : "Spend ledger unavailable",
    },
  ];

  return (
    <div className="grid gap-x-6 gap-y-4 border-y border-black/[0.06] py-4 sm:grid-cols-3 xl:grid-cols-6 dark:border-white/[0.06]">
      {tiles.map((t) => (
        <div key={t.label}>
          <p className="admin-label">{t.label}</p>
          <p className={`mt-2 text-lg font-semibold tabular-nums tracking-tight ${t.color}`}>
            {typeof t.value === "number" ? t.value.toLocaleString("en-US") : t.value}
          </p>
          <p className="admin-meta mt-1">{t.detail}</p>
        </div>
      ))}
    </div>
  );
}
