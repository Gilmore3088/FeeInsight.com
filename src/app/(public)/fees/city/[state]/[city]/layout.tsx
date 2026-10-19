import { notFound, permanentRedirect } from "next/navigation";
import { cityHasBranches, fullCityForCut } from "@/lib/data-store";
import { getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { STATE_NAMES } from "@/lib/us-states";
import { cityPath, dottedCityName, loadCityInstitutions, titleCase } from "./city-lookup";

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
 * A second spelling of a city the state directory folds into one ("saint petersburg" beside
 * "st. petersburg", `src/lib/geo/city-names.ts`) redirects permanently to the spelling the
 * directory links to, so one market has one address. The check reads the directory's cached list.
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
  const asked = cityName.toUpperCase();
  const directory = await getStateMarketCitiesCached(stateCode).catch(() => []);
  const folded = directory.find((c) => c.city !== asked && c.spellings.includes(asked));
  // The address already reads as the directory's spelling ("wilkes-barre" for WILKES-BARRE, which
  // titleCase reads as "Wilkes Barre"): redirecting would send it to itself.
  if (folded && titleCase(folded.city) !== cityName && cityPath(state, folded.city) !== cityPath(state, cityName)) {
    permanentRedirect(cityPath(state, folded.city));
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
