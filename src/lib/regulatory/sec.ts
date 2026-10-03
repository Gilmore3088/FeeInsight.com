import { registryFetchJson, type RegistryFetchOptions } from "./http";

/**
 * SEC EDGAR client and parsers (public JSON APIs; SEC requires a contact
 * User-Agent, which registryFetch sends). Pure: no DB.
 *
 * - company_tickers_exchange.json: every listed filer (CIK, name, ticker, exchange).
 * - submissions/CIK##########.json: SIC code and recent filings.
 * - api/xbrl/companyfacts/CIK##########.json: XBRL facts; calendar "frames"
 *   give one deduplicated value per quarter (CY2025Q4I instants, CY2025Q4
 *   three-month durations).
 */

export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
export const SEC_DATA = "https://data.sec.gov";
/** Commercial banks, savings institutions, and bank holding companies. */
export const BANK_SIC_CODES = new Set(["6021", "6022", "6029", "6035", "6036", "6111", "6199", "6712"]);
export const SEC_FILING_FORMS = new Set(["10-K", "10-Q", "8-K", "DEF 14A", "10-K/A", "10-Q/A"]);
export const SEC_MAX_FILINGS_PER_CIK = 60;

export function paddedCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

export interface SecTicker {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
}

export async function fetchSecTickers(options: RegistryFetchOptions = {}): Promise<SecTicker[]> {
  const body = await registryFetchJson<{ fields?: string[]; data?: unknown[][] }>(SEC_TICKERS_URL, options);
  const fields = body.fields ?? [];
  const at = (name: string) => fields.indexOf(name);
  const byCik = new Map<string, SecTicker>();
  for (const row of body.data ?? []) {
    const cik = String(row[at("cik")] ?? "");
    if (!cik || byCik.has(cik)) continue;
    byCik.set(cik, {
      cik,
      name: String(row[at("name")] ?? ""),
      ticker: String(row[at("ticker")] ?? ""),
      exchange: row[at("exchange")] ? String(row[at("exchange")]) : null,
    });
  }
  return [...byCik.values()];
}

export interface SecFiling {
  accession_no: string;
  form: string;
  filed_at: string;
  period_of_report: string | null;
  primary_doc_url: string | null;
  description: string | null;
}

export interface SecSubmissions {
  cik: string;
  name: string;
  sic: string | null;
  sicDescription: string | null;
  tickers: string[];
  filings: SecFiling[];
}

interface RawSubmissions {
  cik?: string | number;
  name?: string;
  sic?: string;
  sicDescription?: string;
  tickers?: string[];
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

export function parseSecSubmissions(body: RawSubmissions, cikInput: string): SecSubmissions {
  const cik = String(Number(body.cik ?? cikInput));
  const recent = body.filings?.recent ?? {};
  const filings: SecFiling[] = [];
  const count = recent.accessionNumber?.length ?? 0;
  for (let i = 0; i < count && filings.length < SEC_MAX_FILINGS_PER_CIK; i += 1) {
    const form = recent.form?.[i] ?? "";
    if (!SEC_FILING_FORMS.has(form)) continue;
    const accession = recent.accessionNumber?.[i] ?? "";
    const doc = recent.primaryDocument?.[i] ?? "";
    filings.push({
      accession_no: accession,
      form,
      filed_at: recent.filingDate?.[i] ?? "",
      period_of_report: recent.reportDate?.[i] || null,
      primary_doc_url: accession && doc
        ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${doc}`
        : null,
      description: recent.primaryDocDescription?.[i] || null,
    });
  }
  return {
    cik,
    name: body.name ?? "",
    sic: body.sic ? String(body.sic) : null,
    sicDescription: body.sicDescription ?? null,
    tickers: body.tickers ?? [],
    filings,
  };
}

export async function fetchSecSubmissions(cik: string, options: RegistryFetchOptions = {}): Promise<SecSubmissions> {
  const body = await registryFetchJson<RawSubmissions>(`${SEC_DATA}/submissions/CIK${paddedCik(cik)}.json`, options);
  return parseSecSubmissions(body, cik);
}

interface FactEntry {
  end?: string;
  val?: number;
  frame?: string;
}

interface RawCompanyFacts {
  facts?: Record<string, Record<string, { units?: Record<string, FactEntry[]> }>>;
}

export interface SecQuarterFacts {
  period_end: string;
  fiscal_period: string;
  total_assets: number | null;
  total_liabilities: number | null;
  stockholders_equity: number | null;
  net_income: number | null;
  eps_diluted: number | null;
}

const CONCEPTS: Array<{ key: keyof Omit<SecQuarterFacts, "period_end" | "fiscal_period">; names: string[]; unit: string; instant: boolean }> = [
  { key: "total_assets", names: ["Assets"], unit: "USD", instant: true },
  { key: "total_liabilities", names: ["Liabilities"], unit: "USD", instant: true },
  {
    key: "stockholders_equity",
    names: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    unit: "USD",
    instant: true,
  },
  { key: "net_income", names: ["NetIncomeLoss", "ProfitLoss"], unit: "USD", instant: false },
  { key: "eps_diluted", names: ["EarningsPerShareDiluted"], unit: "USD/shares", instant: false },
];

/** One row per calendar quarter, from XBRL frames (instants end in "I"). */
export function parseSecCompanyFacts(body: RawCompanyFacts, sinceYear = 2010): SecQuarterFacts[] {
  const gaap = body.facts?.["us-gaap"] ?? {};
  const byPeriod = new Map<string, SecQuarterFacts>();
  for (const concept of CONCEPTS) {
    for (const name of concept.names) {
      const entries = gaap[name]?.units?.[concept.unit] ?? [];
      let found = false;
      for (const entry of entries) {
        const frame = entry.frame ?? "";
        const match = /^CY(\d{4})Q([1-4])(I?)$/.exec(frame);
        if (!match || !entry.end || typeof entry.val !== "number") continue;
        if ((match[3] === "I") !== concept.instant) continue;
        if (Number(match[1]) < sinceYear) continue;
        const row = byPeriod.get(entry.end) ?? {
          period_end: entry.end,
          fiscal_period: `${match[1]}Q${match[2]}`,
          total_assets: null,
          total_liabilities: null,
          stockholders_equity: null,
          net_income: null,
          eps_diluted: null,
        };
        if (row[concept.key] === null) row[concept.key] = entry.val;
        byPeriod.set(entry.end, row);
        found = true;
      }
      if (found) break;
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.period_end.localeCompare(b.period_end));
}

export async function fetchSecCompanyFacts(
  cik: string,
  options: RegistryFetchOptions = {},
): Promise<{ facts: SecQuarterFacts[]; url: string } | null> {
  const url = `${SEC_DATA}/api/xbrl/companyfacts/CIK${paddedCik(cik)}.json`;
  try {
    const body = await registryFetchJson<RawCompanyFacts>(url, { timeoutMs: 90_000, ...options });
    return { facts: parseSecCompanyFacts(body), url };
  } catch (error) {
    // Small filers often have no XBRL facts; that is not a failure.
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404) return null;
    throw error;
  }
}
