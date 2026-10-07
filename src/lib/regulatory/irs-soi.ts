import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";

/**
 * IRS Statistics of Income individual returns by ZIP code (irs.gov/pub/irs-soi). Pure transport
 * and parsing: no DB access. One file per tax year, one row per ZIP across all income sizes
 * ("zpallnoagi"). Amounts are in thousands of dollars, as the IRS publishes them.
 *
 * Taxable interest by ZIP is the closest public measure of local deposit balances; AGI per
 * return and the share of returns claiming the earned income credit show local income. ZIP
 * 00000 (state total) and 99999 (not classified) are skipped. The IRS suppresses ZIPs with
 * fewer than 100 returns, so those ZIPs are simply absent.
 */

export const IRS_SOI_BASE = "https://www.irs.gov/pub/irs-soi";
export const IRS_SOI_FIRST_YEAR = 2018;

/** Stored field -> IRS column (headers are matched case-insensitively). */
export const IRS_SOI_COLUMNS = {
  returns: "N1",
  individuals: "N2",
  agi_thousands: "A00100",
  wages_thousands: "A00200",
  interest_returns: "N00300",
  taxable_interest_thousands: "A00300",
  dividends_thousands: "A00600",
  eitc_returns: "N59660",
} as const;

export type IrsSoiField = keyof typeof IRS_SOI_COLUMNS;

export type IrsZipRow = {
  tax_year: number;
  zip: string;
  state: string | null;
  state_fips: string | null;
} & Record<IrsSoiField, number | null>;

export function irsSoiZipUrl(taxYear: number): string {
  return `${IRS_SOI_BASE}/${String(taxYear % 100).padStart(2, "0")}zpallnoagi.csv`;
}

function number(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value.trim().replace(/^"|"$/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse the CSV keeping only the columns stored. The SOI files have no quoted commas, so a
 * plain split keeps memory to the wanted fields on a ~30 MB file.
 */
export function parseIrsZipCsv(text: string, taxYear: number): IrsZipRow[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, "").toUpperCase());
  const at = (name: string) => header.indexOf(name);
  const zipCol = at("ZIPCODE");
  if (zipCol < 0) return [];
  const stateCol = at("STATE");
  const fipsCol = at("STATEFIPS");
  const stubCol = at("AGI_STUB");
  const cols = (Object.keys(IRS_SOI_COLUMNS) as IrsSoiField[]).map((field) => [field, at(IRS_SOI_COLUMNS[field])] as const);

  const out: IrsZipRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    // A per-size-class file repeats each ZIP once per income bracket; only the all-incomes rows count.
    if (stubCol >= 0 && number(cells[stubCol]) !== null && number(cells[stubCol]) !== 0) continue;
    const zipRaw = (cells[zipCol] ?? "").trim().replace(/^"|"$/g, "");
    if (!/^\d{1,5}$/.test(zipRaw)) continue;
    const zip = zipRaw.padStart(5, "0");
    if (zip === "00000" || zip === "99999") continue;
    const fips = fipsCol >= 0 ? (cells[fipsCol] ?? "").trim().replace(/^"|"$/g, "") : "";
    const row = {
      tax_year: taxYear,
      zip,
      state: stateCol >= 0 ? (cells[stateCol] ?? "").trim().replace(/^"|"$/g, "") || null : null,
      state_fips: /^\d{1,2}$/.test(fips) ? fips.padStart(2, "0") : null,
    } as IrsZipRow;
    for (const [field, col] of cols) row[field] = col >= 0 ? number(cells[col]) : null;
    out.push(row);
  }
  return out;
}

/** One tax year's ZIP file; null when the IRS has not published it. */
export async function fetchIrsZipIncome(
  taxYear: number,
  options: RegistryFetchOptions = {},
): Promise<{ url: string; rows: IrsZipRow[] } | null> {
  const url = irsSoiZipUrl(taxYear);
  try {
    const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
    const text = await response.text();
    if (!/^\s*"?STATEFIPS/i.test(text)) return null;
    return { url, rows: parseIrsZipCsv(text, taxYear) };
  } catch (error) {
    if (error instanceof RegistryHttpError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}
