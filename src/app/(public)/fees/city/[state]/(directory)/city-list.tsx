"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CityLink {
  name: string;
  href: string;
  withFees: number;
}

/** Every city with published fees, filterable by name: a phone reader types their town. */
export function CityList({ cities, stateName }: { cities: CityLink[]; stateName: string }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? cities.filter((c) => c.name.toLowerCase().includes(q)) : cities;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [cities, query]);

  return (
    <div>
      <label className="block max-w-sm">
        <span className="text-[13px] font-medium text-ink">Find your city</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`A city in ${stateName}`}
          className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-ink"
        />
      </label>
      <p className="mt-2 text-[12px] text-ink-muted" aria-live="polite">
        {shown.length === cities.length ? `${cities.length} cities` : `${shown.length} of ${cities.length} cities`}
      </p>
      {shown.length > 0 ? (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.href} className="border-b border-border">
              <Link href={c.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px] text-ink hover:text-brick">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{c.withFees}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[14px] text-ink-muted">No city by that name has published fees yet.</p>
      )}
    </div>
  );
}
