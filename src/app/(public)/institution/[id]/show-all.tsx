"use client";

import { useState } from "react";

/**
 * Wraps a list whose rows past the first few carry the `group-data-[all=true]/fees` classes:
 * one button opens the rest. Starts open when the reader arrived for a fee further down.
 */
export function ShowAll({
  total,
  shown,
  initialAll = false,
  children,
}: {
  total: number;
  shown: number;
  initialAll?: boolean;
  children: React.ReactNode;
}) {
  const [all, setAll] = useState(initialAll || total <= shown);
  return (
    <div data-all={all} className="group/fees">
      {children}
      {!all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {total} fees
        </button>
      )}
    </div>
  );
}
