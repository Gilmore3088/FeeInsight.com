/**
 * Place names for the report and its excerpts. A leaf module with no imports, so the homepage
 * and /subscribe excerpts can label places without loading the full report body.
 */

/** "READING" -> "Reading", "KING OF PRUSSIA" -> "King of Prussia"; mixed-case names such as "McAllen" are kept. */
export function cityLabel(city: string): string {
  if (city !== city.toUpperCase()) return city;
  return city
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/ (Of|The|And|On|In) /g, (word) => word.toLowerCase());
}

/** "READING, PA" -> "Reading, PA": the city part only, so the state code stays upper case. */
export function placeLabel(place: string): string {
  const cut = place.lastIndexOf(", ");
  return cut < 0 ? cityLabel(place) : `${cityLabel(place.slice(0, cut))}${place.slice(cut)}`;
}
