import { strFromU8, unzipSync } from "fflate";
import { registryFetch, registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsv } from "./ncua";
import { normalizeHmdaRssd } from "./hmda-identity";

/**
 * CFPB/FFIEC HMDA public data, aggregated per lender (LEI) per county and metro (MSA/MD) per
 * year: mortgage originations, their dollar volume, and exact medians of the loan-cost fields
 * (total loan costs, origination charges, discount points, lender credits). Pure: fetches and
 * aggregates, never writes to the database, and never keeps a loan-level row.
 *
 * Why the CSV endpoint and not only the aggregations endpoint: the Data Browser aggregations
 * endpoint returns only `count` and `sum` for the filter values a request names, so lender x
 * county cells would need every county and every LEI listed in the request (thousands of URLs
 * per state) and it cannot give a median at all. One CSV request per year and state, filtered to
 * originations (actions_taken=1), is streamed and summed in memory instead; the aggregations
 * endpoint is still called once per partition for the state's own count and sum, and the run
 * reports whether the streamed totals tie out to it.
 *
 * Every field name and URL below was written from the HMDA Data Browser and Snapshot
 * documentation, not read from a live response (the sites are blocked where this was written).
 * The run checks the CSV header and the panel header and reports any field it could not find;
 * a value that is blank, "NA" or "Exempt" stays null and is counted, never filled.
 */

export const HMDA_DATA_BROWSER_BASE = "https://ffiec.cfpb.gov/v2/data-browser-api/view";
export const HMDA_SNAPSHOT_BASE = "https://files.ffiec.cfpb.gov/static-data/snapshot";
/** The Data Browser covers the 2018 and later LAR format. */
export const HMDA_FIRST_YEAR = 2018;
/** CFPB discontinued the Reporter Panel after 2023; a current LAR does not imply a panel exists. */
export const HMDA_LAST_PANEL_YEAR = 2023;

/** States, DC and Puerto Rico, as HMDA's state_code carries them. */
export const HMDA_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
] as const;

/** Public LAR columns the aggregation reads. */
export const HMDA_LAR_FIELDS = {
  year: "activity_year",
  lei: "lei",
  msaMd: "derived_msa_md",
  state: "state_code",
  county: "county_code",
  actionTaken: "action_taken",
  loanPurpose: "loan_purpose",
  loanAmount: "loan_amount",
  totalLoanCosts: "total_loan_costs",
  originationCharges: "origination_charges",
  discountPoints: "discount_points",
  lenderCredits: "lender_credits",
} as const;

/** Without these a cell cannot be keyed or counted, so the partition loads nothing. */
export const HMDA_REQUIRED_FIELDS = ["lei", "county_code", "derived_msa_md", "action_taken", "loan_amount"] as const;

export const HMDA_COST_FIELDS = ["total_loan_costs", "origination_charges", "discount_points", "lender_credits"] as const;
export type HmdaCostField = (typeof HMDA_COST_FIELDS)[number];

/** Verified 2023 public panel headers; alternate RSSD spellings support older stored files. */
export const HMDA_PANEL_FIELDS = {
  lei: "LEI",
  rssdCandidates: ["ID_RSSD", "RESPONDENT_RSSD", "RSSD_ID", "RSSD"],
  name: "RESPONDENT_NAME",
  parentRssd: "PARENT_RSSD",
  topHolderRssd: "TOPHOLDER_RSSD",
  agencyCode: "AGENCY_CODE",
  assets: "ASSETS",
  otherLenderCode: "OTHER_LENDER_CODE",
} as const;

/** Loan amounts at or above this (dollars) are reported as outliers; HMDA rounds amounts to a $10,000 bin midpoint. */
export const HMDA_LOAN_AMOUNT_OUTLIER = 50_000_000;

export function hmdaCsvUrl(year: number, state: string): string {
  const q = new URLSearchParams({ states: state, years: String(year), actions_taken: "1" });
  return `${HMDA_DATA_BROWSER_BASE}/csv?${q.toString()}`;
}

export function hmdaAggregationsUrl(year: number, state: string): string {
  const q = new URLSearchParams({ states: state, years: String(year), actions_taken: "1" });
  return `${HMDA_DATA_BROWSER_BASE}/aggregations?${q.toString()}`;
}

export function hmdaPanelUrl(year: number): string {
  return `${HMDA_SNAPSHOT_BASE}/${year}/${year}_public_panel_csv.zip`;
}

/** "2025-CA" -> { year: 2025, state: "CA" }; null when the key is not a known year and state. */
export function parseHmdaPartition(key: string): { year: number; state: string } | null {
  const m = /^(\d{4})-([A-Z]{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < HMDA_FIRST_YEAR || year > 2100) return null;
  if (!(HMDA_STATES as readonly string[]).includes(m[2])) return null;
  return { year, state: m[2] };
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

export type HmdaNumber = { value: number } | { missing: "blank" | "na" | "exempt" | "unreadable" };

/** HMDA numeric cell: a number, or why there is none ("NA", "Exempt", blank). Never a default. */
export function hmdaNumber(raw: string | undefined): HmdaNumber {
  const t = text(raw);
  if (t === null) return { missing: "blank" };
  const lower = t.toLowerCase();
  if (lower === "na" || lower === "n/a") return { missing: "na" };
  if (lower === "exempt") return { missing: "exempt" };
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? { value: n } : { missing: "unreadable" };
}

/** County FIPS as 5 digits; "NA" or blank is null. */
export function hmdaCounty(raw: string | undefined): string | null {
  const t = text(raw);
  if (t === null || /^n\/?a$/i.test(t)) return null;
  return /^\d{4,5}$/.test(t) ? t.padStart(5, "0") : null;
}

/** MSA/MD code as HMDA reports it; "99999" (outside any MSA) is kept as HMDA's own code. */
export function hmdaMsa(raw: string | undefined): string | null {
  const t = text(raw);
  if (t === null || /^n\/?a$/i.test(t)) return null;
  return /^\d{5}$/.test(t) ? t : null;
}

/** Splits one CSV line, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Exact quantile (linear between ranks) of values already sorted ascending. */
export function sortedQuantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface HmdaOriginationCell {
  lei: string;
  stateCode: string;
  countyFips: string | null;
  msaMd: string | null;
  originations: number;
  /** Sum of HMDA's rounded loan amounts (dollars) over the loans that carried a readable amount. */
  originationAmount: number;
  /** Loans in the cell whose amount was blank, NA or unreadable (left out of originationAmount). */
  amountMissing: number;
  purchaseCount: number;
  purchaseAmount: number;
  refinanceCount: number;
  refinanceAmount: number;
}

export interface HmdaCostStat {
  /** Loans with a usable (numeric, not negative) value; the median's basis. */
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  exempt: number;
  na: number;
  blank: number;
  unreadable: number;
  negative: number;
}

export interface HmdaCostCell {
  lei: string;
  stateCode: string;
  msaMd: string | null;
  originations: number;
  costs: Record<HmdaCostField, HmdaCostStat>;
}

export interface HmdaStreamStats {
  dataRows: number;
  malformedRows: number;
  notOriginated: number;
  noLei: number;
  noCounty: number;
  noMsa: number;
  outsideMsa: number;
  otherState: number;
  otherYear: number;
  loanAmountMissing: number;
  loanAmountNotPositive: number;
  loanAmountOutliers: number;
  originationsCounted: number;
  originationAmountCounted: number;
}

interface CostAcc {
  values: Record<HmdaCostField, number[]>;
  missing: Record<HmdaCostField, { exempt: number; na: number; blank: number; unreadable: number; negative: number }>;
  originations: number;
}

function emptyCostAcc(): CostAcc {
  const values = {} as CostAcc["values"];
  const missing = {} as CostAcc["missing"];
  for (const f of HMDA_COST_FIELDS) {
    values[f] = [];
    missing[f] = { exempt: 0, na: 0, blank: 0, unreadable: 0, negative: 0 };
  }
  return { values, missing, originations: 0 };
}

/**
 * Folds loan-level LAR rows into lender x county cells and lender x MSA cost cells. Rows are
 * dropped from memory as they are read; only the sums and the cost values for the medians stay.
 */
export class HmdaAccumulator {
  readonly header: string[];
  readonly missingFields: string[];
  readonly duplicateHeaderFields: string[];
  private readonly at: Record<string, number>;
  private readonly cells = new Map<string, HmdaOriginationCell>();
  private readonly costCells = new Map<string, { lei: string; stateCode: string; msaMd: string | null; acc: CostAcc }>();
  readonly stats: HmdaStreamStats = {
    dataRows: 0,
    malformedRows: 0,
    notOriginated: 0,
    noLei: 0,
    noCounty: 0,
    noMsa: 0,
    outsideMsa: 0,
    otherState: 0,
    otherYear: 0,
    loanAmountMissing: 0,
    loanAmountNotPositive: 0,
    loanAmountOutliers: 0,
    originationsCounted: 0,
    originationAmountCounted: 0,
  };

  constructor(
    headerCells: string[],
    readonly year: number,
    readonly state: string,
  ) {
    // The public LAR spells one column "derived_msa-md" (2025 Data Browser CSV); read "-" as "_".
    this.header = headerCells.map((h) => h.trim().toLowerCase().replace(/-/g, "_"));
    this.at = {};
    const seen = new Set<string>();
    const dupes = new Set<string>();
    this.header.forEach((name, i) => {
      if (seen.has(name)) dupes.add(name);
      seen.add(name);
      if (!(name in this.at)) this.at[name] = i;
    });
    this.duplicateHeaderFields = [...dupes];
    this.missingFields = Object.values(HMDA_LAR_FIELDS).filter((f) => !(f in this.at));
  }

  /** True when every field needed to key and count a cell is in the header. */
  get usable(): boolean {
    return HMDA_REQUIRED_FIELDS.every((f) => f in this.at);
  }

  private cell(cells: string[], field: string): string | undefined {
    const i = this.at[field];
    return i === undefined ? undefined : cells[i];
  }

  addRow(cells: string[]): void {
    this.stats.dataRows += 1;
    if (cells.length !== this.header.length) {
      this.stats.malformedRows += 1;
      return;
    }
    const get = (field: string) => this.cell(cells, field);
    if (text(get(HMDA_LAR_FIELDS.actionTaken)) !== "1") {
      this.stats.notOriginated += 1;
      return;
    }
    const yearCell = text(get(HMDA_LAR_FIELDS.year));
    if (yearCell !== null && yearCell !== String(this.year)) this.stats.otherYear += 1;
    const lei = text(get(HMDA_LAR_FIELDS.lei))?.toUpperCase() ?? null;
    if (!lei) {
      this.stats.noLei += 1;
      return;
    }
    const stateCell = text(get(HMDA_LAR_FIELDS.state));
    if (stateCell !== null && stateCell.toUpperCase() !== this.state) this.stats.otherState += 1;
    const county = hmdaCounty(get(HMDA_LAR_FIELDS.county));
    const msa = hmdaMsa(get(HMDA_LAR_FIELDS.msaMd));
    if (county === null) this.stats.noCounty += 1;
    if (msa === null) this.stats.noMsa += 1;
    else if (msa === "99999") this.stats.outsideMsa += 1;

    const amount = hmdaNumber(get(HMDA_LAR_FIELDS.loanAmount));
    const purpose = text(get(HMDA_LAR_FIELDS.loanPurpose));
    const key = `${lei}|${county ?? ""}|${msa ?? ""}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = {
        lei,
        stateCode: this.state,
        countyFips: county,
        msaMd: msa,
        originations: 0,
        originationAmount: 0,
        amountMissing: 0,
        purchaseCount: 0,
        purchaseAmount: 0,
        refinanceCount: 0,
        refinanceAmount: 0,
      };
      this.cells.set(key, cell);
    }
    cell.originations += 1;
    this.stats.originationsCounted += 1;
    const isPurchase = purpose === "1";
    const isRefi = purpose === "31" || purpose === "32";
    if (isPurchase) cell.purchaseCount += 1;
    if (isRefi) cell.refinanceCount += 1;
    if ("value" in amount) {
      if (amount.value <= 0) this.stats.loanAmountNotPositive += 1;
      if (amount.value >= HMDA_LOAN_AMOUNT_OUTLIER) this.stats.loanAmountOutliers += 1;
      cell.originationAmount += amount.value;
      this.stats.originationAmountCounted += amount.value;
      if (isPurchase) cell.purchaseAmount += amount.value;
      if (isRefi) cell.refinanceAmount += amount.value;
    } else {
      cell.amountMissing += 1;
      this.stats.loanAmountMissing += 1;
    }

    const costKey = `${lei}|${msa ?? ""}`;
    let cost = this.costCells.get(costKey);
    if (!cost) {
      cost = { lei, stateCode: this.state, msaMd: msa, acc: emptyCostAcc() };
      this.costCells.set(costKey, cost);
    }
    cost.acc.originations += 1;
    for (const f of HMDA_COST_FIELDS) {
      const raw = get(f);
      if (raw === undefined) continue;
      const v = hmdaNumber(raw);
      if ("value" in v) {
        if (v.value < 0) cost.acc.missing[f].negative += 1;
        else cost.acc.values[f].push(v.value);
      } else cost.acc.missing[f][v.missing] += 1;
    }
  }

  originationCells(): HmdaOriginationCell[] {
    return [...this.cells.values()];
  }

  costCellsOut(): HmdaCostCell[] {
    return [...this.costCells.values()].map(({ lei, stateCode, msaMd, acc }) => {
      const costs = {} as Record<HmdaCostField, HmdaCostStat>;
      for (const f of HMDA_COST_FIELDS) {
        const sorted = acc.values[f].sort((a, b) => a - b);
        costs[f] = {
          n: sorted.length,
          median: sortedQuantile(sorted, 0.5),
          p25: sortedQuantile(sorted, 0.25),
          p75: sortedQuantile(sorted, 0.75),
          ...acc.missing[f],
        };
      }
      return { lei, stateCode, msaMd, originations: acc.originations, costs };
    });
  }

  leis(): string[] {
    return [...new Set([...this.cells.values()].map((c) => c.lei))];
  }
}

/** Reads a CSV byte stream line by line into the accumulator; returns it once the stream ends. */
export async function accumulateHmdaCsv(
  body: ReadableStream<Uint8Array>,
  year: number,
  state: string,
): Promise<{ acc: HmdaAccumulator | null; bytes: number; firstLine: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc: HmdaAccumulator | null = null;
  let firstLine: string | null = null;
  let bytes = 0;
  const take = (line: string) => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean.trim() === "") return;
    if (firstLine === null) {
      firstLine = clean.slice(0, 300);
      acc = new HmdaAccumulator(splitCsvLine(clean), year, state);
      return;
    }
    if (acc && acc.usable) acc.addRow(splitCsvLine(clean));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) take(buffer);
  return { acc, bytes, firstLine };
}

export interface HmdaStateAggregate {
  count: number | null;
  sum: number | null;
  /** Why the totals could not be read, when they could not. */
  note: string | null;
}

interface AggregationsResponse {
  aggregations?: Array<{ count?: unknown; sum?: unknown }>;
}

/** The Data Browser's own count and loan-amount sum of the state's originations for the year. */
export async function fetchHmdaStateAggregate(year: number, state: string, options: RegistryFetchOptions = {}): Promise<HmdaStateAggregate> {
  try {
    const body = await registryFetchJson<AggregationsResponse>(hmdaAggregationsUrl(year, state), options);
    const rows = Array.isArray(body.aggregations) ? body.aggregations : null;
    if (!rows) return { count: null, sum: null, note: "response had no aggregations array" };
    if (rows.length !== 1) return { count: null, sum: null, note: `expected 1 aggregation row, got ${rows.length}` };
    const count = Number(rows[0].count);
    const sum = Number(rows[0].sum);
    return {
      count: Number.isFinite(count) ? count : null,
      sum: Number.isFinite(sum) ? sum : null,
      note: Number.isFinite(count) && Number.isFinite(sum) ? null : "aggregation row had no numeric count or sum",
    };
  } catch (error) {
    return { count: null, sum: null, note: error instanceof Error ? error.message : String(error) };
  }
}

export interface HmdaPanelLender {
  lei: string;
  respondentName: string | null;
  rssdId: string | null;
  parentRssd: string | null;
  topHolderRssd: string | null;
  agencyCode: string | null;
  assets: string | null;
  otherLenderCode: string | null;
  raw: Record<string, string>;
}

export interface HmdaPanel {
  url: string;
  available: boolean;
  note: string | null;
  lenders: Map<string, HmdaPanelLender>;
  /** The column the respondent RSSD was read from, or null when none of the candidates was present. */
  rssdField: string | null;
  missingFields: string[];
  duplicateLeis: number;
  /** Duplicate panel rows without one shared positive respondent RSSD; never choose by row order. */
  conflictingLeis?: string[];
}

export function parseHmdaPanel(csvText: string, url: string): HmdaPanel {
  const rows = parseCsv(csvText);
  const header = rows.length > 0 ? Object.keys(rows[0]) : [];
  const has = (f: string) => header.includes(f);
  const rssdField = HMDA_PANEL_FIELDS.rssdCandidates.find(has) ?? null;
  const named = [HMDA_PANEL_FIELDS.lei, HMDA_PANEL_FIELDS.name, HMDA_PANEL_FIELDS.parentRssd, HMDA_PANEL_FIELDS.topHolderRssd, HMDA_PANEL_FIELDS.agencyCode, HMDA_PANEL_FIELDS.assets, HMDA_PANEL_FIELDS.otherLenderCode];
  const missingFields: string[] = rows.length === 0 ? [] : named.filter((f) => !has(f));
  if (rows.length > 0 && !rssdField) missingFields.push(`one of ${HMDA_PANEL_FIELDS.rssdCandidates.join("/")}`);
  const lenders = new Map<string, HmdaPanelLender>();
  const conflictingLeis = new Set<string>();
  let duplicateLeis = 0;
  for (const row of rows) {
    const lei = text(row[HMDA_PANEL_FIELDS.lei])?.toUpperCase();
    if (!lei) continue;
    const rssdId = rssdField ? normalizeHmdaRssd(row[rssdField]) : null;
    const existing = lenders.get(lei);
    if (existing) {
      duplicateLeis += 1;
      if (!existing.rssdId || !rssdId || existing.rssdId !== rssdId || conflictingLeis.has(lei)) {
        conflictingLeis.add(lei);
        lenders.set(lei, { ...existing, rssdId: null });
      }
      continue;
    }
    lenders.set(lei, {
      lei,
      respondentName: text(row[HMDA_PANEL_FIELDS.name]),
      rssdId,
      parentRssd: text(row[HMDA_PANEL_FIELDS.parentRssd]),
      topHolderRssd: text(row[HMDA_PANEL_FIELDS.topHolderRssd]),
      agencyCode: text(row[HMDA_PANEL_FIELDS.agencyCode]),
      assets: text(row[HMDA_PANEL_FIELDS.assets]),
      otherLenderCode: text(row[HMDA_PANEL_FIELDS.otherLenderCode]),
      raw: row,
    });
  }
  return { url, available: true, note: rows.length === 0 ? "panel file had no rows" : null,
    lenders, rssdField, missingFields, duplicateLeis, conflictingLeis: [...conflictingLeis].sort() };
}

/** The year's historical panel. Never substitute an older year's identity or a parent/acquirer. */
export async function fetchHmdaPanel(year: number, options: RegistryFetchOptions = {}): Promise<HmdaPanel> {
  const url = hmdaPanelUrl(year);
  const unavailable = (note: string): HmdaPanel => ({ url, available: false, note, lenders: new Map(), rssdField: null, missingFields: [], duplicateLeis: 0 });
  if (year > HMDA_LAST_PANEL_YEAR) return unavailable("Reporter Panel discontinued after 2023; matching requires canonical institution identifiers");
  try {
    const response = await registryFetch(url, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /\.(csv|txt)$/i.test(n));
    if (!name) return unavailable("panel zip held no csv file");
    return parseHmdaPanel(strFromU8(files[name]), url);
  } catch (error) {
    if (error instanceof RegistryHttpError && error.status === 404) return unavailable("panel not published (404)");
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export interface HmdaStatePull {
  url: string;
  bytes: number;
  firstLine: string | null;
  acc: HmdaAccumulator | null;
}

/** Streams one year and state of originations from the Data Browser CSV endpoint. */
export async function fetchHmdaStateYear(year: number, state: string, options: RegistryFetchOptions = {}): Promise<HmdaStatePull> {
  const url = hmdaCsvUrl(year, state);
  const response = await registryFetch(url, { timeoutMs: 240_000, ...options });
  if (!response.body) throw new RegistryHttpError("HMDA sent an empty CSV response", url, response.status);
  const out = await accumulateHmdaCsv(response.body, year, state);
  return { url, ...out };
}

export interface HmdaCleaningInput {
  pull: HmdaStatePull;
  aggregate: HmdaStateAggregate;
  panel: HmdaPanel;
  /** Lenders in the partition with no institution_sources match; null before the write (dry run). */
  unmatchedLenders?: number | null;
}

export interface HmdaOutlierExample {
  lei: string;
  geography: string;
  value: number;
  basis: number;
}

type HmdaRowStats = Omit<HmdaStreamStats, "originationsCounted" | "originationAmountCounted">;

export interface HmdaCleaningReport {
  missing_fields: string[];
  duplicate_header_fields: string[];
  panel_missing_fields: string[];
  panel_rssd_field: string | null;
  panel_available: boolean;
  panel_note: string | null;
  panel_duplicate_leis: number;
  lenders: number;
  lenders_not_in_panel: number;
  lenders_without_rssd: number;
  unmatched_lenders: number | null;
  rows: HmdaRowStats;
  duplicate_cell_keys: number;
  reconciliation: {
    data_browser_count: number | null;
    data_browser_sum: number | null;
    streamed_count: number;
    streamed_sum: number;
    count_difference: number | null;
    sum_difference: number | null;
    note: string | null;
  };
  cost_values_negative: Record<HmdaCostField, number>;
  cost_values_exempt: Record<HmdaCostField, number>;
  /**
   * Lenders by whether they reported each loan-cost field in this partition. Lenders under the
   * partial-exemption threshold (fewer than 500 closed-end loans in each of the two prior years)
   * may report "Exempt" or leave the field out, so small banks and credit unions often have no
   * cost median at all; a cost median covers only the lenders counted in `reported`.
   */
  cost_reporting_lenders: Record<HmdaCostField, { reported: number; exempt_only: number; blank_or_na_only: number }>;
  /** Lender x county cells (5+ loans) whose average loan is over 10x or under a tenth of the partition's median cell average. */
  average_loan_outliers: { count: number; median_cell_average: number | null; examples: HmdaOutlierExample[] };
  /** Lender x MSA cost medians (5+ loans) over 5x the partition's median of that field's medians. */
  cost_median_outliers: Record<HmdaCostField, { count: number; partition_median: number | null; examples: HmdaOutlierExample[] }>;
}

const OUTLIER_MIN_LOANS = 5;
const EXAMPLE_LIMIT = 10;

function medianOf(values: number[]): number | null {
  return sortedQuantile([...values].sort((a, b) => a - b), 0.5);
}

function rowStats(stats: HmdaStreamStats | undefined): HmdaRowStats {
  if (!stats) {
    return {
      dataRows: 0, malformedRows: 0, notOriginated: 0, noLei: 0, noCounty: 0, noMsa: 0, outsideMsa: 0, otherState: 0,
      otherYear: 0, loanAmountMissing: 0, loanAmountNotPositive: 0, loanAmountOutliers: 0,
    };
  }
  const { originationsCounted, originationAmountCounted, ...rest } = stats;
  void originationsCounted;
  void originationAmountCounted;
  return rest;
}

/**
 * Gaps and outliers for one partition, written into the partition detail. Reports only: it
 * never drops, alters or fills a value.
 */
export function hmdaCleaningReport(input: HmdaCleaningInput): HmdaCleaningReport {
  const { pull, aggregate, panel } = input;
  const acc = pull.acc;
  const cells = acc?.originationCells() ?? [];
  const costCells = acc?.costCellsOut() ?? [];
  const leis = acc?.leis() ?? [];
  const keys = new Set<string>();
  let duplicateCellKeys = 0;
  for (const c of cells) {
    const k = `${c.lei}|${c.countyFips ?? ""}|${c.msaMd ?? ""}`;
    if (keys.has(k)) duplicateCellKeys += 1;
    keys.add(k);
  }

  const averages = cells
    .filter((c) => c.originations - c.amountMissing >= OUTLIER_MIN_LOANS)
    .map((c) => ({ c, avg: c.originationAmount / (c.originations - c.amountMissing) }));
  const medianAvg = medianOf(averages.map((a) => a.avg));
  const avgOutliers = medianAvg && medianAvg > 0 ? averages.filter((a) => a.avg > medianAvg * 10 || a.avg < medianAvg / 10) : [];

  const costOutliers = {} as HmdaCleaningReport["cost_median_outliers"];
  const negative = {} as Record<HmdaCostField, number>;
  const exempt = {} as Record<HmdaCostField, number>;
  for (const f of HMDA_COST_FIELDS) {
    negative[f] = costCells.reduce((s, c) => s + c.costs[f].negative, 0);
    exempt[f] = costCells.reduce((s, c) => s + c.costs[f].exempt, 0);
    const eligible = costCells.filter((c) => c.costs[f].n >= OUTLIER_MIN_LOANS && c.costs[f].median !== null);
    const partitionMedian = medianOf(eligible.map((c) => c.costs[f].median as number));
    const flagged = partitionMedian && partitionMedian > 0 ? eligible.filter((c) => (c.costs[f].median as number) > partitionMedian * 5) : [];
    costOutliers[f] = {
      count: flagged.length,
      partition_median: partitionMedian,
      examples: flagged
        .slice(0, EXAMPLE_LIMIT)
        .map((c) => ({ lei: c.lei, geography: `msa:${c.msaMd ?? "none"}`, value: c.costs[f].median as number, basis: partitionMedian as number })),
    };
  }

  const costReporting = {} as HmdaCleaningReport["cost_reporting_lenders"];
  for (const f of HMDA_COST_FIELDS) {
    const byLender = new Map<string, { n: number; exempt: number }>();
    for (const c of costCells) {
      const s = byLender.get(c.lei) ?? { n: 0, exempt: 0 };
      s.n += c.costs[f].n;
      s.exempt += c.costs[f].exempt;
      byLender.set(c.lei, s);
    }
    const statuses = [...byLender.values()];
    costReporting[f] = {
      reported: statuses.filter((s) => s.n > 0).length,
      exempt_only: statuses.filter((s) => s.n === 0 && s.exempt > 0).length,
      blank_or_na_only: statuses.filter((s) => s.n === 0 && s.exempt === 0).length,
    };
  }

  const streamedCount = acc?.stats.originationsCounted ?? 0;
  const streamedSum = acc?.stats.originationAmountCounted ?? 0;
  return {
    missing_fields: acc?.missingFields ?? [...Object.values(HMDA_LAR_FIELDS)],
    duplicate_header_fields: acc?.duplicateHeaderFields ?? [],
    panel_missing_fields: panel.missingFields,
    panel_rssd_field: panel.rssdField,
    panel_available: panel.available,
    panel_note: panel.note,
    panel_duplicate_leis: panel.duplicateLeis,
    lenders: leis.length,
    lenders_not_in_panel: panel.available ? leis.filter((l) => !panel.lenders.has(l)).length : leis.length,
    lenders_without_rssd: leis.filter((l) => !panel.lenders.get(l)?.rssdId).length,
    unmatched_lenders: input.unmatchedLenders ?? null,
    rows: rowStats(acc?.stats),
    duplicate_cell_keys: duplicateCellKeys,
    reconciliation: {
      data_browser_count: aggregate.count,
      data_browser_sum: aggregate.sum,
      streamed_count: streamedCount,
      streamed_sum: streamedSum,
      count_difference: aggregate.count === null ? null : streamedCount - aggregate.count,
      sum_difference: aggregate.sum === null ? null : streamedSum - aggregate.sum,
      note: aggregate.note,
    },
    cost_values_negative: negative,
    cost_values_exempt: exempt,
    cost_reporting_lenders: costReporting,
    average_loan_outliers: {
      count: avgOutliers.length,
      median_cell_average: medianAvg,
      examples: avgOutliers
        .slice(0, EXAMPLE_LIMIT)
        .map((a) => ({ lei: a.c.lei, geography: `county:${a.c.countyFips ?? "none"}`, value: a.avg, basis: medianAvg as number })),
    },
    cost_median_outliers: costOutliers,
  };
}

/**
 * CFPB average prime offer rates (APOR): the weekly tables the HMDA rate spread is measured
 * against, one for fixed-rate and one for adjustable-rate loans, a column per loan term in years.
 * The file locations and layout are from memory; each candidate URL is tried in order, the
 * delimiter is detected, and a header without a date column and numeric term columns loads nothing.
 */
export type AporRateType = "fixed" | "adjustable";

export const APOR_URLS: Record<AporRateType, readonly string[]> = {
  // files.ffiec.cfpb.gov is the current home (CFPB rate-spread documentation, checked 2026-10-17);
  // the two older locations returned HTTP 403 on prod.
  fixed: [
    "https://files.ffiec.cfpb.gov/apor/YieldTableFixed.txt",
    "https://s3.amazonaws.com/cfpb-hmda-public/prod/apor/YieldTableFixed.txt",
    "https://ffiec.cfpb.gov/public/rateSpread/YieldTableFixed.txt",
  ],
  adjustable: [
    "https://files.ffiec.cfpb.gov/apor/YieldTableAdjustable.txt",
    "https://s3.amazonaws.com/cfpb-hmda-public/prod/apor/YieldTableAdjustable.txt",
    "https://ffiec.cfpb.gov/public/rateSpread/YieldTableAdjustable.txt",
  ],
};

export interface AporRate {
  rateType: AporRateType;
  effectiveDate: string;
  termYears: number;
  /** Percent, as published (e.g. 6.85). */
  apor: number;
}

export interface AporTable {
  rateType: AporRateType;
  url: string | null;
  rates: AporRate[];
  delimiter: string | null;
  termColumns: number[];
  /** Data rows whose date could not be read. */
  undatedRows: number;
  /** Cells that were not blank and not a number (not loaded). */
  unreadableCells: number;
  /** Rates outside 0-25%, loaded as published and reported. */
  outOfRange: number;
  duplicateKeys: number;
  note: string | null;
}

function aporDate(raw: string): string | null {
  const t = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

export function parseAporTable(textBody: string, rateType: AporRateType, url: string | null = null): AporTable {
  const lines = textBody.split(/\r?\n/).filter((l) => l.trim() !== "");
  const empty = (note: string): AporTable => ({
    rateType, url, rates: [], delimiter: null, termColumns: [], undatedRows: 0, unreadableCells: 0, outOfRange: 0, duplicateKeys: 0, note,
  });
  if (lines.length === 0) return empty("file was empty");
  const delimiter = ["|", "\t", ","].find((d) => lines[0].includes(d)) ?? null;
  if (!delimiter) return empty(`no delimiter in header: ${lines[0].slice(0, 120)}`);
  const header = lines[0].split(delimiter).map((h) => h.trim());
  const terms = header.slice(1).map((h) => (/^\d{1,2}$/.test(h) ? Number(h) : null));
  const termColumns = terms.filter((t): t is number => t !== null);
  if (termColumns.length === 0) return empty(`header has no numeric term columns: ${lines[0].slice(0, 120)}`);
  const rates: AporRate[] = [];
  const keys = new Set<string>();
  let undatedRows = 0;
  let unreadableCells = 0;
  let outOfRange = 0;
  let duplicateKeys = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter);
    const date = aporDate(cells[0] ?? "");
    if (!date) {
      undatedRows += 1;
      continue;
    }
    terms.forEach((term, i) => {
      if (term === null) return;
      const raw = (cells[i + 1] ?? "").trim();
      if (raw === "") return;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        unreadableCells += 1;
        return;
      }
      if (value < 0 || value > 25) outOfRange += 1;
      const key = `${date}|${term}`;
      if (keys.has(key)) {
        duplicateKeys += 1;
        return;
      }
      keys.add(key);
      rates.push({ rateType, effectiveDate: date, termYears: term, apor: value });
    });
  }
  return { rateType, url, rates, delimiter, termColumns, undatedRows, unreadableCells, outOfRange, duplicateKeys, note: rates.length === 0 ? "no rates read" : null };
}

/** One APOR table, from the first candidate URL that answers. */
export async function fetchAporTable(rateType: AporRateType, options: RegistryFetchOptions = {}): Promise<AporTable> {
  const errors: string[] = [];
  for (const url of APOR_URLS[rateType]) {
    try {
      const response = await registryFetch(url, options);
      return parseAporTable(await response.text(), rateType, url);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ...parseAporTable("", rateType, null), note: `no APOR location answered: ${errors.join("; ")}` };
}
