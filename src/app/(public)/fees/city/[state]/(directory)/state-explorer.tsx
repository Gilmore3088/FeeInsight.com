"use client";

import { useMemo, useState } from "react";
import type { StateMarketMap } from "@/lib/geo/state-market-map";
import { CityCoverage, StateCityMap, type CityMarker } from "@/components/public/state-city-map";
import { CityList, type CityLink } from "./city-list";

export interface ExplorerCity extends CityLink {
  /** The city's key in `?city=`: its name in lower case, as the city page's URL spells it. */
  key: string;
}

const FIELD = "mt-1 block min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[15px] text-ink";

/**
 * The state's city directory as a place to explore: a map with a marker per city (sized by the
 * institutions with a branch there), the selected city's coverage and its comparison page, and
 * the full list underneath. Without scripts every part still works: markers and the city menu
 * select through `?city=`, the search filters through `?q=`, and the list is plain links.
 */
export function StateExplorer({
  map,
  cities,
  initialCity,
  initialQuery,
  initialAll,
  stateName,
  stateCode,
}: {
  map: StateMarketMap | null;
  cities: ExplorerCity[];
  initialCity: string;
  initialQuery: string;
  initialAll: boolean;
  stateName: string;
  stateCode: string;
}) {
  const [selected, setSelected] = useState(initialCity);
  const [query, setQuery] = useState(initialQuery);

  const byKey = useMemo(() => new Map(cities.map((c) => [c.key, c])), [cities]);
  const onMap = useMemo(() => new Set(map?.points.map((p) => p.key) ?? []), [map]);
  // Without scripts every link and form carries the other choices along, so none is dropped.
  const keep = { q: initialQuery.trim(), all: initialAll ? "1" : "" };
  const params = (city: string, extra: Partial<typeof keep> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...extra, city })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const markers: CityMarker[] = cities.map((c) => ({
    key: c.key,
    name: c.name,
    institutions: c.institutions,
    withFees: c.withFees,
    selectHref: `${params(c.key)}#explorer`,
  }));
  const alphabetical = useMemo(() => [...cities].sort((a, b) => a.name.localeCompare(b.name)), [cities]);
  const q = query.trim().toLowerCase();
  const dimmed = useMemo(() => (q ? new Set(cities.filter((c) => !c.name.toLowerCase().includes(q)).map((c) => c.key)) : undefined), [cities, q]);
  const city = byKey.get(selected) ?? cities[0];

  function select(key: string) {
    setSelected(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("city", key);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The selection still shows; only the shareable URL is skipped.
    }
  }

  function search(value: string) {
    setQuery(value);
    // One matching city, or an exact name, is selected on the map as the reader types.
    const v = value.trim().toLowerCase();
    if (!v) return;
    const matches = cities.filter((c) => c.name.toLowerCase().includes(v));
    const exact = matches.find((c) => c.name.toLowerCase() === v);
    const pick = exact ?? (matches.length === 1 ? matches[0] : null);
    if (pick && pick.key !== selected) select(pick.key);
  }

  if (!city) return null;
  const marker = markers.find((m) => m.key === city.key)!;

  return (
    <>
      <div id="explorer" className="mt-8 grid scroll-mt-24 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-12">
        {map && (
          <figure className="mx-auto w-full max-w-[22rem] sm:max-w-none">
            <StateCityMap
              map={map}
              markers={markers}
              selected={city.key}
              onSelect={select}
              dimmed={dimmed}
              label={`${stateName} cities with published fees, sized by institutions with a branch`}
              focusable={false}
            />
            <figcaption className="mt-2 flex items-center justify-center gap-4 text-[12px] text-ink-muted sm:justify-start">
              <span className="inline-flex items-center gap-1.5">
                <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
                  <circle cx="3" cy="6" r="2.5" className="fill-ink-muted" />
                  <circle cx="15" cy="6" r="5.5" className="fill-ink-muted" />
                </svg>
                Larger dot: more institutions with a branch
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="6" cy="6" r="3.5" className="fill-ink" />
                  <circle cx="6" cy="6" r="5.25" className="fill-none stroke-ink" strokeWidth={1.25} />
                </svg>
                Selected
              </span>
            </figcaption>
          </figure>
        )}

        <div className="space-y-5 text-left">
          <form method="get" action="#cities" onSubmit={(e) => e.preventDefault()} role="search">
            <input type="hidden" name="city" value={city.key} />
            {initialAll && <input type="hidden" name="all" value="1" />}
            <label className="block">
              <span className="text-[13px] font-medium text-ink">Find your city</span>
              <span className="flex gap-2">
                <input
                  type="search"
                  name="q"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  placeholder={`A city in ${stateName}`}
                  className={`${FIELD} placeholder:text-ink-muted focus:outline-2 focus:outline-ink`}
                />
                {/* Without scripts the button submits; with them the field acts as the reader types. */}
                <noscript>
                  <button type="submit" className="mt-1 min-h-11 shrink-0 rounded-full border border-ink px-4 text-[14px] font-semibold text-ink">
                    Find
                  </button>
                </noscript>
              </span>
            </label>
          </form>
          <form method="get" action="#explorer" onSubmit={(e) => e.preventDefault()}>
            {keep.q && <input type="hidden" name="q" value={keep.q} />}
            {initialAll && <input type="hidden" name="all" value="1" />}
            <label className="block">
              <span className="text-[13px] font-medium text-ink">City on the map</span>
              <span className="flex gap-2">
                <select name="city" value={city.key} onChange={(e) => select(e.target.value)} className={FIELD}>
                  {alphabetical.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {/* Without scripts the button submits; with them the field acts as the reader types. */}
                <noscript>
                  <button type="submit" className="mt-1 min-h-11 shrink-0 rounded-full border border-ink px-4 text-[14px] font-semibold text-ink">
                    Show
                  </button>
                </noscript>
              </span>
            </label>
          </form>
          <div aria-live="polite">
            <CityCoverage marker={marker} href={city.href} onMap={!map || onMap.has(city.key)} />
          </div>
        </div>
      </div>

      <section id="cities" aria-labelledby="cities-heading" className="mt-12 scroll-mt-24 text-left sm:mt-16">
        <h2 id="cities-heading" className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
          Every {stateName} city
        </h2>
        <div className="mt-3">
          <CityList
            cities={cities}
            stateName={stateName}
            stateCode={stateCode}
            query={query}
            initialAll={initialAll}
            allHref={`${params(city.key, { all: "1" })}#cities`}
          />
        </div>
      </section>
    </>
  );
}
