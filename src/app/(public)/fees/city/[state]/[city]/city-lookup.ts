import { cache } from "react";
import { getCityInstitutions } from "@/lib/data-store";

// Shared by the layout, generateMetadata and the page so the query runs once per request.
export const loadCityInstitutions = cache(getCityInstitutions);

export function titleCase(s: string): string {
  return decodeURIComponent(s)
    .split(/[-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
