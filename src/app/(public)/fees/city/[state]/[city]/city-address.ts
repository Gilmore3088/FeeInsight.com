import { cityKey } from "@/lib/geo/city-names";

/** A city's address, kept free of data reads so the sitemap can share it. Pure. */

/** The one address for a city: its stored name, lowercased and encoded. */
export function cityPath(stateCode: string, cityName: string): string {
  return `/fees/city/${stateCode.toLowerCase()}/${encodeURIComponent(cityName.toLowerCase())}`;
}

/**
 * The one name a city is addressed under once its spellings are folded (#2092): the state
 * directory's spelling when the directory lists the city (it links there), otherwise the
 * headquarters spelling the city lists use. Null when neither knows the city. The layout
 * redirects every other spelling here and the sitemap lists only this one.
 */
export function canonicalCityName(asked: string, directory: { city: string }[], hqName: string | null): string | null {
  const key = cityKey(asked);
  if (!key) return null;
  return directory.find((c) => cityKey(c.city) === key)?.city ?? (hqName && cityKey(hqName) === key ? hqName : null);
}

/** The city a URL segment names, decoded and lower case; null for a malformed escape. */
export function decodedSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return null;
  }
}
