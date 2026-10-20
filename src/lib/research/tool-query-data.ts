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
import { getNcuaCallSeries } from "@/lib/data-catalog/ncua-call-series";
import { NCUA_CALL_MEASURES } from "@/lib/data-catalog/ncua-call-measures";
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

async function within<T>(load: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([load().catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The servable sources, series and fee measures that match a question's keywords and level. */
export async function listDataCatalog(input: { query?: string; scope?: CatalogScopeKind }, waitMs = LIST_DATA_SERIES_WAIT_MS) {
  const terms = words(input.query);
  const servable = DATA_CATALOG.filter((entry) => entry.servable && entry.measurePrefix);
  const ncuaEntry = servable.find((entry) => entry.id === CALL_REPORT_ROW_SOURCES.ncua);
  const callScope = !input.scope || CALL_LEVELS.includes(input.scope);
  const wantsNcua = Boolean(ncuaEntry && callScope && terms.length > 0 && NCUA_CALL_MEASURES.some((m) =>
    matches(`NCUA credit union ${m.key} ${m.name} ${m.description}`, terms)));
  // Both metadata lists share the wait budget. A cold NCUA read cannot add another eight seconds.
  const [series, ncuaSeries] = await Promise.all([
    within<CatalogSeries[]>(getAreaSeries, waitMs),
    wantsNcua ? within(getNcuaCallSeries, waitMs) : Promise.resolve([]),
  ]);
  const ncuaMeasures = (ncuaSeries ?? [])
    .map((m) => ({ m, hits: score(`NCUA credit union ${m.key} ${m.name} ${m.description}`, terms) }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(({ m }) => ({
      measure: `${CALL_MEASURE_PREFIX}${m.key}`,
      name: `NCUA: ${m.name}`,
      description: m.description,
      source: CALL_REPORT_ROW_SOURCES.ncua,
      publisher: ncuaEntry!.publisher,
      item_code: m.code,
      unit: m.unit,
      period_basis: m.periodBasis,
      period_min: m.periodMin,
      period_max: m.periodMax,
      source_url: m.sourceUrl,
      fetched_at: m.fetchedAt,
      caveat: m.caveat,
      levels: CALL_LEVELS,
    }));
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
    .filter((e) => e.kind === "fee-data" || sourcesWithSeries.has(e.id) || (e.id === CALL_REPORT_ROW_SOURCES.ncua && ncuaMeasures.length > 0) || matches(`${e.id} ${e.label}${e.measurePrefix === FAMILY_MEASURE ? ` ${FAMILY_WORDS}` : ""}`, terms))
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

  // Preserve bank keys; advertise only the six curated NCUA lines with comparable stored filings.
  const bankCallMeasures = callScope && servable.some((e) => e.id === CALL_REPORT_ROW_SOURCES.ffiec)
    ? FFIEC_CALL_ITEMS.filter((item) => terms.length > 0 && matches(`${item.key.replace(/_/g, " ")} call report`, terms)).map((item) => ({
        measure: `${CALL_MEASURE_PREFIX}${item.key}`,
        name: item.key.replace(/_ytd$/, " (year to date)").replace(/_/g, " "),
        unit: item.unit === "count" ? "count" : "USD",
        levels: CALL_LEVELS,
      }))
    : [];
  const callMeasures = [...ncuaMeasures, ...bankCallMeasures];

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
    ...((series === null || matchedSeries.length > LIST_DATA_MAX_SERIES || wantsNcua) ? {
      note: [
        series === null ? "The list of public-data series is not available right now. Fee measures (fee:<category>) still work." : null,
        matchedSeries.length > LIST_DATA_MAX_SERIES ? `${matchedSeries.length} series match; the first ${LIST_DATA_MAX_SERIES} are listed. Narrow the query to see others.` : null,
        wantsNcua && ncuaSeries === null ? "NCUA call-report measure discovery is unavailable right now; do not invent account keys." : null,
        wantsNcua && ncuaSeries?.length === 0 ? "None of the six selected NCUA measures has comparable loaded filings right now; missing figures are not zero." : null,
        wantsNcua && ncuaSeries && ncuaSeries.length > 0 && ncuaMeasures.length === 0 ? "No selected NCUA measure matching these keywords has comparable loaded filings; missing figures are not zero." : null,
        ncuaMeasures.length > 0 ? "NCUA period bounds describe loaded comparable filings, not coverage of every quarter or institution. These credit-union measures are not bank equivalents; retain each measure's basis and caveat." : null,
      ].filter(Boolean).join(" "),
    } : {}),
  };
}

export const listData = tool({
  description:
    "List the datasets you can query with queryData: public data (Census Bureau, BLS, BEA, FDIC, FHFA, CFPB and other public publishers) by county, metro, state or nation, published fees by category, bank call-report lines (service-charge income, deposits, expenses), selected NCUA credit-union lines (share accounts/balances, full-time employees, fee income and share dividends), and an institution's corporate family (parent companies and subsidiaries, from GLEIF). Pass keywords from the question (for example 'unemployment', 'median household income', 'NCUA fee income'). Returns each measure id to pass to queryData, its unit, period basis, caveats, levels and loaded period bounds.",
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
  "PUBLIC DATA: For local economic or demographic context (unemployment, income, population, housing, deposit rates, business formation and other public statistics), a credit-union call-report metric (accounts, share balances, staffing, fee income or dividends), or a fee figure at a scope the other tools do not cover, call listData with keywords from the question, then queryData with a measure it returned. Use only measures listData returned. Preserve each measure's period_basis and caveat: year-to-date income/expense is not a standalone quarter or annualized figure, account counts are not members, and employee headcount is not FTEs. NCUA credit-union lines are not interchangeable with bank lines or consumer fee prices. Cite every figure from queryData with its citation: the publisher and the as-of period, formatted as (Source: {publisher}, {as_of}), followed by the citation's attribution text, word for word, whenever it has one. When queryData returns ok:false, say plainly that the figure is not available and why, in one clause, and do not estimate it. An empty result is missing evidence, never a zero.";
