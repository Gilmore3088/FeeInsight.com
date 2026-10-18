import type {
  HoovieCadence,
  HoovieGrain,
  HoovieLicence,
  HoovieLicenceStatus,
  HoovieLinkKey,
  HoovieSourceContract,
} from "@/lib/agents/hoovie/contract";
import { HOOVIE_SOURCES } from "@/lib/agents/hoovie/sources";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { AreaGeoType } from "@/lib/data-store/economy-aggregates";
import { HELD_SOURCES, STRUCK_AREA_SOURCES } from "@/lib/data-store/struck-sources";

/**
 * The data catalog: one entry for every dataset Fee Insight holds that an answer can draw on,
 * the public-data sources (one per Hoovie contract) plus the published fee data and institution
 * financials. Hamilton and the site read it to know what exists, at what level, how fresh, and
 * whether it may be shown to a customer. Labels name the publisher and dataset a reader would
 * know, never a pipeline agent.
 *
 * `servable` is the one gate: the licence lets us show the data to customers (public domain, a
 * named open licence, or Fee Insight's own published data) and the source is not struck or held
 * under DECISIONS.md "No non-commercial data". Row-level strikes (one struck URL, one struck
 * FRED series) are filtered by the readers, not here.
 */

/** Licence statuses a catalog entry can carry: a contract's, or Fee Insight's own published data. */
export type CatalogLicenceStatus = HoovieLicenceStatus | "fee-insight";

export interface CatalogLicence extends Omit<HoovieLicence, "status"> {
  status: CatalogLicenceStatus;
}

/** The levels a question can be asked at. `national` is area_statistics' `nation`. */
export type CatalogScopeKind = "institution" | "peer_set" | "state" | "county" | "metro" | "national";

export type CatalogKind = "public-data" | "fee-data" | "financials";

export interface CatalogEntry {
  /** The registry source key for public data; a fixed id for fee data and financials. */
  id: string;
  /** What a customer reads: the publisher and dataset. Never a pipeline agent's name. */
  label: string;
  publisher: string;
  kind: CatalogKind;
  grain: HoovieGrain[];
  /** The area_statistics geo types this source writes (empty when it writes none). */
  areaGeoTypes: AreaGeoType[];
  cadence: HoovieCadence;
  linkKeys: HoovieLinkKey[];
  tables: string[];
  licence: CatalogLicence;
  servable: boolean;
  /** Why the entry may not be shown, in plain words; null when servable. */
  notServableReason: string | null;
  /** How `queryData` addresses this entry: "area:<id>:" plus a series key, "fee:" plus a category, or null when it has no query yet. */
  measurePrefix: string | null;
}

/** Licences whose data may be shown to customers. */
export const SERVABLE_LICENCES: readonly CatalogLicenceStatus[] = ["public-domain", "open-licence", "fee-insight"];

/** Internal pipeline agent names. None may appear in a customer-facing label. */
export const PIPELINE_AGENT_NAMES: readonly string[] = [
  "Hoovie", "Magellan", "Atlas", "Rosetta", "Knox", "Darwin", "Hamilton", "Gutenberg", "Deming", "Bayes",
];

const GRAIN_TO_AREA_GEO: Partial<Record<HoovieGrain, AreaGeoType>> = {
  national: "nation",
  state: "state",
  county: "county",
  metro: "metro",
};

/** area_statistics' `nation` is the contract's and the query scope's `national`. */
export function areaGeoTypeForScope(kind: CatalogScopeKind): AreaGeoType | null {
  switch (kind) {
    case "national":
      return "nation";
    case "state":
    case "county":
    case "metro":
      return kind;
    default:
      return null;
  }
}

export function scopeForAreaGeoType(geoType: AreaGeoType): CatalogScopeKind {
  return geoType === "nation" ? "national" : geoType;
}

export function isServable(licence: CatalogLicence, id: string): { servable: boolean; reason: string | null } {
  if (STRUCK_AREA_SOURCES.includes(id)) {
    return { servable: false, reason: "This source was struck: its terms do not allow commercial use." };
  }
  if (HELD_SOURCES.includes(id) || licence.status === "held") {
    return { servable: false, reason: "This source is held until its licence terms are confirmed." };
  }
  if (licence.status === "terms-unconfirmed") {
    return { servable: false, reason: "The terms for showing this source to customers are not confirmed yet." };
  }
  if (!SERVABLE_LICENCES.includes(licence.status)) {
    return { servable: false, reason: "This source's licence does not allow showing it to customers." };
  }
  return { servable: true, reason: null };
}

function fromContract(contract: HoovieSourceContract): CatalogEntry {
  const areaGeoTypes = contract.tables.includes("area_statistics")
    ? contract.grain.map((g) => GRAIN_TO_AREA_GEO[g]).filter((g): g is AreaGeoType => Boolean(g))
    : [];
  const { servable, reason } = isServable(contract.licence, contract.source);
  return {
    id: contract.source,
    label: contract.publisher,
    publisher: contract.publisher,
    kind: "public-data",
    grain: [...contract.grain],
    areaGeoTypes,
    cadence: contract.cadence,
    linkKeys: [...contract.linkKeys],
    tables: [...contract.tables],
    licence: { ...contract.licence },
    servable,
    notServableReason: reason,
    measurePrefix: areaGeoTypes.length > 0 ? `area:${contract.source}:` : null,
  };
}

const FEE_PUBLISHER = `${SITE_NAME}, ${PRODUCT_NAME}`;

/** Fee Insight's own data and the institution financials, which no single contract describes. */
const FIXED_ENTRIES: CatalogEntry[] = [
  {
    id: "published-fees",
    label: `${PRODUCT_NAME}: published dollar fees from bank and credit union fee schedules`,
    publisher: FEE_PUBLISHER,
    kind: "fee-data",
    grain: ["institution", "state", "fed-district", "national"],
    areaGeoTypes: [],
    cadence: "daily",
    linkKeys: ["fdic-cert", "ncua-charter", "rssd", "state", "fed-district"],
    tables: ["published_fee_catalog"],
    licence: { status: "fee-insight", note: "Fee Insight's own verified data, read from each institution's current fee schedule." },
    servable: true,
    notServableReason: null,
    measurePrefix: "fee:",
  },
  {
    id: "published-rate-fees",
    label: `${PRODUCT_NAME}: published fees stated as a rate (for example 1% of the transaction)`,
    publisher: FEE_PUBLISHER,
    kind: "fee-data",
    grain: ["institution", "national"],
    areaGeoTypes: [],
    cadence: "daily",
    linkKeys: ["fdic-cert", "ncua-charter", "rssd"],
    tables: ["published_fee_rate_catalog"],
    licence: { status: "fee-insight", note: "Never pooled with dollar fees (src/lib/percent-fees.ts)." },
    servable: true,
    notServableReason: null,
    measurePrefix: null,
  },
  {
    id: "institution-financials",
    label: "FDIC and NCUA call reports: institution financials",
    publisher: "FDIC, FFIEC and NCUA (call reports)",
    kind: "financials",
    grain: ["institution"],
    areaGeoTypes: [],
    cadence: "quarterly",
    linkKeys: ["fdic-cert", "ncua-charter", "rssd"],
    tables: ["institution_financial_records", "institution_call_report_items"],
    licence: { status: "public-domain" },
    servable: true,
    notServableReason: null,
    measurePrefix: null,
  },
];

/** Every catalog entry: the fixed fee and financials entries, then one per public-data contract in registry order. */
export const DATA_CATALOG: readonly CatalogEntry[] = [...FIXED_ENTRIES, ...HOOVIE_SOURCES.map(fromContract)];

const BY_ID = new Map(DATA_CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: string): CatalogEntry | null {
  return BY_ID.get(id) ?? null;
}

/** Public-data entries that write area_statistics, servable or not. */
export function areaCatalogEntries(): CatalogEntry[] {
  return DATA_CATALOG.filter((entry) => entry.areaGeoTypes.length > 0);
}
