/**
 * RecentChanges — one list of what changed for the selected institution: the user's
 * active priority alerts first, then recent Hamilton signals, without repeats.
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

export function RecentChanges({ alerts, signals, selectedInstitutionId = null }: RecentChangesProps) {
  const items = mergeChanges(alerts, signals);
  const monitorHref = hrefWithInstitutionContext("/pro/monitor", selectedInstitutionId);
  return (
    <section
      className="flex flex-col rounded-xl border"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
    >
      <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "var(--hamilton-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
          What changed
        </h2>
        <Link href={monitorHref} className="text-xs font-medium no-underline hover:underline" style={{ color: "var(--hamilton-primary)" }}>
          Open Monitor →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
          {selectedInstitutionId
            ? "No changes recorded for this institution yet. New fee publications and alerts will show up here."
            : "Choose your institution to see its fee changes and alerts here."}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
          {items.map((item) => (
            <li key={item.key} className="flex gap-3 px-5 py-3">
              <span
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.low }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium" style={{ color: "var(--hamilton-on-surface)" }}>
                    {item.isAlert && (
                      <span className="mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "#fff1e6", color: "#9a3412" }}>
                        Alert
                      </span>
                    )}
                    {item.title}
                  </p>
                  <span className="shrink-0 text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                    {timeAgo(item.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {item.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
