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

/** What changed for the selected institution: its alerts first, then recent changes, in the memo style. */
export function RecentChanges({ alerts, signals, selectedInstitutionId = null }: RecentChangesProps) {
  const items = mergeChanges(alerts, signals, 3);
  const monitorHref = hrefWithInstitutionContext("/pro/monitor", selectedInstitutionId);
  return (
    <section aria-label="What changed" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl text-warm-900 sm:text-2xl" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
          What changed
        </h2>
        <Link href={monitorHref} className="text-sm text-terra-text underline">
          All changes
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-warm-700">
          {selectedInstitutionId
            ? "No changes recorded for this institution yet."
            : "Choose your institution to see its fee changes and alerts."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-3 px-4 py-3">
              <span
                className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.low }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-warm-900">
                  {item.isAlert ? <span className="mr-1 font-semibold text-terra-text">Alert:</span> : null}
                  {item.title}
                </p>
                {item.body && item.body !== item.title ? <p className="mt-0.5 text-sm text-warm-700">{item.body}</p> : null}
              </div>
              <span className="shrink-0 text-xs text-warm-600">{timeAgo(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
