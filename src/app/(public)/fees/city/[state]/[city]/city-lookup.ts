import { cache } from "react";
import { getCityInstitutions } from "@/lib/data-store";

// Shared by the layout, generateMetadata and the page so the query runs once per request.
export const loadCityInstitutions = cache(getCityInstitutions);

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

export { canonicalCityName, cityPath, decodedSegment } from "./city-address";
