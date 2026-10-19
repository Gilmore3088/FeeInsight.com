"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CityLink {
  name: string;
  href: string;
  /** Banks and credit unions with a branch in the city. */
  institutions: number;
  /** Of those, the ones whose fees we publish. */
  withFees: number;
}

/** Cities listed before "View all". */
const FIRST_CITIES = 30;

const COUNT = new Intl.NumberFormat("en-US");

/**
 * Every city as a plain link, A to Z: the 30 with the most institutions until the reader asks for
 * all. Each says how many of its institutions have fee data, so a missing count never reads as a
 * city that charges nothing. Every city's link is in the page's HTML; "View all" only unhides the rest.
 */
export function CityList({ cities, stateName }: { cities: CityLink[]; stateName: string }) {
  const [all, setAll] = useState(false);
  const collapsed = !all && cities.length > FIRST_CITIES;
  const largest = useMemo(
    () => new Set([...cities].sort((a, b) => b.institutions - a.institutions).slice(0, FIRST_CITIES).map((c) => c.href)),
    [cities],
  );
  const sorted = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name)), [cities]);
  const shown = collapsed ? largest.size : cities.length;

  return (
    <section id="cities" aria-labelledby="cities-heading" className="scroll-mt-24">
      <h2 id="cities-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
        Browse {stateName} cities
      </h2>
      <p className="mt-1 text-[14px] text-ink-soft">
        Showing {COUNT.format(shown)} {shown === 1 ? "city" : "cities"}
        {collapsed && (
          <>
            {" "}
            <span aria-hidden="true">&middot;</span>{" "}
            <button
              type="button"
              onClick={() => setAll(true)}
              className="inline-flex min-h-11 items-center font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              View all {COUNT.format(cities.length)}
            </button>
          </>
        )}
      </p>
      <p className="mt-1 max-w-[46rem] text-[13px] text-ink-muted">
        A city lists the banks and credit unions with a branch there. An institution&apos;s fee schedule may apply across
        all its branches, not only this city.
      </p>
      <ul className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <li key={c.href} className="border-b border-border" hidden={collapsed && !largest.has(c.href)}>
            <Link href={c.href} className="flex min-h-11 flex-col justify-center py-2 text-ink hover:text-brick">
              <span className="truncate text-[15px] font-medium">{c.name}</span>
              <span className="text-[12px] tabular-nums text-ink-muted">
                Fee data available for {COUNT.format(c.withFees)} of {COUNT.format(c.institutions)}{" "}
                {c.institutions === 1 ? "institution" : "institutions"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
