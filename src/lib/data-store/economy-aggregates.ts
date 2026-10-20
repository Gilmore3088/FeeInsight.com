import { STATE_FROM_FIPS } from "@/lib/regulatory/economy";
import { sql } from "./connection";

/**
 * Area helpers for the data catalog's reads over the local-economy tables Magellan's economy
 * steps fill (area_statistics, institution_hq_counties). Server only. Nothing here fetches from
 * outside.
 */

export type AreaGeoType = "nation" | "state" | "county" | "metro";

/** Normalises a caller's area code: state as postal code (FIPS accepted), county as 5-digit FIPS, metro as 5-digit CBSA. */
export function normalizeGeoCode(geoType: AreaGeoType, code: string): string | null {
  const raw = code.trim().toUpperCase();
  switch (geoType) {
    case "nation":
      return "US";
    case "state":
      if (/^[A-Z]{2}$/.test(raw)) return raw;
      return /^\d{1,2}$/.test(raw) ? STATE_FROM_FIPS[raw.padStart(2, "0")] ?? null : null;
    case "county":
      return /^\d{4,5}$/.test(raw) ? raw.padStart(5, "0") : null;
    case "metro":
      return /^\d{5}$/.test(raw) ? raw : null;
  }
}

export interface InstitutionHqLocation {
  state_code: string | null;
  cbsa_code: string | null;
  county_fips: string | null;
  /** How the HQ county was found (SOD main office, geocoded NCUA main office, or county name). */
  basis: string | null;
  urban_rural: string | null;
}

/** Where one institution's main office sits: state, metro (CBSA) and HQ county. Null when the institution is unknown. */
export async function getInstitutionHqLocation(institutionId: number): Promise<InstitutionHqLocation | null> {
  const [row] = await sql<InstitutionHqLocation[]>`
    SELECT s.state_code, s.cbsa_code, s.urban_rural, h.county_fips, h.basis
      FROM institution_sources s
      LEFT JOIN institution_hq_counties h ON h.institution_id = s.id
     WHERE s.id = ${institutionId}
     LIMIT 1
  `;
  return row ?? null;
}
