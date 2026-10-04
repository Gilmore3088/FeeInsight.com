import { unzipSync, strFromU8 } from "fflate";
import { registryFetch, type RegistryFetchOptions } from "./http";
import { quarterEndDate, type Quarter } from "./quarters";
import { assetSizeTier } from "./fdic";

/**
 * NCUA 5300 call-report client and parsers. Pure: downloads the quarterly zip
 * and normalizes it, never writes to the database.
 *
 * Each zip holds FOICU.txt (one row per credit union: charter number, name,
 * location, charter type) and several FS220*.txt files whose ACCT_* columns are
 * the call-report accounts. Accounts are whole dollars and income accounts are
 * year to date; values are stored in thousands to match the existing NCUA rows,
 * and quarterly income is derived later from consecutive YTD values.
 *
 * Account codes follow the NCUA 5300 instructions (2025.1) and account
 * descriptions: 010 total assets, 018 shares and deposits, 025B loans and
 * leases, 131 fee income, 661A net income, 115 interest income, 117 non-interest
 * income, 671 non-interest expense, 550/551 YTD charge-offs/recoveries, 041B
 * delinquent loans, 997/998 net worth and net worth ratio, 083 members,
 * 703A + 386A + 386B real estate, 396 credit card, 385 + 370 vehicle loans.
 * Every mapped account's raw value is kept in raw_json so a mapping correction
 * never needs a re-fetch.
 */

export const NCUA_BASE = "https://ncua.gov/files/publications";

/** Zip location by quarter; NCUA renamed the archive three times. */
export function ncuaZipUrl(q: Quarter): string {
  const mm = String(q.quarter * 3).padStart(2, "0");
  if (q.year >= 2016) return `${NCUA_BASE}/analysis/call-report-data-${q.year}-${mm}.zip`;
  if (q.year === 2015 && q.quarter >= 2) return `${NCUA_BASE}/analysis/Call-Report-Data-2015-${mm}.zip`;
  if (q.year === 2013 && q.quarter === 2) return `${NCUA_BASE}/data-apps/5300Data0613Final.zip`;
  const ext = q.year === 2010 && (q.quarter === 2 || q.quarter === 4) ? "Zip" : "zip";
  return `${NCUA_BASE}/data-apps/QCR${q.year}${mm}.${ext}`;
}

export const NCUA_ACCOUNTS = {
  total_assets: "ACCT_010",
  total_deposits: "ACCT_018",
  total_loans: "ACCT_025B",
  fee_income_ytd: "ACCT_131",
  net_income_ytd: "ACCT_661A",
  interest_income_ytd: "ACCT_115",
  noninterest_income_ytd: "ACCT_117",
  noninterest_expense_ytd: "ACCT_671",
  charge_offs_ytd: "ACCT_550",
  recoveries_ytd: "ACCT_551",
  delinquent_loans: "ACCT_041B",
  net_worth: "ACCT_997",
  net_worth_ratio: "ACCT_998",
  members: "ACCT_083",
  first_mortgage: "ACCT_703A",
  junior_lien: "ACCT_386A",
  other_real_estate: "ACCT_386B",
  credit_card: "ACCT_396",
  new_vehicle: "ACCT_385",
  used_vehicle: "ACCT_370",
} as const;

type Row = Record<string, string>;

/** Minimal RFC 4180 CSV parser (NCUA files are comma-delimited with quotes). */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toUpperCase());
  return body.map((cells) => Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? "").trim()])));
}

export interface NcuaArchive {
  foicu: Row[];
  /** CU_NUMBER -> merged ACCT_* values across every FS220*.txt file. */
  accounts: Map<string, Row>;
}

const WANTED_ACCOUNTS = new Set<string>(Object.values(NCUA_ACCOUNTS));

export function readNcuaArchive(zip: Uint8Array): NcuaArchive {
  const files = unzipSync(zip, {
    filter: (file) => /(^|\/)(foicu|fs220[a-z]?)\.txt$/i.test(file.name),
  });
  let foicu: Row[] = [];
  const accounts = new Map<string, Row>();
  for (const [name, bytes] of Object.entries(files)) {
    const rows = parseCsv(strFromU8(bytes, true));
    if (/foicu\.txt$/i.test(name)) {
      foicu = rows;
      continue;
    }
    for (const row of rows) {
      const cu = row.CU_NUMBER;
      if (!cu) continue;
      const merged = accounts.get(cu) ?? {};
      for (const [key, value] of Object.entries(row)) {
        if (WANTED_ACCOUNTS.has(key)) merged[key] = value;
      }
      accounts.set(cu, merged);
    }
  }
  return { foicu, accounts };
}

export async function fetchNcuaArchive(
  q: Quarter,
  options: RegistryFetchOptions = {},
): Promise<{ archive: NcuaArchive | null; url: string }> {
  const url = ncuaZipUrl(q);
  try {
    const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { archive: readNcuaArchive(bytes), url };
  } catch (error) {
    // A missing zip means NCUA has not published the quarter yet.
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404) {
      return { archive: null, url };
    }
    throw error;
  }
}

function dollars(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function thousands(value: number | null): number | null {
  return value === null ? null : Math.round(value / 1000);
}

function sumOrNull(...values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export interface NcuaInstitutionRow {
  charter: string;
  name: string;
  city: string | null;
  state_code: string | null;
  cu_charter_type: "federal" | "state" | null;
  rssd_id: string | null;
}

export function parseNcuaInstitution(row: Row): NcuaInstitutionRow | null {
  const charter = row.CU_NUMBER?.replace(/^0+/, "");
  const name = row.CU_NAME;
  if (!charter || !name) return null;
  const type = row.CU_TYPE;
  const state = (row.STATE || row.STATE_CODE || "").toUpperCase();
  return {
    charter,
    name,
    city: row.CITY || null,
    state_code: /^[A-Z]{2}$/.test(state) ? state : null,
    cu_charter_type: type === "1" ? "federal" : type === "2" ? "state" : null,
    rssd_id: row.RSSD && row.RSSD !== "0" ? row.RSSD : null,
  };
}

export interface NcuaFinancialRow {
  charter: string;
  report_date: string;
  total_assets: number | null;
  total_deposits: number | null;
  total_loans: number | null;
  total_equity: number | null;
  /** Year-to-date values (thousands); quarterly figures are derived by the worker. */
  net_income_ytd: number | null;
  fee_income_ytd: number | null;
  net_charge_offs_ytd: number | null;
  noninterest_expense_ytd: number | null;
  total_revenue_ytd: number | null;
  noncurrent_loans: number | null;
  loans_real_estate: number | null;
  loans_commercial: number | null;
  loans_consumer: number | null;
  loans_credit_card: number | null;
  loans_auto: number | null;
  tier1_capital_ratio: number | null;
  roa: number | null;
  net_charge_off_rate: number | null;
  noncurrent_loan_rate: number | null;
  efficiency_ratio: number | null;
  member_count: number | null;
  raw_json: Row;
}

export function parseNcuaFinancial(charterRaw: string, row: Row, q: Quarter): NcuaFinancialRow | null {
  const charter = charterRaw.replace(/^0+/, "");
  if (!charter) return null;
  const a = (key: keyof typeof NCUA_ACCOUNTS) => dollars(row[NCUA_ACCOUNTS[key]]);
  const assets = a("total_assets");
  const loans = a("total_loans");
  const netIncome = a("net_income_ytd");
  const chargeOffs = a("charge_offs_ytd");
  const recoveries = a("recoveries_ytd");
  const nco = chargeOffs === null ? null : chargeOffs - (recoveries ?? 0);
  const interestIncome = a("interest_income_ytd");
  const nonInterestIncome = a("noninterest_income_ytd");
  const revenue = sumOrNull(interestIncome, nonInterestIncome);
  const expense = a("noninterest_expense_ytd");
  const delinquent = a("delinquent_loans");
  const realEstate = sumOrNull(a("first_mortgage"), a("junior_lien"), a("other_real_estate"));
  const creditCard = a("credit_card");
  const auto = sumOrNull(a("new_vehicle"), a("used_vehicle"));
  const annualize = 4 / q.quarter;

  return {
    charter,
    report_date: quarterEndDate(q),
    total_assets: thousands(assets),
    total_deposits: thousands(a("total_deposits")),
    total_loans: thousands(loans),
    total_equity: thousands(a("net_worth")),
    net_income_ytd: thousands(netIncome),
    fee_income_ytd: thousands(a("fee_income_ytd")),
    net_charge_offs_ytd: thousands(nco),
    noninterest_expense_ytd: thousands(expense),
    total_revenue_ytd: thousands(revenue),
    noncurrent_loans: thousands(delinquent),
    loans_real_estate: thousands(realEstate),
    // No single 5300 total for commercial loans across all cycles; left null.
    loans_commercial: null,
    loans_consumer: thousands(sumOrNull(creditCard, auto)),
    loans_credit_card: thousands(creditCard),
    loans_auto: thousands(auto),
    tier1_capital_ratio: a("net_worth_ratio"),
    roa: netIncome !== null && assets ? Number(((netIncome * annualize * 100) / assets).toFixed(4)) : null,
    net_charge_off_rate: nco !== null && loans ? Number(((nco * annualize * 100) / loans).toFixed(4)) : null,
    noncurrent_loan_rate: delinquent !== null && loans ? Number(((delinquent * 100) / loans).toFixed(4)) : null,
    // Needs interest expense, which this account set does not carry reliably.
    efficiency_ratio: null,
    member_count: a("members"),
    raw_json: row,
  };
}

export { assetSizeTier };
