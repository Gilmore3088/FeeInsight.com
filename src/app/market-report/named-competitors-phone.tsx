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
  shown,
}: {
  lines: { key: string; label: string }[];
  subject: NamedPhoneRow;
  competitors: NamedPhoneRow[];
  /** Competitors listed before "Show all N competitors"; every one when left out. */
  shown?: number;
}) {
  const [picked, setPicked] = useState(lines[0]?.key ?? "");
  const [all, setAll] = useState(false);
  const folded = shown !== undefined && !all && competitors.length > shown;
  const listed = folded ? competitors.slice(0, shown) : competitors;
  if (lines.length === 0) return null;
  const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  const row = (r: NamedPhoneRow, own: boolean) => {
    const fee = r.fees[picked];
    return (
      <li key={r.id} className={`flex items-center justify-between gap-3 py-1 ${own ? "-mx-2 rounded-md bg-brick-tint/40 px-2 font-semibold" : ""}`}>
        <span className="min-w-0">
          {r.href ? (
            <a href={r.href} className="flex min-h-11 items-center text-ink underline-offset-2 hover:underline">
              {r.name}
            </a>
          ) : (
            <span className="flex min-h-11 items-center text-ink">{r.name}</span>
          )}
          {r.detail && <span className="-mt-2 block pb-1 text-[12px] font-normal text-ink-muted">{r.detail}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-ink">
          {fee ? (
            fee.url ? (
              <a
                href={fee.url}
                title={fee.line ? `“${fee.line}”` : undefined}
                className="flex min-h-11 items-center underline decoration-border underline-offset-2 hover:decoration-brick"
                rel="noopener noreferrer"
                target="_blank"
              >
                {money(fee.amount)}
              </a>
            ) : (
              money(fee.amount)
            )
          ) : (
            <span className="text-ink-muted">-</span>
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
        {listed.map((c) => row(c, false))}
      </ul>
      {shown !== undefined && competitors.length > shown && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {all ? "Show fewer" : `Show all ${competitors.length} competitors`}
        </button>
      )}
    </div>
  );
}
