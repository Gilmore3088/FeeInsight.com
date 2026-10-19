import { cache } from "react";
import { getCityInstitutions, hqCityName } from "@/lib/data-store";
import { getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { canonicalCityName, cityPath, decodedSegment } from "./city-address";

// Shared by the layout, generateMetadata and the page so the query runs once per request.
export const loadCityInstitutions = cache(getCityInstitutions);

/**
 * The name a city page is kept under (#2092), shared by the layout's redirect and the page's
 * canonical tag so the two never disagree. Null when it cannot be told for sure: the city is
 * unknown, or the state directory read failed. A failed directory read must not fall back to
 * the headquarters spelling, or the address would 301 one way while the read fails and back
 * once it recovers (a loop for any browser that cached the first 301).
 */
export const loadCanonicalCityName = cache(async (stateCode: string, cityName: string): Promise<string | null> => {
  let directory: { city: string }[];
  try {
    directory = await getStateMarketCitiesCached(stateCode);
  } catch {
    return null;
  }
  const listed = canonicalCityName(cityName, directory, null);
  if (listed) return listed;
  const hq = await hqCityName(cityName, stateCode).catch(() => null);
  return canonicalCityName(cityName, [], hq);
});

/**
 * The city name in a URL segment, title-cased. A malformed escape ("%E0%A4%A") is kept as
 * typed rather than thrown: it names no city, so the layout answers 404, not 500 (#1267).
 */
export function titleCase(s: string): string {
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // Malformed escape: keep the raw segment.
  }
  return decoded
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * The same city with its short words dotted, as the registers spell them: "St Louis" is
 * stored as "St. Louis" (#1267). A hyphenated address ("st-louis") loses the period, so the
 * layout tries this spelling before answering 404. Null when there is nothing to dot.
 */
export function dottedCityName(cityName: string): string | null {
  const dotted = cityName.replace(/\b(St|Ste|Ft|Mt)\b(?!\.)/g, "$1.");
  return dotted === cityName ? null : dotted;
}

export { canonicalCityName, cityPath, decodedSegment };

/**
 * The page's canonical address: the one the layout keeps (#2092), so "wilkes-barre" names
 * itself rather than "wilkes%20barre", which redirects back. When that name cannot be told (an
 * unknown city, a failed directory read), the address as requested, which the layout let render.
 */
export async function cityCanonicalPath(state: string, city: string): Promise<string> {
  const canonical = await loadCanonicalCityName(state.toUpperCase(), titleCase(city)).catch(() => null);
  return cityPath(state, canonical ?? decodedSegment(city) ?? titleCase(city));
}
