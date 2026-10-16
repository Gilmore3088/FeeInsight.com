/**
 * Pure logic for /research/data-sources: every source the site draws on, what it gives us,
 * how often our copy refreshes, and the live counts the source map can show.
 * No database or React imports, so it is tested on its own (data-sources-view.test.ts).
 *
 * Each source below is checked against the code that reads it (named in its comment).
 * A source the code does not ingest is not listed; a refresh the code does not state is null.
 */

import { COVERAGE_LABELS, formatCount } from "@/lib/public-stats";
import { DISTRICT_NAMES } from "@/lib/fed-districts";

export type SourceGroupKey = "fees" | "institutions" | "revenue" | "regions" | "context";

export interface DataSource {
  /** Anchor id on the table row, so the map and other pages can link to it. */
  id: string;
  name: string;
  publisher: string;
  group: SourceGroupKey;
  /** What we take from it, in one line. */
  takes: string;
  /** How often our copy refreshes, as the code schedules it; null when the code does not say. */
  refresh: string | null;
  /** The source's own public site; null for the institutions' own schedules. */
  href: string | null;
}

export const DATA_SOURCES: readonly DataSource[] = [
  {
    // Magellan fetches each fee link, re-fetching one last fetched 30+ days ago
    // (MAGELLAN_STALE_LINK_REFETCH_DAYS, src/lib/agents/magellan/fetch.ts); published fees are
    // read from published_fee_catalog.
    id: "fee-schedules",
    name: "Institution fee schedules",
    publisher: "Each bank and credit union",
    group: "fees",
    takes: "Every fee's name and amount, tied to the document it came from.",
    refresh: "Monthly",
    href: null,
  },
  {
    // registry-fdic-universe: institution_sources identity, regulator, assets, Fed district;
    // REFRESH_HOURS = 24 * 7 (src/lib/agents/magellan/registry/fdic-universe.ts).
    id: "fdic-bankfind",
    name: "FDIC BankFind",
    publisher: "Federal Deposit Insurance Corporation",
    group: "institutions",
    takes: "The list of banks, with charter, regulator, assets and holding company.",
    refresh: "Weekly",
    href: "https://banks.data.fdic.gov/bankfind-suite/",
  },
  {
    // registry-ncua-financials: the newest quarter also syncs the credit union list
    // (src/lib/agents/magellan/registry/ncua-financials.ts; partitions are quarters).
    id: "ncua-credit-unions",
    name: "NCUA credit union list",
    publisher: "National Credit Union Administration",
    group: "institutions",
    takes: "The list of federally insured credit unions.",
    refresh: "Quarterly",
    href: "https://ncua.gov/analysis/credit-union-corporate-call-report-data",
  },
  {
    // registry-fdic-financials: institution_financial_records source 'fdic', one row per bank
    // per quarter, including service_charge_income (src/lib/agents/magellan/registry/fdic-financials.ts).
    id: "fdic-call-reports",
    name: "FDIC Call Reports",
    publisher: "Federal Deposit Insurance Corporation",
    group: "revenue",
    takes: "Each bank's service charge income, assets and deposits.",
    refresh: "Quarterly",
    href: "https://banks.data.fdic.gov/bankfind-suite/",
  },
  {
    // registry-ncua-financials: institution_financial_records source 'ncua', one row per credit
    // union per quarter, including service_charge_income and member_count.
    id: "ncua-5300",
    name: "NCUA 5300 Call Reports",
    publisher: "National Credit Union Administration",
    group: "revenue",
    takes: "Each credit union's fee income, assets, deposits and members.",
    refresh: "Quarterly",
    href: "https://ncua.gov/analysis/credit-union-corporate-call-report-data",
  },
  {
    // fed_district comes from FDIC for banks; credit unions take the nearest bank head office's
    // district (deriveOtherDistricts, src/lib/agents/magellan/registry/fdic-universe.ts).
    // District names: src/lib/fed-districts.ts. Refreshed with the weekly FDIC sync.
    id: "fed-districts",
    name: "Federal Reserve districts",
    publisher: "Federal Reserve",
    group: "regions",
    takes: "Each institution's district: FDIC's for banks, the nearest bank's for credit unions.",
    refresh: "Weekly",
    href: "https://www.federalreserve.gov/aboutthefed.htm",
  },
  {
    // registry-beige-book: fed_beige_book, one partition per release; shown on
    // /research/district/[id] (src/lib/agents/magellan/registry/fed.ts).
    id: "beige-book",
    name: "Beige Book",
    publisher: "Federal Reserve",
    group: "context",
    takes: "Each district's summary of economic activity.",
    refresh: "Each release",
    href: "https://www.federalreserve.gov/monetarypolicy/beige-book-default.htm",
  },
  {
    // registry-fred: CPI series CUUR0000SS68021 from the BLS API (src/lib/regulatory/fed.ts);
    // FRED_REFRESH_HOURS = 24 (src/lib/agents/magellan/registry/fed.ts). Shown on
    // /research/national-fee-index.
    id: "bls-cpi",
    name: "Consumer Price Index",
    publisher: "Bureau of Labor Statistics",
    group: "context",
    takes: "The price index for checking accounts and other bank services.",
    refresh: "Daily",
    href: "https://data.bls.gov/timeseries/CUUR0000SS68021",
  },
  {
    // registry-fred: REQUIRED_FRED_SERIES (GDPCTPI, state unemployment and payrolls)
    // (src/lib/regulatory/fed.ts); FRED_REFRESH_HOURS = 24.
    id: "fred",
    name: "FRED",
    publisher: "Federal Reserve Bank of St. Louis",
    group: "context",
    takes: "A price index and state job figures for economic context.",
    refresh: "Daily",
    href: "https://fred.stlouisfed.org/",
  },
  {
    // registry-cfpb: institution_complaint_records, complaint counts by institution, product and
    // issue; the current year refreshes every 7 days (src/lib/agents/magellan/registry/cfpb.ts).
    id: "cfpb-complaints",
    name: "Consumer complaints",
    publisher: "Consumer Financial Protection Bureau",
    group: "context",
    takes: "Complaint counts by institution, product and issue.",
    refresh: "Weekly",
    href: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
  },
  {
    // registry-fdic-sod: institution_branch_deposits, one partition per year
    // (src/lib/agents/magellan/registry/fdic-sod.ts).
    id: "fdic-sod",
    name: "Summary of Deposits",
    publisher: "Federal Deposit Insurance Corporation",
    group: "context",
    takes: "Bank branch locations and the deposits each one holds.",
    refresh: "Yearly",
    href: "https://www.fdic.gov/resources/data-tools/summary-of-deposits",
  },
  {
    // registry-census-acs: demographics, ACS_VARIABLES median household income, poverty count,
    // population; one partition per survey year (src/lib/regulatory/census-acs.ts).
    id: "census-acs",
    name: "American Community Survey",
    publisher: "U.S. Census Bureau",
    group: "context",
    takes: "Median household income, poverty and population by area.",
    refresh: "Yearly",
    href: "https://www.census.gov/programs-surveys/acs",
  },
];

/** Live counts the page has. Null means the read failed or no public read exists. */
export interface SourceCounts {
  /** Published fee entries (getPublicStatsSummary().observations). */
  observations: number | null;
  /** Institutions with at least one published fee (getPublicStatsSummary().institutions). */
  institutions: number | null;
  /** institution_sources rows with a bank charter (getStatsCached().banks). */
  banks: number | null;
  /** institution_sources rows with a credit union charter (getStatsCached().credit_unions). */
  creditUnions: number | null;
  /** Bank quarterly reports on file (getDataCoverageSummaryCached().fdic_financials). */
  fdicReports: number | null;
  /** Credit union quarterly reports on file (getDataCoverageSummaryCached().ncua_financials). */
  ncuaReports: number | null;
}

export interface MapFigure {
  value: string;
  label: string;
}

export interface MapNode {
  id: string;
  name: string;
  figure: MapFigure | null;
}

export interface MapGroup {
  key: SourceGroupKey;
  title: string;
  /** What this group is for, in a few words. */
  role: string;
  nodes: MapNode[];
}

export interface SourceMap {
  primary: { id: string; name: string; publisher: string; figures: MapFigure[] };
  groups: MapGroup[];
}

/** A count is shown only when its read worked and returned something; a failed read is never a 0. */
export function usable(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function figure(n: number | null, label: string): MapFigure | null {
  return usable(n) ? { value: formatCount(n), label } : null;
}

/** The twelve Reserve Bank districts; a fixed fact, not a live read. */
export const FED_DISTRICT_COUNT = Object.keys(DISTRICT_NAMES).length;

const GROUPS: { key: Exclude<SourceGroupKey, "fees">; title: string; role: string }[] = [
  { key: "institutions", title: "Who we track", role: "The institution list" },
  { key: "revenue", title: "Fee revenue", role: "What fees earn" },
  { key: "regions", title: "Regions", role: "District comparisons" },
  { key: "context", title: "Context", role: "Economy and market" },
];

function source(id: string): DataSource {
  const found = DATA_SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`unknown data source ${id}`);
  return found;
}

/** The figure a map node shows, if any; every other node shows its name alone. */
function nodeFigure(id: string, counts: SourceCounts): MapFigure | null {
  switch (id) {
    case "fdic-bankfind":
      return figure(counts.banks, "banks monitored");
    case "ncua-credit-unions":
      return figure(counts.creditUnions, "credit unions monitored");
    case "fdic-call-reports":
      return figure(counts.fdicReports, "quarterly reports");
    case "ncua-5300":
      return figure(counts.ncuaReports, "quarterly reports");
    case "fed-districts":
      return { value: String(FED_DISTRICT_COUNT), label: "districts" };
    default:
      return null;
  }
}

/** The source map: the fee schedules first, then the four groups that support them. */
export function sourceMap(counts: SourceCounts): SourceMap {
  const fees = source("fee-schedules");
  const primaryFigures = [
    figure(counts.observations, COVERAGE_LABELS.observations.toLowerCase()),
    figure(counts.institutions, COVERAGE_LABELS.institutions.toLowerCase()),
  ].filter((f): f is MapFigure => f !== null);
  return {
    primary: { id: fees.id, name: fees.name, publisher: fees.publisher, figures: primaryFigures },
    groups: GROUPS.map((g) => ({
      ...g,
      nodes: DATA_SOURCES.filter((s) => s.group === g.key).map((s) => ({
        id: s.id,
        name: s.name,
        figure: nodeFigure(s.id, counts),
      })),
    })),
  };
}

export interface ActionLink {
  href: string;
  label: string;
  event: "see_sample_report" | "request_report_click";
}

export const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
export const REPORT_REQUEST_HREF = "/reports?report=institution&src=data-sources#request";

/** The sample report when it is live today, otherwise the institution report request. */
export function nextAction(sampleLive: boolean): ActionLink {
  return sampleLive
    ? { href: SAMPLE_REPORT_HREF, label: "See the sample report", event: "see_sample_report" }
    : { href: REPORT_REQUEST_HREF, label: "Request your institution report", event: "request_report_click" };
}
