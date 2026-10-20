import { notFound, permanentRedirect } from "next/navigation";
import { cityHasBranches, fullCityForCut } from "@/lib/data-store";
import { STATE_NAMES } from "@/lib/us-states";
import { cityPath, decodedSegment, dottedCityName, loadCanonicalCityName, loadCityInstitutions, titleCase } from "./city-lookup";

/**
 * A city with no institutions and no bank or credit union branch answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200. The
 * state is checked by the `[state]` layout above.
 *
 * Two misses redirect permanently instead, so old links and search results land on the right
 * page:
 * - a city name NCUA cut at 15 characters ("colorado spring") that no institution keeps any
 *   more goes to the full name its institutions moved to (#1213);
 * - an address that dropped the period of a short word ("st-louis") goes to the stored
 *   spelling ("st.%20louis") (#1267).
 *
 * Every spelling of a city the fold reads as one ("saint petersburg", "st-louis", "st.-louis",
 * `src/lib/geo/city-names.ts`) redirects permanently to its one address (#2092): the spelling
 * the state directory links to, or, for a city the directory does not list, the headquarters
 * spelling the city lists and the sitemap use. The headquarters list folds spellings too, so
 * without this every spelling would render its own copy of the page.
 */
export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city } = await params;
  const stateCode = state.toUpperCase();
  const cityName = titleCase(city);
  // An unknown state never reaches the cached read, so junk addresses add no cache entries.
  if (!STATE_NAMES[stateCode]) notFound();
  const canonical = await loadCanonicalCityName(stateCode, cityName);
  // Compared as the address itself, so "wilkes-barre" for WILKES-BARRE (which titleCase reads as
  // "Wilkes Barre") is already home and never redirects to itself.
  const segment = decodedSegment(city);
  if (canonical && segment !== null && cityPath(state, canonical) !== cityPath(state, segment)) {
    permanentRedirect(cityPath(state, canonical));
  }
  const institutions = await loadCityInstitutions(cityName, stateCode);
  // A city is a market when a bank or credit union has a branch there, wherever it is headquartered.
  if (institutions.length === 0 && !(await cityHasBranches(cityName, stateCode))) {
    const dotted = dottedCityName(cityName);
    if (dotted && (await loadCityInstitutions(dotted, stateCode)).length > 0) {
      permanentRedirect(cityPath(state, dotted));
    }
    const full = await fullCityForCut(cityName, state);
    if (full && (await loadCityInstitutions(titleCase(full), stateCode)).length > 0) {
      permanentRedirect(cityPath(state, full));
    }
    notFound();
  }
  return children;
}
