import { formatAdminDateTime } from "@/lib/admin-time";
import type { SpendLine, SpendSummary } from "@/lib/data-store/console-spend";
import { Meter } from "./today-panels";

const NAMES: Record<string, string> = {
  all: "All agents",
  atlas: "Atlas",
  magellan: "Magellan",
  rosetta: "Rosetta",
  knox: "Knox",
  darwin: "Darwin",
  hamilton: "Hamilton",
  unattributed: "Not tagged to an agent",
};

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function capText(line: SpendLine): string {
  if (!line.enabled) return "Paid calls off";
  const parts = [
    line.dailyCapUsd !== null ? `${money(line.dailyCapUsd)}/day` : null,
    line.monthlyCapUsd !== null ? `${money(line.monthlyCapUsd)}/month` : null,
  ].filter(Boolean);
  return parts.length ? `Cap ${parts.join(", ")}` : "No own cap (the all-agents cap applies)";
}

/**
 * Spend against caps, one row per agent plus the all-agents total, read live from
 * provider usage and the budget policies.
 */
export function SpendPanel({ spend, title = "Spend against caps" }: { spend: SpendSummary; title?: string }) {
  const rows = [spend.total, ...spend.agents];
  return (
    <section aria-label={title} className="admin-card px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="admin-section-title">{title}</p>
        <p className="text-[11px] text-gray-500">Read {formatAdminDateTime(spend.readAt)} · UTC day and month</p>
      </div>
      <ul className="mt-3 divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {rows.map((line) => (
          <li key={line.key} className="grid grid-cols-1 gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className={`text-sm ${line.key === "all" ? "font-bold" : "font-semibold"} text-gray-900 dark:text-gray-100`}>
                {NAMES[line.key] ?? line.key}
              </p>
              <p className="text-[11px] text-gray-500">{capText(line)}</p>
            </div>
            <div className="min-w-0">
              <p className="flex justify-between text-xs text-gray-500">
                <span>Today</span>
                <span className="font-mono tabular-nums text-gray-900 dark:text-gray-100">{money(line.todayUsd)}</span>
              </p>
              <Meter used={line.todayUsd} cap={line.dailyCapUsd} />
            </div>
            <div className="min-w-0">
              <p className="flex justify-between text-xs text-gray-500">
                <span>This month</span>
                <span className="font-mono tabular-nums text-gray-900 dark:text-gray-100">{money(line.monthUsd)}</span>
              </p>
              <Meter used={line.monthUsd} cap={line.monthlyCapUsd} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
