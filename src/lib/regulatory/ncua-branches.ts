import { unzipSync, strFromU8 } from "fflate";
import { registryFetch, type RegistryFetchOptions } from "./http";
import { parseCsv, ncuaZipUrl } from "./ncua";
import { quarterEndDate, type Quarter } from "./quarters";

/**
 * NCUA credit union branch offices. Pure: downloads the quarterly 5300 archive
 * and reads its "Credit Union Branch Information" file, never writes to the database.
 *
 * The file has one row per office (headquarters included) with a physical address
 * but no coordinates and no deposits. Column names are matched loosely (case and
 * punctuation ignored, a few known spellings), and a file whose required columns
 * can't be found fails loudly with the header it did see, rather than loading nothing.
 */

type Row = Record<string, string>;

export interface NcuaBranchRow {
  charter: string;
  site_id: string;
  cu_name: string | null;
  site_name: string | null;
  site_type: string | null;
  is_main_office: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county_name: string | null;
}

export class NcuaBranchFormatError extends Error {
  constructor(
    message: string,
    readonly header: string[],
  ) {
    super(message);
    this.name = "NcuaBranchFormatError";
  }
}

const BRANCH_FILE = /(^|\/)[^/]*branch[^/]*\.txt$/i;

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Accepted spellings per field, normalized. The first one present in the header wins. */
const COLUMNS = {
  charter: ["cunumber", "charternumber", "cuno"],
  site_id: ["siteid", "site_id", "branchid"],
  cu_name: ["cuname", "creditunionname"],
  site_name: ["sitename", "branchname"],
  site_type: ["sitetypename", "sitetype"],
  main_office: ["mainoffice", "ismainoffice"],
  address1: ["physicaladdressline1", "physicaladdress1", "address1", "streetaddress", "address"],
  address2: ["physicaladdressline2", "physicaladdress2", "address2"],
  city: ["physicaladdresscity", "physicalcity", "city"],
  state: ["physicaladdressstatecode", "physicaladdressstate", "physicalstate", "statecode", "state"],
  zip: ["physicaladdresspostalcode", "physicaladdresszip", "physicalzip", "postalcode", "zipcode", "zip"],
  county: ["physicaladdresscountyname", "physicalcounty", "countyname", "county"],
} as const;

type Field = keyof typeof COLUMNS;
const REQUIRED: Field[] = ["charter", "site_id", "address1", "city", "state"];

/** Header key (as parseCsv returns it) for each field, or undefined when absent. */
export function resolveBranchColumns(header: string[]): Partial<Record<Field, string>> {
  const byNorm = new Map(header.map((h) => [norm(h), h]));
  const out: Partial<Record<Field, string>> = {};
  for (const [field, names] of Object.entries(COLUMNS) as [Field, readonly string[]][]) {
    const hit = names.map((name) => byNorm.get(norm(name))).find((key) => key !== undefined);
    if (hit) out[field] = hit;
  }
  return out;
}

const clean = (value: string | undefined): string | null => {
  const v = (value ?? "").trim().replace(/\s+/g, " ");
  return v === "" ? null : v;
};

function yes(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "y" || v === "yes" || v === "true";
}

export function parseNcuaBranches(rows: Row[]): NcuaBranchRow[] {
  const header = Object.keys(rows[0] ?? {});
  if (rows.length === 0) return [];
  const cols = resolveBranchColumns(header);
  const missing = REQUIRED.filter((field) => !cols[field]);
  if (missing.length > 0) {
    throw new NcuaBranchFormatError(
      `NCUA branch file is missing ${missing.join(", ")}; header was: ${header.join(", ")}`,
      header,
    );
  }
  const get = (row: Row, field: Field) => (cols[field] ? row[cols[field] as string] : undefined);
  const out: NcuaBranchRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const charter = get(row, "charter")?.replace(/^0+/, "");
    const siteId = clean(get(row, "site_id"));
    if (!charter || !siteId) continue;
    const key = `${charter}:${siteId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line1 = clean(get(row, "address1"));
    const line2 = clean(get(row, "address2"));
    const siteType = clean(get(row, "site_type"));
    const zip = clean(get(row, "zip"));
    out.push({
      charter,
      site_id: siteId,
      cu_name: clean(get(row, "cu_name")),
      site_name: clean(get(row, "site_name")),
      site_type: siteType,
      is_main_office: cols.main_office ? yes(get(row, "main_office")) : /main|headquarter/i.test(siteType ?? ""),
      address: [line1, line2].filter(Boolean).join(", ") || null,
      city: clean(get(row, "city")),
      state: clean(get(row, "state"))?.toUpperCase() ?? null,
      zip: zip ? zip.replace(/[^0-9-]/g, "") || null : null,
      county_name: clean(get(row, "county")),
    });
  }
  return out;
}

/** The branch file's rows from a 5300 archive, or null when the archive has no branch file. */
export function readNcuaBranchFile(zip: Uint8Array): { file: string; rows: Row[] } | null {
  const files = unzipSync(zip, { filter: (file) => BRANCH_FILE.test(file.name) });
  const [entry] = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  if (!entry) return null;
  return { file: entry[0], rows: parseCsv(strFromU8(entry[1], true)) };
}

export interface NcuaBranchFetch {
  url: string;
  reportDate: string;
  /** null when NCUA has not published the quarter yet. */
  file: string | null;
  branches: NcuaBranchRow[] | null;
}

export async function fetchNcuaBranches(q: Quarter, options: RegistryFetchOptions = {}): Promise<NcuaBranchFetch> {
  const url = ncuaZipUrl(q);
  const reportDate = quarterEndDate(q);
  try {
    const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
    const found = readNcuaBranchFile(new Uint8Array(await response.arrayBuffer()));
    if (!found) throw new Error(`No branch information file in ${url}`);
    return { url, reportDate, file: found.file, branches: parseNcuaBranches(found.rows) };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404) {
      return { url, reportDate, file: null, branches: null };
    }
    throw error;
  }
}
