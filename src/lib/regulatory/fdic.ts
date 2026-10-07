import { registryFetchJson, type RegistryFetchOptions } from "./http";
import { fdicRepdte, quarterEndDate, type Quarter } from "./quarters";

/**
 * FDIC BankFind Suite API client and row parsers (https://api.fdic.gov/banks).
 * Pure: fetches and normalizes, never writes to the database.
 *
 * Units: FDIC dollar fields are thousands of dollars, which matches the existing
 * fdic/ncua convention in institution_financial_records. Income lines use the
 * quarterly (`*Q`) variants, not year-to-date, so quarters chart side by side.
 *
 * Field codes were verified against the live API (JPMorgan Chase, CERT 628,
 * 2025-12-31 and 2026-03-31). Note `SC` is total securities, not service
 * charges; deposit service charges are `ISERCHG` / `ISERCHGQ`.
 */

export const FDIC_API_BASE = "https://api.fdic.gov/banks";
const PAGE_LIMIT = 10_000;
/** Bounded so a malformed `meta.total` can never loop forever. */
const MAX_PAGES = 15;

export const FDIC_FINANCIAL_FIELDS = [
  "CERT",
  "REPDTE",
  "ASSET",
  "DEP",
  "LNLSNET",
  "EQTOT",
  "SC",
  "NETINCQ",
  "NIMQ",
  "NONIIQ",
  "NONIXQ",
  "ELNATQ",
  "ISERCHGQ",
  "NTLNLSQ",
  "NCLNLS",
  "LNRE",
  "LNCI",
  "LNCON",
  "LNCRCD",
  "LNAUTO",
  "LNAG",
  "COREDEP",
  "BRO",
  "DEPUNINS",
  "ROAQ",
  "ROEQ",
  "NIMYQ",
  "EEFFQR",
  "NTLNLSQR",
  "NCLNLSR",
  "RBC1AAJ",
  "RBC1RWAJ",
  "RBCRWAJ",
  "NUMEMP",
  "OFFDOM",
] as const;

export const FDIC_INSTITUTION_FIELDS = [
  "CERT",
  "NAME",
  "ACTIVE",
  "INACTIVE",
  "FED_RSSD",
  "RSSDHCR",
  "NAMEHCR",
  "REGAGNT",
  "CHRTAGNT",
  "STALP",
  "STNAME",
  "CITY",
  "WEBADDR",
  "ASSET",
  "FED",
  "CBSA_NO",
  "CBSA",
  "ESTYMD",
  "ENDEFYMD",
] as const;

type FdicRecord = Record<string, unknown>;

interface FdicResponse {
  meta?: { total?: number };
  data?: Array<{ data?: FdicRecord }>;
}

export interface FdicPage {
  rows: FdicRecord[];
  url: string;
}

function buildUrl(endpoint: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `${FDIC_API_BASE}/${endpoint}?${search.toString()}`;
}

async function fetchAllPages(
  endpoint: string,
  params: Record<string, string | number>,
  options: RegistryFetchOptions,
): Promise<{ rows: FdicRecord[]; url: string }> {
  const rows: FdicRecord[] = [];
  let firstUrl = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = buildUrl(endpoint, { ...params, limit: PAGE_LIMIT, offset: page * PAGE_LIMIT, format: "json" });
    if (page === 0) firstUrl = url;
    const body = await registryFetchJson<FdicResponse>(url, options);
    const pageRows = (body.data ?? []).map((item) => item.data ?? {});
    rows.push(...pageRows);
    const total = Number(body.meta?.total ?? rows.length);
    if (pageRows.length < PAGE_LIMIT || rows.length >= total) break;
  }
  return { rows, url: firstUrl };
}

export async function fetchFdicFinancialsForQuarter(
  q: Quarter,
  options: RegistryFetchOptions = {},
): Promise<FdicPage> {
  return fetchAllPages(
    "financials",
    { filters: `REPDTE:${fdicRepdte(q)}`, fields: FDIC_FINANCIAL_FIELDS.join(","), sort_by: "CERT", sort_order: "ASC" },
    options,
  );
}

export async function fetchFdicActiveInstitutions(options: RegistryFetchOptions = {}): Promise<FdicPage> {
  return fetchAllPages(
    "institutions",
    { filters: "ACTIVE:1", fields: FDIC_INSTITUTION_FIELDS.join(","), sort_by: "CERT", sort_order: "ASC" },
    options,
  );
}

/** Look up specific certificates (any status) to learn whether they closed or merged. */
export async function fetchFdicInstitutionsByCert(
  certs: string[],
  options: RegistryFetchOptions = {},
): Promise<FdicPage> {
  const clean = certs.map((c) => c.trim()).filter((c) => /^\d+$/.test(c));
  if (clean.length === 0) return { rows: [], url: "" };
  return fetchAllPages(
    "institutions",
    { filters: clean.map((c) => `CERT:${c}`).join(" OR "), fields: FDIC_INSTITUTION_FIELDS.join(","), sort_by: "CERT", sort_order: "ASC" },
    options,
  );
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed);
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** FDIC dates come as "MM/DD/YYYY"; 12/31/9999 means "no end date". */
export function parseFdicDate(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  if (match[3] === "9999") return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

export interface FdicFinancialRow {
  cert: string;
  report_date: string;
  total_assets: number | null;
  total_deposits: number | null;
  total_loans: number | null;
  total_equity: number | null;
  total_securities: number | null;
  net_income: number | null;
  net_interest_income: number | null;
  other_noninterest_income: number | null;
  noninterest_expense: number | null;
  provision_for_losses: number | null;
  service_charge_income: number | null;
  net_charge_offs: number | null;
  noncurrent_loans: number | null;
  loans_real_estate: number | null;
  loans_commercial: number | null;
  loans_consumer: number | null;
  loans_credit_card: number | null;
  loans_auto: number | null;
  loans_agricultural: number | null;
  core_deposits: number | null;
  brokered_deposits: number | null;
  uninsured_deposits: number | null;
  total_revenue: number | null;
  fee_income_ratio: number | null;
  roa: number | null;
  roe: number | null;
  net_interest_margin: number | null;
  efficiency_ratio: number | null;
  net_charge_off_rate: number | null;
  noncurrent_loan_rate: number | null;
  leverage_ratio: number | null;
  tier1_capital_ratio: number | null;
  total_capital_ratio: number | null;
  employee_count: number | null;
  branch_count: number | null;
  raw_json: FdicRecord;
}

export function parseFdicFinancial(record: FdicRecord, q: Quarter): FdicFinancialRow | null {
  const cert = str(record.CERT);
  if (!cert) return null;
  const netInterestIncome = int(record.NIMQ);
  const nonInterestIncome = int(record.NONIIQ);
  const serviceCharges = int(record.ISERCHGQ);
  const totalRevenue =
    netInterestIncome === null && nonInterestIncome === null
      ? null
      : (netInterestIncome ?? 0) + (nonInterestIncome ?? 0);
  const feeIncomeRatio =
    serviceCharges !== null && totalRevenue !== null && totalRevenue > 0
      ? Number((serviceCharges / totalRevenue).toFixed(6))
      : null;

  return {
    cert,
    report_date: quarterEndDate(q),
    total_assets: int(record.ASSET),
    total_deposits: int(record.DEP),
    total_loans: int(record.LNLSNET),
    total_equity: int(record.EQTOT),
    total_securities: int(record.SC),
    net_income: int(record.NETINCQ),
    net_interest_income: netInterestIncome,
    other_noninterest_income: nonInterestIncome,
    noninterest_expense: int(record.NONIXQ),
    provision_for_losses: int(record.ELNATQ),
    service_charge_income: serviceCharges,
    net_charge_offs: int(record.NTLNLSQ),
    noncurrent_loans: int(record.NCLNLS),
    loans_real_estate: int(record.LNRE),
    loans_commercial: int(record.LNCI),
    loans_consumer: int(record.LNCON),
    loans_credit_card: int(record.LNCRCD),
    loans_auto: int(record.LNAUTO),
    loans_agricultural: int(record.LNAG),
    core_deposits: int(record.COREDEP),
    brokered_deposits: int(record.BRO),
    uninsured_deposits: int(record.DEPUNINS),
    total_revenue: totalRevenue,
    fee_income_ratio: feeIncomeRatio,
    roa: num(record.ROAQ),
    roe: num(record.ROEQ),
    net_interest_margin: num(record.NIMYQ),
    efficiency_ratio: num(record.EEFFQR),
    net_charge_off_rate: num(record.NTLNLSQR),
    noncurrent_loan_rate: num(record.NCLNLSR),
    leverage_ratio: num(record.RBC1AAJ),
    tier1_capital_ratio: num(record.RBC1RWAJ),
    total_capital_ratio: num(record.RBCRWAJ),
    employee_count: int(record.NUMEMP),
    branch_count: int(record.OFFDOM),
    raw_json: record,
  };
}

/** Same thresholds the existing segments use (asset_size in thousands). */
export function assetSizeTier(assetThousands: number | null): string | null {
  if (assetThousands === null || !Number.isFinite(assetThousands)) return null;
  if (assetThousands < 300_000) return "community_small";
  if (assetThousands < 1_000_000) return "community_mid";
  if (assetThousands < 10_000_000) return "community_large";
  if (assetThousands < 50_000_000) return "regional";
  if (assetThousands < 250_000_000) return "large_regional";
  return "super_regional";
}

export function normalizeWebsite(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered === "n/a" || lowered === "none" || !lowered.includes(".")) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

/** FDIC REGAGNT/CHRTAGNT codes to the label the profile shows. */
export function regulatorLabel(code: unknown): string | null {
  const text = str(code)?.toUpperCase();
  if (!text) return null;
  switch (text) {
    case "OCC":
      return "OCC";
    case "FDIC":
      return "FDIC";
    case "FED":
    case "FRB":
      return "Federal Reserve";
    case "OTS":
      return "OTS";
    case "STATE":
      return "State";
    case "NCUA":
      return "NCUA";
    default:
      return text;
  }
}

export interface FdicInstitutionRow {
  cert: string;
  name: string;
  active: boolean;
  rssd_id: string | null;
  holding_company_rssd: string | null;
  holding_company_name: string | null;
  primary_regulator: string | null;
  charter_agency: string | null;
  state_code: string | null;
  state_name: string | null;
  city: string | null;
  website_url: string | null;
  asset_size: number | null;
  asset_size_tier: string | null;
  fed_district: number | null;
  cbsa_code: string | null;
  cbsa_name: string | null;
  established_date: string | null;
  closed_date: string | null;
}

/** FDIC's FED field: the Federal Reserve district (1-12) of the head office. */
function fedDistrict(value: unknown): number | null {
  const n = int(value);
  return n !== null && n >= 1 && n <= 12 ? n : null;
}

export function parseFdicInstitution(record: FdicRecord): FdicInstitutionRow | null {
  const cert = str(record.CERT);
  const name = str(record.NAME);
  if (!cert || !name) return null;
  const asset = int(record.ASSET);
  const rssd = str(record.FED_RSSD);
  const hcRssd = str(record.RSSDHCR);
  const active = Number(record.ACTIVE) === 1;
  return {
    cert,
    name,
    active,
    rssd_id: rssd && rssd !== "0" ? rssd : null,
    holding_company_rssd: hcRssd && hcRssd !== "0" ? hcRssd : null,
    holding_company_name: str(record.NAMEHCR),
    primary_regulator: regulatorLabel(record.REGAGNT),
    charter_agency: regulatorLabel(record.CHRTAGNT),
    state_code: str(record.STALP)?.toUpperCase().slice(0, 2) ?? null,
    state_name: str(record.STNAME),
    city: str(record.CITY),
    website_url: normalizeWebsite(record.WEBADDR),
    asset_size: asset,
    asset_size_tier: assetSizeTier(asset),
    fed_district: fedDistrict(record.FED),
    cbsa_code: str(record.CBSA_NO),
    cbsa_name: str(record.CBSA),
    established_date: parseFdicDate(record.ESTYMD),
    closed_date: active ? null : parseFdicDate(record.ENDEFYMD),
  };
}

// ---------------------------------------------------------------------------
// Summary of Deposits (branch office deposits as of June 30 each year)
// ---------------------------------------------------------------------------

export const FDIC_SOD_FIELDS = [
  "CERT",
  "YEAR",
  "BRNUM",
  "BKMO",
  "DEPSUMBR",
  "NAMEBR",
  "ADDRESBR",
  "CITYBR",
  "STALPBR",
  "ZIPBR",
  "STCNTYBR",
  "MSABR",
  "MSANAMB",
  "SIMS_LATITUDE",
  "SIMS_LONGITUDE",
] as const;

export async function fetchFdicSodForYear(year: number, options: RegistryFetchOptions = {}): Promise<FdicPage> {
  return fetchAllPages(
    "sod",
    { filters: `YEAR:${year}`, fields: FDIC_SOD_FIELDS.join(","), sort_by: "UNINUMBR", sort_order: "ASC" },
    { timeoutMs: 120_000, ...options },
  );
}

export interface FdicSodRow {
  cert: number;
  year: number;
  branch_number: number;
  is_main_office: boolean;
  /** Thousands of dollars, as FDIC reports DEPSUMBR. */
  deposits: number | null;
  branch_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_fips: number | null;
  msa_code: number | null;
  msa_name: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function parseFdicSod(record: FdicRecord): FdicSodRow | null {
  const cert = int(record.CERT);
  const year = int(record.YEAR);
  const branch = int(record.BRNUM);
  if (cert === null || year === null || branch === null) return null;
  const msa = int(record.MSABR);
  return {
    cert,
    year,
    branch_number: branch,
    is_main_office: Number(record.BKMO) === 1,
    deposits: int(record.DEPSUMBR),
    branch_name: str(record.NAMEBR),
    address: str(record.ADDRESBR),
    city: str(record.CITYBR),
    state: str(record.STALPBR)?.toUpperCase() ?? null,
    zip: str(record.ZIPBR),
    county_fips: int(record.STCNTYBR),
    msa_code: msa && msa > 0 ? msa : null,
    msa_name: str(record.MSANAMB),
    latitude: num(record.SIMS_LATITUDE),
    longitude: num(record.SIMS_LONGITUDE),
  };
}
