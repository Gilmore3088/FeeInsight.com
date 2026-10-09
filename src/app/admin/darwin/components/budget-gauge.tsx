import { formatAdminDateTime } from "@/lib/admin-time";
import type { DarwinStatus } from "../types";

const UNREAD = "Couldn't read";

function count(value: number | null): string {
  return value == null ? UNREAD : value.toLocaleString("en-US");
}

/**
 * Darwin's counters, all from the shared ledgers: scheduled lane work and manual
 * repairs count alike, and days are UTC like the spend ledger on Controls.
 */
export function BudgetGauge({ status }: { status: DarwinStatus }) {
  const metrics = [
    {
      label: "Not yet verified",
      value: count(status.pending),
      detail: "Knox rows with no verified row (includes rejected and held rows)",
      tone: "text-gray-900 dark:text-gray-100",
    },
    {
      label: "Verified today",
      value: count(status.today_promoted),
      detail: "Verified rows since 00:00 UTC, every run",
      tone: "text-emerald-700 dark:text-emerald-400",
    },
    {
      label: "Spend today",
      value: status.today_cost_usd == null ? UNREAD : `$${status.today_cost_usd.toFixed(2)}`,
      detail: "All Darwin provider calls, UTC day (as on Controls)",
      tone: "text-gray-900 dark:text-gray-100",
    },
  ];

  return (
    <div className="border-y border-black/[0.06] py-4 dark:border-white/[0.06]">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="admin-label">{metric.label}</p>
            <p className={`mt-2 text-lg font-semibold tabular-nums tracking-tight ${metric.tone}`}>
              {metric.value}
            </p>
            <p className="admin-meta mt-1">{metric.detail}</p>
          </div>
        ))}
        <div>
          <p className="admin-label">Last Darwin step</p>
          {status.last_step ? (
            <>
              <p className="mt-2 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {formatAdminDateTime(status.last_step.at)}
              </p>
              <p className="admin-meta mt-1">
                {status.last_step.status} · run #{status.last_step.run_id}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {status.as_of ? "None recorded" : UNREAD}
              </p>
              <p className="admin-meta mt-1">Finished steps in the run ledger</p>
            </>
          )}
        </div>
      </div>
      <p className="admin-meta mt-3">
        {status.as_of ? `As of ${formatAdminDateTime(status.as_of)}` : "The ledgers could not be read."}
      </p>
    </div>
  );
}
