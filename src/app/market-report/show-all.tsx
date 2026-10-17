"use client";

import { useState, type ReactNode } from "react";

/**
 * Wraps a long exhibit whose rows past the first few carry `EXTRA_ROW` or `EXTRA_GRID_ROW`
 * (report-view.ts, a plain module so server components get the strings): they stay hidden on
 * screen until "Show all N" is pressed, and always print, so a saved PDF holds every row. The
 * rows are drawn on the server; this only flips one attribute.
 */

export function ShowAll({ total, shown, noun, children }: { total: number; shown: number; noun: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group/all" data-open={open ? "true" : "false"}>
      {children}
      {total > shown && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink print:hidden"
        >
          {open ? "Show fewer" : `Show all ${total} ${noun}`}
        </button>
      )}
    </div>
  );
}
