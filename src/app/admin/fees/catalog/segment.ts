/**
 * The catalog's "Compare a segment" option (it absorbed the old Market and Peers pages): pick a
 * charter, asset tier, state or Fed district and each fee type shows that segment's median next
 * to the national one.
 */

import { DISTRICT_NAMES } from "@/lib/fed-districts";

export const SEGMENT_CHARTERS = [
  { value: "bank", label: "Banks" },
  { value: "credit_union", label: "Credit unions" },
] as const;

export const SEGMENT_TIERS = [
  { value: "micro", label: "Under $100M" },
  { value: "community", label: "$100M to $1B" },
  { value: "midsize", label: "$1B to $10B" },
  { value: "regional", label: "$10B to $250B" },
  { value: "mega", label: "Over $250B" },
] as const;

/** The twelve Federal Reserve districts, for the segment's district picker. */
export const SEGMENT_DISTRICTS = Object.entries(DISTRICT_NAMES).map(([id, name]) => ({
  value: id,
  label: `${id} - ${name}`,
}));

export interface CatalogSegment {
  charter: string;
  tier: string;
  state: string;
  /** Fed district "1" to "12", or "" (the filter the old Peers page had). */
  district: string;
}

/** Only known values pass, so a hand-typed URL can't put junk into the query or the label. */
export function parseSegment(params: {
  charter?: string;
  tier?: string;
  state?: string;
  district?: string;
}): CatalogSegment | null {
  const charter = SEGMENT_CHARTERS.some((c) => c.value === params.charter) ? params.charter! : "";
  const tier = SEGMENT_TIERS.some((t) => t.value === params.tier) ? params.tier! : "";
  const rawState = (params.state ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(rawState) ? rawState : "";
  const rawDistrict = (params.district ?? "").trim();
  const district = SEGMENT_DISTRICTS.some((d) => d.value === rawDistrict) ? rawDistrict : "";
  return charter || tier || state || district ? { charter, tier, state, district } : null;
}

/** "Credit unions · $100M to $1B · TX · District 11 (Dallas)" */
export function segmentLabel(segment: CatalogSegment): string {
  return [
    SEGMENT_CHARTERS.find((c) => c.value === segment.charter)?.label,
    SEGMENT_TIERS.find((t) => t.value === segment.tier)?.label,
    segment.state || undefined,
    segment.district ? `District ${segment.district} (${DISTRICT_NAMES[Number(segment.district)]})` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The segment as URL params, so sorting and paging keep it. */
export function segmentParams(segment: CatalogSegment | null): Record<string, string> {
  if (!segment) return {};
  const out: Record<string, string> = {};
  if (segment.charter) out.charter = segment.charter;
  if (segment.tier) out.tier = segment.tier;
  if (segment.state) out.state = segment.state;
  if (segment.district) out.district = segment.district;
  return out;
}
