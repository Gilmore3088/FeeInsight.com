"use client";

import Link from "next/link";
import { createContext, useContext, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { StateMarketMap } from "@/lib/geo/state-market-map";
import { cityMatches } from "@/lib/geo/city-names";
import { StateCityMap, type CityMarker } from "@/components/public/state-city-map";
import type { StateLocalEconomy } from "@/lib/data-store/local-economy";
import type { CityLink } from "./city-list";
import { cityEconomyView } from "./local-economy-view";

export interface ExplorerCity extends CityLink {
  /** The city's key in `?city=`: its name in lower case, as the city page's URL spells it. */
  key: string;
  /** Its `cityKey` (spellings folded), which the local economy's city-to-county map is keyed by. */
  economyKey?: string;
}

/** Suggestions the city search offers at once. */
const SUGGESTIONS = 8;

const COUNT = new Intl.NumberFormat("en-US");

interface Explorer {
  cities: ExplorerCity[];
  map: StateMarketMap | null;
  stateName: string;
  /** Undefined: the page passed none (no block). Null: the read failed (an honest unavailable note). */
  economy: StateLocalEconomy | null | undefined;
  city: ExplorerCity;
  query: string;
  setQuery: (q: string) => void;
  select: (key: string) => void;
}

const ExplorerContext = createContext<Explorer | null>(null);

function useExplorer(): Explorer {
  const value = useContext(ExplorerContext);
  if (!value) throw new Error("StateExplorer parts render inside StateExplorer");
  return value;
}

/**
 * The state's city directory as a place to explore. The city search, the selected city and the
 * map share one selection: choosing a city in the search moves the map, and a marker fills the
 * search. The page lays the parts out (search and city in the hero, the map beside them) and
 * renders as a cached page, so `?city=` is read here, in the browser. Cities arrive with their
 * spellings already folded (`src/lib/geo/city-names.ts`), and the search folds what the reader
 * types the same way.
 */
/** The address never changes under the page except through `select`, which also sets state. */
const noSubscription = () => () => {};
const askedCity = () => new URLSearchParams(window.location.search).get("city")?.toLowerCase() ?? "";

export function StateExplorer({
  map,
  cities,
  stateName,
  economy,
  children,
}: {
  map: StateMarketMap | null;
  cities: ExplorerCity[];
  stateName: string;
  economy?: StateLocalEconomy | null;
  children: ReactNode;
}) {
  const byKey = useMemo(() => new Map(cities.map((c) => [c.key, c])), [cities]);

  // The page is cached and the same for every address, so a shared link's ?city= is read here,
  // in the browser (the server render sees none). A reader's own choice then takes over.
  const asked = useSyncExternalStore(noSubscription, askedCity, () => "");
  const fromAddress = useMemo(
    () => (asked ? (byKey.get(asked) ?? cities.find((c) => cityMatches(asked, c.name) && cityMatches(c.name, asked))) : undefined),
    [asked, byKey, cities],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [typed, setQuery] = useState<string | null>(null);
  const selected = chosen ?? fromAddress?.key ?? cities[0]?.key ?? "";
  const query = typed ?? fromAddress?.name ?? "";

  function select(key: string) {
    const city = byKey.get(key);
    if (!city) return;
    setChosen(key);
    setQuery(city.name);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("city", key);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The selection still shows; only the shareable URL is skipped.
    }
  }

  const city = byKey.get(selected) ?? cities[0];
  if (!city) return null;
  return (
    <ExplorerContext.Provider value={{ cities, map, stateName, economy, city, query, setQuery, select }}>{children}</ExplorerContext.Provider>
  );
}

/**
 * The city search: a combobox whose suggestions fold spellings ("St Pete" finds St. Petersburg).
 * Arrow keys move through the suggestions, Enter chooses, Escape closes.
 */
export function CitySearch() {
  const { cities, stateName, query, setQuery, select, city } = useExplorer();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-cities`;
  const typed = query.trim();
  const showing = open && typed !== "" && typed !== city.name;
  const suggestions = useMemo(
    () => (showing ? cities.filter((c) => cityMatches(typed, c.name)).slice(0, SUGGESTIONS) : []),
    [cities, typed, showing],
  );

  function choose(key: string) {
    select(key);
    setOpen(false);
  }

  return (
    <div role="search" className="relative max-w-[32rem]">
      <label htmlFor={`${id}-input`} className="block text-[14px] font-medium text-white">
        Find a city
      </label>
      <input
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={suggestions[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={query}
        placeholder={`A city in ${stateName}`}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && suggestions.length) {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp" && suggestions.length) {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = suggestions[active];
            if (pick) choose(pick.key);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="mt-2 block min-h-12 w-full rounded-full border border-white/70 bg-surface-0 px-5 text-[16px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-2 focus:outline-white"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${stateName} cities`}
        hidden={suggestions.length === 0}
        className="absolute inset-x-0 z-20 mt-2 max-h-80 overflow-auto rounded-2xl border border-border bg-surface-0 py-1 text-ink shadow-lg"
      >
        {suggestions.map((c, i) => (
          <li
            key={c.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(c.key)}
            onMouseEnter={() => setActive(i)}
            className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 text-[15px] ${i === active ? "bg-surface-200" : ""}`}
          >
            <span className="font-medium">{c.name}</span>
            <span className="text-[12px] text-ink-muted">
              <span className="tabular-nums">{COUNT.format(c.institutions)}</span> {c.institutions === 1 ? "institution" : "institutions"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 min-h-5 text-[13px] text-[#c9d6de]" aria-live="polite">
        {showing && suggestions.length === 0 ? (
          <>
            No {stateName} city matches &ldquo;{typed}&rdquo;.{" "}
            <Link href={`/institutions?q=${encodeURIComponent(typed)}`} className="font-medium text-white underline underline-offset-4">
              Search institutions by name
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** The selected city: its institutions with local branches, how many have fee data, and the way into its comparison. */
export function SelectedCity() {
  const { city, map, economy, stateName } = useExplorer();
  const onMap = !map || map.points.some((p) => p.key === city.key);
  return (
    <div aria-live="polite" className="max-w-[32rem] rounded-2xl bg-surface-0 p-5 text-ink sm:p-6">
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">{city.name}</h2>
      <p className="mt-2 text-[15px] text-ink-soft">
        <span className="tabular-nums">{COUNT.format(city.institutions)}</span>{" "}
        {city.institutions === 1 ? "bank or credit union with local branches" : "banks and credit unions with local branches"}
      </p>
      <p className="mt-1 text-[15px] font-semibold text-ink">
        <span className="tabular-nums">{COUNT.format(city.withFees)}</span> {city.withFees === 1 ? "has" : "have"} published fee data in the index
      </p>
      <Link
        href={city.href}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-on-ink hover:bg-ink/90"
      >
        Compare {city.name} fees
        <span aria-hidden="true">&rarr;</span>
      </Link>
      <p className="mt-3 text-[13px] text-ink-muted">Coverage varies by institution and fee category.</p>
      {!onMap && <p className="mt-1 text-[12px] text-ink-muted">Its branch records carry no map coordinates, so it has no marker.</p>}
      {economy !== undefined && <LocalEconomy economy={economy} city={city} stateName={stateName} />}
    </div>
  );
}

/**
 * The selected city's county economy beside the state's: Census and BLS figures, each source
 * and year named. Neither publishes a figure for the city itself, so the county is named.
 */
function LocalEconomy({ economy, city, stateName }: { economy: StateLocalEconomy | null; city: ExplorerCity; stateName: string }) {
  const view = cityEconomyView(economy, city.economyKey ?? "", stateName);
  return (
    <section aria-label="Local economy" className="mt-5 border-t border-border pt-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Local economy</h3>
      {view.status === "ok" ? (
        <>
          <p className="mt-1 text-[14px] text-ink-soft">
            {view.county}, the county with most of {city.name}&apos;s bank branches
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {view.rows.map((row) => (
              <div key={row.label}>
                <dt className="text-[12px] text-ink-muted">{row.label}</dt>
                <dd className="font-mono text-[18px] tabular-nums text-ink">{row.value}</dd>
                {row.compare && <dd className="text-[12px] tabular-nums text-ink-muted">{row.compare}</dd>}
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-snug text-ink-muted">Sources: {view.sources.join("; ")}.</p>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-ink-muted">
          {view.status === "unavailable"
            ? "Local economic figures could not be loaded just now."
            : view.status === "no_county"
              ? `${city.name}'s branch records name no county, so no county figures are shown.`
              : `No Census or BLS figures are stored yet for ${city.name}'s county.`}
        </p>
      )}
    </section>
  );
}

/**
 * The state image, unchanged: a marker per city sized by institutions with a branch there. A
 * marker selects its city; without scripts it opens the city's comparison. Markers the search
 * does not match fade while the reader types.
 */
export function ExplorerMap() {
  const { cities, map, stateName, city, query, select } = useExplorer();
  const typed = query.trim();
  const dimmed = useMemo(
    () => (typed && typed !== city.name ? new Set(cities.filter((c) => !cityMatches(typed, c.name)).map((c) => c.key)) : undefined),
    [cities, typed, city.name],
  );
  if (!map) return null;
  const markers: CityMarker[] = cities.map((c) => ({
    key: c.key,
    name: c.name,
    institutions: c.institutions,
    withFees: c.withFees,
    selectHref: c.href,
  }));
  return (
    <figure className="mx-auto w-full max-w-[26rem] rounded-2xl bg-paper p-4 sm:max-w-none sm:p-5">
      <StateCityMap
        map={map}
        markers={markers}
        selected={city.key}
        onSelect={select}
        dimmed={dimmed}
        label={`${stateName} cities with published fees, sized by institutions with a branch`}
        focusable={false}
      />
      <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-ink-muted sm:justify-start">
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
  );
}
