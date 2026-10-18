/**
 * Hamilton's door to every dataset in the data catalog: listData says what exists and how to ask
 * for it, queryData reads one measure at one scope. queryData writes all SQL itself from a measure
 * and a scope (no model-written SQL) and refuses anything the catalog may not show. Shared by
 * Hamilton's chat (hamilton-agent.ts) and its written answer (research/agents.ts).
 */
import { tool } from "ai";
import { z } from "zod";
import {
  CALL_MEASURE_PREFIX,
  CALL_REPORT_ROW_SOURCES,
  DATA_CATALOG,
  FACT_MEASURE_PREFIX,
  FACT_MEASURES,
  FAMILY_MEASURE,
  type CatalogScopeKind,
} from "@/lib/data-catalog/catalog";
import { queryData as runQueryData, queryDataInputSchema } from "@/lib/data-catalog/query-data";
import { hqLevelFor } from "@/lib/data-catalog/roll-ups";
import { getAreaSeries, type CatalogSeries } from "@/lib/data-catalog/series";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { FFIEC_CALL_ITEMS } from "@/lib/regulatory/ffiec-call-items";

/** How long listData waits for a cold series list before answering with the sources alone. */
export const LIST_DATA_SERIES_WAIT_MS = 8_000;
export const LIST_DATA_MAX_SERIES = 60;

const SCOPES = ["institution", "peer_set", "state", "county", "metro", "national"] as const satisfies readonly CatalogScopeKind[];
/** Levels a call-report line answers at: the institution itself, or rolled up over a group. */
const CALL_LEVELS: CatalogScopeKind[] = ["institution", "peer_set", "state", "metro", "national"];

/** Starts filling the day-long series cache without waiting for it, so a chat turn rarely finds it cold. */
export function warmDataCatalog(): void {
  void getAreaSeries().catch(() => undefined);
}

/** Words that find the corporate-family measure (family:lei) in listData. */
const FAMILY_WORDS = "corporate family parent parents subsidiary subsidiaries holding company owner owns ownership affiliate lei";

/** Words that say nothing about which dataset a question needs. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "data", "for", "from", "how", "in", "is", "of", "on", "or",
  "the", "to", "what", "which", "with", "county", "counties", "state", "states", "metro", "national", "nation",
]);

function words(query: string | undefined): string[] {
  return (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** How many of the terms appear in the text; every text scores 1 when there are no terms. */
function score(text: string, terms: string[]): number {
  if (terms.length === 0) return 1;
  const hay = text.toLowerCase();
  return terms.filter((term) => hay.includes(term)).length;
}

function matches(text: string, terms: string[]): boolean {
  return score(text, terms) > 0;
}

async function seriesWithin(ms: number): Promise<CatalogSeries[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([getAreaSeries().catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The servable sources, series and fee measures that match a question's keywords and level. */
export async function listDataCatalog(input: { query?: string; scope?: CatalogScopeKind }, waitMs = LIST_DATA_SERIES_WAIT_MS) {
  const terms = words(input.query);
  const servable = DATA_CATALOG.filter((entry) => entry.servable && entry.measurePrefix);
  const series = await seriesWithin(waitMs);
  const servableIds = new Set(servable.filter((e) => e.kind === "public-data").map((e) => e.id));
  const labelById = new Map(servable.map((e) => [e.id, e.label]));

  // Best match first: the series hitting the most terms, so a broad word cannot push the right one past the cap.
  const matchedSeries = (series ?? [])
    .filter((s) => servableIds.has(s.source) && (!input.scope || s.geo_types.includes(input.scope) || input.scope === "institution" || input.scope === "peer_set"))
    .map((s) => ({ s, hits: score(`${s.source} ${s.series_key} ${labelById.get(s.source) ?? ""}`, terms) }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(({ s }) => s);
  const sourcesWithSeries = new Set(matchedSeries.map((s) => s.source));
  const sources = servable
    .filter((e) => e.kind === "fee-data" || sourcesWithSeries.has(e.id) || matches(`${e.id} ${e.label}${e.measurePrefix === FAMILY_MEASURE ? ` ${FAMILY_WORDS}` : ""}`, terms))
    .map((e) => ({
      id: e.id,
      label: e.label,
      publisher: e.publisher,
      cadence: e.cadence,
      levels: e.kind === "fee-data"
        ? ["institution", "peer_set", "state", "national"]
        : e.measurePrefix === FAMILY_MEASURE
          ? ["institution"]
          : e.measurePrefix === CALL_MEASURE_PREFIX
          ? CALL_LEVELS
          : e.measurePrefix === FACT_MEASURE_PREFIX
            ? ["institution"]
            : [...e.areaGeoTypes.map((g) => (g === "nation" ? "national" : g)), ...(hqLevelFor(e.areaGeoTypes) ? ["peer_set"] : [])],
      measure_prefix: e.measurePrefix,
    }));

  const feeMeasures = Object.values(FEE_FAMILIES)
    .flat()
    .filter((category) => matches(`${category} ${getDisplayName(category)} fee`, terms))
    .map((category) => ({ measure: `fee:${category}`, name: getDisplayName(category) }));

  // Bank call-report lines are a fixed list; NCUA lines are chosen from each quarter's file, so they are not listed here.
  const callMeasures = servable.some((e) => e.id === CALL_REPORT_ROW_SOURCES.ffiec)
    ? FFIEC_CALL_ITEMS.filter((item) => terms.length > 0 && matches(`${item.key.replace(/_/g, " ")} call report`, terms)).map((item) => ({
        measure: `${CALL_MEASURE_PREFIX}${item.key}`,
        name: item.key.replace(/_ytd$/, " (year to date)").replace(/_/g, " "),
        unit: item.unit === "count" ? "count" : "USD",
        levels: CALL_LEVELS,
      }))
    : [];

  // Institution facts read from each institution's own documents (fact:<name>), one institution at a time.
  const factMeasures = Object.entries(FACT_MEASURES)
    .filter(([key, fact]) => servable.some((e) => e.id === fact.source) && terms.length > 0 && matches(`${key.replace(/_/g, " ")} ${fact.name}`, terms))
    .map(([key, fact]) => ({ measure: `${FACT_MEASURE_PREFIX}${key}`, name: fact.name, levels: ["institution"] }));

  return {
    sources,
    series: matchedSeries.slice(0, LIST_DATA_MAX_SERIES).map((s) => ({
      measure: s.measure,
      source: labelById.get(s.source) ?? s.source,
      unit: s.unit,
      levels: s.geo_types,
      period_min: s.period_min,
      period_max: s.period_max,
    })),
    fee_measures: feeMeasures,
    ...(callMeasures.length ? { call_measures: callMeasures.slice(0, LIST_DATA_MAX_SERIES) } : {}),
    ...(factMeasures.length ? { fact_measures: factMeasures } : {}),
    ...(series === null
      ? { note: "The list of public-data series is not available right now. Fee measures (fee:<category>) still work." }
      : matchedSeries.length > LIST_DATA_MAX_SERIES
        ? { note: `${matchedSeries.length} series match; the first ${LIST_DATA_MAX_SERIES} are listed. Narrow the query to see others.` }
        : {}),
  };
}

export const listData = tool({
  description:
    "List the datasets you can query with queryData: public data (Census Bureau, BLS, BEA, FDIC, FHFA, CFPB and other public publishers) by county, metro, state or nation, published fees by category, bank call-report lines (service-charge income, deposits, expenses), and an institution's corporate family (parent companies and subsidiaries, from GLEIF). Pass keywords from the question (for example 'unemployment', 'median household income', 'overdraft'). Returns each measure id to pass to queryData, its unit, the levels it covers and the periods loaded.",
  inputSchema: z.object({
    query: z.string().max(200).optional().describe("Keywords from the question"),
    scope: z.enum(SCOPES).optional().describe("The level the question is about"),
  }),
  execute: async ({ query, scope }) => listDataCatalog({ query, scope }),
});

export const queryData = tool({
  description:
    "Read one measure from the data catalog at one scope. measure is an id from listData: 'area:<source>:<series_key>' for public data, 'fee:<category>' for published fees, 'call:<item_key>' for a call-report line, 'fact:<name>' for an institution fact read from its own documents (for example 'fact:offers_zelle'; institution scope only, answered yes, no or unclear with the document link), or 'family:lei' for an institution's corporate family (its parents, subsidiaries and affiliates from GLEIF, with scope institution only). scope.kind is institution (scope.id is the institution id; public data resolves to its headquarters county, metro and state; a call-report line is the institution's own filed values), peer_set (scope.peer holds the filters, scope.id the subject institution; public data and call-report lines come back as the group's median with institution_count behind it, and no median when fewer than 5 institutions have a figure), state (two-letter code), county (5-digit FIPS), metro (5-digit CBSA) or national. period.from and period.to take a year, 2026Q2 or 2026-09. Returns rows and a citation (publisher, source URL, as-of date), or ok:false with the reason it cannot answer.",
  inputSchema: queryDataInputSchema,
  execute: async (input) => runQueryData(input),
});

export const DATA_CATALOG_INSTRUCTION =
  "PUBLIC DATA: For local economic or demographic context (unemployment, income, population, housing, deposit rates, business formation and other public statistics) or a fee figure at a scope the other tools do not cover, call listData with keywords from the question, then queryData with a measure it returned. Use only measures listData returned. Cite every figure from queryData with its citation: the publisher and the as-of period, formatted as (Source: {publisher}, {as_of}), followed by the citation's attribution text, word for word, whenever it has one. When queryData returns ok:false, say plainly that the figure is not available and why, in one clause, and do not estimate it.";
