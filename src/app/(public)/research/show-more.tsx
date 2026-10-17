"use client";

import { useState, type ReactNode } from "react";

/** A list that shows its first `limit` rows, then a "Show all N" control for the rest. */
export function ShowMore({
  items,
  limit = 5,
  noun,
  className,
  ariaLabel,
}: {
  items: { key: string; node: ReactNode }[];
  limit?: number;
  /** What the rows are, plural ("fees"). */
  noun: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const cut = !expanded && items.length > limit;
  const listed = cut ? items.slice(0, limit) : items;
  return (
    <>
      <ul aria-label={ariaLabel} className={className}>
        {listed.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
      {cut && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          Show all {items.length} {noun}
        </button>
      )}
    </>
  );
}
