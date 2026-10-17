"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/**
 * A list that shows its first `limit` rows, then a "Show all N" toggle for the rest. Opening
 * it moves focus to the first row that appeared.
 */
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
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const cut = !expanded && items.length > limit;
  const listed = cut ? items.slice(0, limit) : items;
  return (
    <>
      <ul id={id} ref={listRef} aria-label={ariaLabel} className={className}>
        {listed.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            const opening = !expanded;
            setExpanded(opening);
            if (opening) {
              requestAnimationFrame(() => {
                const row = listRef.current?.children[limit]?.querySelector<HTMLElement>("summary, a, button");
                row?.focus();
              });
            }
          }}
          className="mx-4 my-1 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink sm:mx-5"
        >
          {expanded ? `Show fewer ${noun}` : `Show all ${items.length} ${noun}`}
        </button>
      )}
    </>
  );
}
