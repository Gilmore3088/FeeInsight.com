"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CoverageStatus = "public" | "full" | "limited";

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

const STATUS: Record<CoverageStatus, { text: string; className: string }> = {
  public: { text: "Free to explore", className: "bg-[#EAF0EC] text-below-market" },
  full: { text: "Full access", className: "bg-surface-200 text-ink" },
  limited: { text: "Limited coverage", className: "border border-border text-ink-muted" },
};

/**
 * Every category in the Index, grouped by family and searchable: its name, what it is, how many
 * institutions publish it, and whether it is free to explore, needs full access, or has too few
 * institutions for a median yet.
 */
export function IndexCatalog({ entries }: { entries: CatalogEntry[] }) {
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
        {shown.length === entries.length ? `${entries.length} fee categories` : `${shown.length} of ${entries.length} fee categories`}
      </p>
      {families.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-muted">No category matches that. Try a shorter word.</p>
      ) : (
        <div className="mt-4 space-y-8">
          {families.map((family) => (
            <section key={family} aria-label={family}>
              <h3 className="text-[15px] font-semibold text-ink">{family}</h3>
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {shown
                  .filter((e) => e.family === family)
                  .map((e) => (
                    <li key={e.key} className="border-b border-border py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={e.href} className="font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                          {e.label}
                        </Link>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[e.status].className}`}>
                          {STATUS[e.status].text}
                        </span>
                      </div>
                      {e.definition && <p className="mt-1 text-[13px] text-ink-soft">{e.definition}</p>}
                      <p className="mt-1 text-[12px] text-ink-muted">
                        {e.institutions.toLocaleString()} {e.institutions === 1 ? "institution publishes" : "institutions publish"} it
                      </p>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
