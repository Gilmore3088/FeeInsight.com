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
 * Every category in the Index, grouped by family and searchable. Families start closed, except the
 * one holding the fee being explored, so the catalog stays a list of names until the reader opens
 * one; a category's description, coverage and link appear when it is opened. A search opens every
 * family with a match.
 */
export function IndexCatalog({ entries, selected }: { entries: CatalogEntry[]; selected: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? entries.filter((e) => `${e.label} ${e.family} ${e.definition ?? ""}`.toLowerCase().includes(q)) : entries),
    [entries, q],
  );
  const families = [...new Set(shown.map((e) => e.family))];
  const selectedFamily = entries.find((e) => e.key === selected)?.family;

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
        // Remounted when a search starts or ends, so each family's starting state applies again.
        <div key={q ? "search" : "browse"} className="mt-4 divide-y divide-border rounded-2xl border border-border bg-surface-0">
          {families.map((family) => {
            const members = shown.filter((e) => e.family === family);
            return (
              <details key={family} open={Boolean(q) || family === selectedFamily} className="group/family px-4 sm:px-5">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3">
                  <span className="text-[15px] font-semibold text-ink">{family}</span>
                  <span className="text-[12px] text-ink-muted">
                    {members.length} {members.length === 1 ? "category" : "categories"}
                    <span aria-hidden="true" className="ml-2 inline-block transition-transform group-open/family:rotate-90">
                      ›
                    </span>
                  </span>
                </summary>
                <ul className="grid gap-x-6 pb-3 sm:grid-cols-2">
                  {members.map((e) => (
                    <li key={e.key} className="border-t border-border">
                      <details open={e.key === selected} className="group/entry">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2">
                          <span className={`text-[14px] ${e.key === selected ? "font-semibold text-ink" : "text-ink"}`}>{e.label}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[e.status].className}`}>
                            {STATUS[e.status].text}
                          </span>
                        </summary>
                        <div className="pb-3 text-[13px]">
                          {e.definition && <p className="text-ink-soft">{e.definition}</p>}
                          <p className="mt-1 text-[12px] text-ink-muted">
                            {e.institutions.toLocaleString()} {e.institutions === 1 ? "institution publishes" : "institutions publish"} it
                          </p>
                          {e.key !== selected && (
                            <Link href={e.href} className="mt-2 inline-block font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
                              Explore {e.label}
                            </Link>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
