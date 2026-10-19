"use client";

import { useState } from "react";
import Link from "next/link";

export interface StateListRow {
  code: string;
  name: string;
  href: string;
  published: string;
  monitored: string;
  share: string;
}

/** The ranked states: the first few, then every state, with the toggle always below the list. */
export function StateList({ rows, shown = 5 }: { rows: StateListRow[]; shown?: number }) {
  const [open, setOpen] = useState(false);
  const visible = open ? rows : rows.slice(0, shown);
  return (
    <div>
      <ul id="state-list" className="divide-y divide-border border-b border-border">
        {visible.map((row) => (
          <li key={row.code}>
            <Link href={row.href} prefetch={false} className="group flex min-h-11 items-center justify-between gap-3 py-2 text-[14px]">
              <span className="min-w-0 font-medium text-ink group-hover:text-brick">{row.name}</span>
              <span className="shrink-0 text-right tabular-nums text-ink-muted">
                <span className="font-semibold text-ink">{row.published}</span> of {row.monitored}
                <span className="ml-2 inline-block min-w-11 whitespace-nowrap text-right">{row.share}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="state-list"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center text-[14px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {open ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
