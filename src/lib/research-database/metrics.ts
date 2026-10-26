import type { ResearchMetric } from "./types";

/** Change this version whenever a formula, population or unit changes. */
export const RESEARCH_METRIC_VERSION = 1;
export const RESEARCH_MIN_PEERS = 10;
export const RESEARCH_METRICS: readonly ResearchMetric[] = [
  { key: "population", module: "market", label: "Population", unit: "people", aggregation: "sum", definition: "Sum of ACS population estimates for distinct counties in one common vintage.", sources: ["census-acs"], maxAgeDays: 800 },
  { key: "national_unemployment", module: "market", label: "US unemployment rate", unit: "percent", aggregation: "ratio", definition: "Latest national unemployment rate loaded directly from BLS. National context; not an estimate for the institution footprint.", sources: ["fred"], maxAgeDays: 100 },
  { key: "fed_funds", module: "market", label: "Federal funds effective rate", unit: "percent", aggregation: "ratio", definition: "Latest monthly effective federal funds rate loaded directly from the Federal Reserve Board. FRED-era fallback rows excluded.", sources: ["fred"], maxAgeDays: 100 },
  { key: "household_income", module: "market", label: "County median household income", unit: "dollars", aggregation: "median", definition: "ACS median for each county separately. County medians are never averaged into a footprint median.", sources: ["census-acs"], maxAgeDays: 800 },
  { key: "bank_deposits", module: "market", label: "Bank branch deposits", unit: "dollars", aggregation: "sum", definition: "FDIC Summary of Deposits, stored thousands multiplied by 1,000. Banks only; not credit union market share.", sources: ["fdic-sod"], maxAgeDays: 550 },
  { key: "qcew_employment", module: "market", label: "Covered jobs (annual average)", unit: "jobs", aggregation: "sum", definition: "Sum of BLS QCEW county annual-average covered employment, only with complete county coverage.", sources: ["bls-qcew"], maxAgeDays: 800 },
  { key: "qcew_establishments", module: "market", label: "Business establishments", unit: "establishments", aggregation: "sum", definition: "Sum of BLS QCEW county annual-average establishments, only with complete county coverage.", sources: ["bls-qcew"], maxAgeDays: 800 },
  { key: "mortgage_originations", module: "market", label: "Reported mortgage originations", unit: "loans", aggregation: "sum", definition: "HMDA originations in the latest stored activity year. Disjoint lender/county/metro cells are summed once into county facts, retaining lender and observation counts. Coverage describes counties with stored lending, not all lending.", sources: ["hmda"], maxAgeDays: 800 },
  { key: "assets", module: "performance", label: "Median total assets", unit: "dollars", aggregation: "median", definition: "One FDIC or NCUA filing per institution at the cohort's latest common quarter; stored thousands multiplied by 1,000. Banks and credit unions are separate.", sources: ["fdic-financials", "ncua-financials"], maxAgeDays: 200 },
  { key: "roa", module: "performance", label: "Median return on assets", unit: "percent", aggregation: "median", definition: "Median reported ROA within one charter and asset tier at one quarter. No pooled bank/credit union statistic.", sources: ["fdic-financials", "ncua-financials"], maxAgeDays: 200 },
  { key: "asset_growth", module: "performance", label: "Median annual asset growth", unit: "percent", aggregation: "median", definition: "Median percentage change in assets against the same quarter one year earlier, requiring both filings and positive prior assets.", sources: ["fdic-financials", "ncua-financials"], maxAgeDays: 200 },
  { key: "equity_assets", module: "performance", label: "Median equity to assets", unit: "percent", aggregation: "median", definition: "Median reported total equity divided by total assets times 100. This balance-sheet measure is not a regulatory capital ratio.", sources: ["fdic-financials", "ncua-financials"], maxAgeDays: 200 },
  { key: "loan_deposit_ratio", module: "performance", label: "Loans to deposits", unit: "ratio", aggregation: "ratio", definition: "Sum of reported loans divided by sum of deposits, using only filings with both values and positive deposits in one charter and asset tier.", sources: ["fdic-financials", "ncua-financials"], maxAgeDays: 200 },
  ...["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"].map(category => ({
    key: `fee:${category}`, module: "fees" as const, label: `${category.replaceAll("_", " ")} benchmark`, unit: "dollars" as const,
    aggregation: "median" as const, definition: "Verified published dollar fees under the shared fee-statistics contract, including zero and schedule deduplication. At least ten eligible institutions. Rates and incompatible charging bases excluded.",
    sources: ["published_fee_catalog"], maxAgeDays: 182,
  })),
];

export function metricDefinition(key: string): ResearchMetric {
  const metric = RESEARCH_METRICS.find(m => m.key === key);
  if (!metric) throw new Error(`Unknown research metric: ${key}`);
  return metric;
}

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function countyFips(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value);
  if (!/^\d{1,5}$/.test(s) || Number(s) === 0) return null;
  return s.padStart(5, "0");
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
