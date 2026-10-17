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

/** Cities listed before "Show all". */
const FIRST_CITIES = 30;

const LINK = "font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

/**
 * Search first: a reader types their town. A town we don't cover gets a plain answer and three
 * ways on (institution search, the state report, every fee), never an empty list.
 */
export function CityList({
  cities,
  stateName,
  stateCode,
  shortcuts = [],
  query: controlledQuery,
  initialAll = false,
  allHref,
}: {
  cities: CityLink[];
  stateName: string;
  stateCode: string;
  /** The cities with the most institutions, shown as one-tap links under the search until the reader types. */
  shortcuts?: CityLink[];
  /** A search typed elsewhere on the page (the explorer's); the list then draws no search box of its own. */
  query?: string;
  /** Open with every city listed, as `?all=1` asks without scripts. */
  initialAll?: boolean;
  /** Where "Show all" goes without scripts. */
  allHref?: string;
}) {
  const [ownQuery, setQuery] = useState("");
  const [all, setAll] = useState(initialAll);
  const controlled = controlledQuery !== undefined;
  const query = controlled ? controlledQuery : ownQuery;
  const q = query.trim();
  const shown = useMemo(() => {
    const lower = q.toLowerCase();
    const list = lower ? cities.filter((c) => c.name.toLowerCase().includes(lower)) : cities;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [cities, q]);
  // Until the reader types or asks for all, the list is the cities with the most institutions, A to Z.
  const collapsed = !q && !all && cities.length > FIRST_CITIES;
  const listed = collapsed
    ? [...cities].sort((a, b) => b.institutions - a.institutions).slice(0, FIRST_CITIES).sort((a, b) => a.name.localeCompare(b.name))
    : shown;

  return (
    <div>
      {!controlled && (
      <label className="block max-w-md">
        <span className="text-[13px] font-medium text-ink">Find a city</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`A city in ${stateName}`}
          className="mt-1 min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-ink"
        />
      </label>
      )}
      <p className={`${controlled ? "" : "mt-2 "}text-[12px] text-ink-muted sm:mx-0 sm:text-left`} aria-live="polite">
        {shown.length === cities.length
          ? controlled
            ? collapsed
              ? `The ${FIRST_CITIES} cities with the most institutions, A to Z.`
              : `All ${cities.length} cities, A to Z.`
            : `${cities.length} ${cities.length === 1 ? "city has" : "cities have"} fee coverage.${collapsed ? ` The ${FIRST_CITIES} with the most institutions are listed below.` : ""}`
          : `${shown.length} of ${cities.length} cities with fee coverage`}
      </p>
      {!q && shortcuts.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-medium text-ink">Cities with the most institutions</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {shortcuts.map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-0 px-4 text-[14px] font-medium text-ink hover:border-ink"
                >
                  {c.name}
                  <span className="text-[12px] font-normal tabular-nums text-ink-muted">
                    {c.withFees} of {c.institutions} with fees
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {shown.length > 0 ? (
        <ul className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {listed.map((c) => (
            <li key={c.href} className="border-b border-border">
              <Link href={c.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-[14px] text-ink hover:text-brick">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-muted">
                  {c.withFees} of {c.institutions} with fees
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {shown.length > 0 && collapsed && allHref && (
        <a
          href={allHref}
          rel="nofollow"
          onClick={(e) => {
            e.preventDefault();
            setAll(true);
          }}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {cities.length} cities
        </a>
      )}
      {shown.length > 0 && collapsed && !allHref && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {cities.length} cities
        </button>
      )}
      {shown.length === 0 && (
        <div className="mt-3 rounded-2xl border border-border bg-surface-0 p-5">
          <p className="text-[15px] font-semibold text-ink">No city comparison for {q} yet.</p>
          <ul className="mt-3 space-y-2 text-[14px]">
            <li>
              <Link href={`/institutions?q=${encodeURIComponent(q)}`} className={LINK}>
                Search institutions by name
              </Link>
            </li>
            <li>
              <Link href={`/research/state/${stateCode}`} className={LINK}>
                {stateName} fee report
              </Link>
            </li>
            <li>
              <Link href="/fees" className={LINK}>
                Fees across the U.S.
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
