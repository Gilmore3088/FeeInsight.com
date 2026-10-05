/**
 * RecentChanges — a slim callout of what changed for the selected institution: the
 * user's active priority alerts first, then recent Hamilton signals, without repeats.
 * Server component — no "use client".
 */

import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { AlertEntry, SignalEntry } from "@/lib/hamilton/home-data";

const SEVERITY_COLORS: Record<string, string> = {
  high: "#c2410c",
  medium: "#b45309",
  low: "#a8a29e",
};

interface ChangeItem {
  key: string;
  title: string;
  body: string;
  severity: string;
  createdAt: string;
  isAlert: boolean;
}

export function mergeChanges(alerts: AlertEntry[], signals: SignalEntry[], limit = 6): ChangeItem[] {
  const seen = new Set<string>();
  const items: ChangeItem[] = [];
  for (const alert of alerts) {
    seen.add(alert.signalId);
    items.push({ key: `alert-${alert.id}`, title: alert.title, body: alert.body, severity: alert.severity, createdAt: alert.createdAt, isAlert: true });
  }
  for (const signal of signals) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);
    items.push({ key: `signal-${signal.id}`, title: signal.title, body: signal.body, severity: signal.severity, createdAt: signal.createdAt, isAlert: false });
  }
  return items.slice(0, limit);
}

interface RecentChangesProps {
  alerts: AlertEntry[];
  signals: SignalEntry[];
  selectedInstitutionId?: string | null;
}

/** A slim callout of the latest three changes, for the top of the Benchmark page. */
export function RecentChanges({ alerts, signals, selectedInstitutionId = null }: RecentChangesProps) {
  const items = mergeChanges(alerts, signals, 3);
  const monitorHref = hrefWithInstitutionContext("/pro/monitor", selectedInstitutionId);
  return (
    <section
      aria-label="What changed"
      className="flex flex-col gap-2 rounded-lg border px-4 py-3 md:flex-row md:items-center md:gap-5"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-low)" }}
    >
      <h2 className="shrink-0 text-xs font-semibold" style={{ color: "var(--hamilton-text-secondary)", fontFamily: "var(--hamilton-font-sans)" }}>
        What changed
      </h2>
      {items.length === 0 ? (
        <p className="min-w-0 flex-1 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
          {selectedInstitutionId
            ? "No changes recorded for this institution yet."
            : "Choose your institution to see its fee changes and alerts."}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 md:flex-row md:gap-5">
          {items.map((item) => (
            <li key={item.key} className="flex min-w-0 items-baseline gap-2 md:flex-1">
              <span
                className="inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                style={{ backgroundColor: SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.low }}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate text-sm" style={{ color: "var(--hamilton-on-surface)" }} title={item.body}>
                {item.isAlert && <span className="mr-1 font-semibold" style={{ color: "#9a3412" }}>Alert:</span>}
                {item.title}
              </span>
              <span className="shrink-0 text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                {timeAgo(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href={monitorHref} className="shrink-0 text-xs font-medium no-underline hover:underline" style={{ color: "var(--hamilton-primary)" }}>
        All changes →
      </Link>
    </section>
  );
}
