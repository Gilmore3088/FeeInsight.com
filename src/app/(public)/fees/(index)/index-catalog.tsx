"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CoverageStatus = "public" | "limited";

export interface CatalogEntry {
  key: string;
  label: string;
  family: string;
  definition: string | null;
  /** Institutions whose published schedule lists the fee. */
  institutions: number;
  status: CoverageStatus;
  href: string;
}

/**
 * Every category in the Index as a compact grid: one card per fee group, each fee a chip with how
 * many institutions publish it. A search narrows the cards to matching fees (names, groups and
 * definitions). Access isn't labelled, since every category is free to explore; only thin coverage is.
 */
export function IndexCatalog({ entries, selected }: { entries: CatalogEntry[]; selected: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? entries.filter((e) => `${e.label} ${e.family} ${e.definition ?? ""}`.toLowerCase().includes(q)) : entries),
    [entries, q],
  );
  const families = [...new Set(shown.map((e) => e.family))];

  return (
    <div>
      <label className="block max-w-md">
        <span className="text-[13px] font-medium text-ink">Find a fee</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Wire, stop payment, safe deposit box..."
          className="mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-ink"
        />
      </label>
      <p className="mt-2 text-[12px] text-ink-muted" aria-live="polite">
        {shown.length === entries.length ? `${entries.length} fee categories in ${families.length} groups` : `${shown.length} of ${entries.length} fee categories`}
      </p>
      {families.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">No category matches that. Try a shorter word.</p>
      ) : (
        <ul className="mt-4 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {families.map((family) => {
            const members = shown.filter((e) => e.family === family);
            return (
              <li key={family} className="rounded-2xl border border-border bg-surface-0 p-4">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold text-ink">{family}</span>
                  <span className="text-[12px] text-ink-muted">{members.length}</span>
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {members.map((e) => (
                    <li key={e.key}>
                      <Link
                        href={e.href}
                        title={e.definition ?? undefined}
                        aria-current={e.key === selected ? "true" : undefined}
                        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                          e.key === selected ? "border-ink bg-ink text-on-ink" : "border-border bg-paper text-ink hover:border-ink"
                        }`}
                      >
                        {e.label}
                        <span className={`font-mono text-[11px] tabular-nums ${e.key === selected ? "text-on-ink/75" : "text-ink-muted"}`}>
                          {e.institutions.toLocaleString()}
                        </span>
                        {e.status === "limited" && <span className="sr-only">(limited coverage)</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-ink-muted">Each number is how many institutions publish that fee.</p>
    </div>
  );
}
