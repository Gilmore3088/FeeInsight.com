import { notFound, permanentRedirect } from "next/navigation";
import { fullCityForCut } from "@/lib/data-store";
import { cityPath, dottedCityName, loadCityInstitutions, titleCase } from "./city-lookup";

/**
 * A city with no institutions answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200. The
 * state is checked by the `[state]` layout above.
 *
 * Two misses redirect permanently instead, so old links and search results land on the right
 * page:
 * - a city name NCUA cut at 15 characters ("colorado spring") that no institution keeps any
 *   more goes to the full name its institutions moved to (#1213);
 * - an address that dropped the period of a short word ("st-louis") goes to the stored
 *   spelling ("st.%20louis") (#1267).
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
  const institutions = await loadCityInstitutions(cityName, stateCode);
  if (institutions.length === 0) {
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
