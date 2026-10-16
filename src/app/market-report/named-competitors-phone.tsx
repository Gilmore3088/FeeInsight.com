"use client";

import { useState } from "react";

export interface NamedPhoneRow {
  id: number;
  name: string;
  /** City or branch line under the name, when the report has one. */
  detail: string | null;
  /** Link to the institution's page; null for the report's own institution. */
  href: string | null;
  /** By fee line: the amount, its schedule link and the schedule's words. */
  fees: Record<string, { amount: number; url: string | null; line: string | null } | undefined>;
}

/**
 * Named competitors on a phone: one fee line at a time, picked from a menu, so the
 * institution-by-fee grid never scrolls sideways. From `sm` the report shows the full grid.
 */
export function NamedCompetitorsPhone({
  lines,
  subject,
  competitors,
}: {
  lines: { key: string; label: string }[];
  subject: NamedPhoneRow;
  competitors: NamedPhoneRow[];
}) {
  const [picked, setPicked] = useState(lines[0]?.key ?? "");
  if (lines.length === 0) return null;
  const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  const row = (r: NamedPhoneRow, own: boolean) => {
    const fee = r.fees[picked];
    return (
      <li key={r.id} className={`flex items-baseline justify-between gap-3 py-2 ${own ? "-mx-2 rounded-md bg-[#FBF3EF] px-2 font-semibold" : ""}`}>
        <span className="min-w-0">
          {r.href ? (
            <a href={r.href} className="text-ink underline-offset-2 hover:underline">
              {r.name}
            </a>
          ) : (
            <span className="text-ink">{r.name}</span>
          )}
          {r.detail && <span className="block text-[12px] font-normal text-ink-muted">{r.detail}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-ink">
          {fee ? (
            fee.url ? (
              <a
                href={fee.url}
                title={fee.line ? `“${fee.line}”` : undefined}
                className="underline decoration-border underline-offset-2 hover:decoration-brick"
                rel="noopener noreferrer"
                target="_blank"
              >
                {money(fee.amount)}
              </a>
            ) : (
              money(fee.amount)
            )
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </span>
      </li>
    );
  };
  return (
    <div className="mt-4 sm:hidden print:hidden">
      <label className="block">
        <span className="sr-only">Fee line</span>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[14px] font-semibold text-ink"
        >
          {lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-3 divide-y divide-surface-200 text-sm">
        {row(subject, true)}
        {competitors.map((c) => row(c, false))}
      </ul>
    </div>
  );
}
