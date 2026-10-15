import { notFound, permanentRedirect } from "next/navigation";
import { fullCityForCut } from "@/lib/data-store";
import { loadCityInstitutions, titleCase } from "./city-lookup";

/**
 * A city with no institutions answers 404 (#1165). The check sits in this layout, outside the
 * page's loading boundary: once a loading skeleton streams, the status is fixed at 200. The
 * state is checked by the `[state]` layout above.
 *
 * A city name NCUA cut at 15 characters ("colorado spring") that no institution keeps any more
 * redirects permanently to the full name its institutions moved to (#1213), so old links and
 * search results land on the right page.
 */
export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city } = await params;
  const cityName = titleCase(city);
  const institutions = await loadCityInstitutions(cityName, state.toUpperCase());
  if (institutions.length === 0) {
    const full = await fullCityForCut(cityName, state);
    if (full && (await loadCityInstitutions(titleCase(full), state.toUpperCase())).length > 0) {
      permanentRedirect(`/fees/city/${state.toLowerCase()}/${encodeURIComponent(full.toLowerCase())}`);
    }
    notFound();
  }
  return children;
}
