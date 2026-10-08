/**
 * The catalog's "Compare a segment" option (it used to be its own Market page): pick a charter,
 * asset tier or state and each fee type shows that segment's median next to the national one.
 */

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

export interface CatalogSegment {
  charter: string;
  tier: string;
  state: string;
}

/** Only known values pass, so a hand-typed URL can't put junk into the query or the label. */
export function parseSegment(params: { charter?: string; tier?: string; state?: string }): CatalogSegment | null {
  const charter = SEGMENT_CHARTERS.some((c) => c.value === params.charter) ? params.charter! : "";
  const tier = SEGMENT_TIERS.some((t) => t.value === params.tier) ? params.tier! : "";
  const rawState = (params.state ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(rawState) ? rawState : "";
  return charter || tier || state ? { charter, tier, state } : null;
}

/** "Credit unions · $100M to $1B · TX" */
export function segmentLabel(segment: CatalogSegment): string {
  return [
    SEGMENT_CHARTERS.find((c) => c.value === segment.charter)?.label,
    SEGMENT_TIERS.find((t) => t.value === segment.tier)?.label,
    segment.state || undefined,
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
  return out;
}
