import { strFromU8 } from "fflate";

import type { AreaFetch, AreaStat } from "./economy";
import { htmlToText } from "./fed";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { eventDate, findDataLinks, parseCsvTable, readHtmlTables, type Table } from "./industry-events";

/**
 * Posted advance rates from the eleven Federal Home Loan Banks. Pure: fetches and parses; never
 * writes to the database.
 *
 * Each FHLBank posts its own rate sheet in its own format (an HTML table, a CSV or a PDF), and
 * several keep rates behind the member portal. The page addresses below are written from memory
 * (the FHLBank sites are not reachable from where this was written), so none is trusted: a run
 * reads whatever the page is and decides then:
 *   - a table whose header names terms and products (or products and terms) -> one value per cell;
 *   - a password field or "member login" wording with no rate table -> skipped, reason "member login";
 *   - rate-sheet images with no table -> skipped, reason "images only";
 *   - anything else -> skipped, reason "no rate table found", with what was seen.
 * A rate is stored only with the date the bank states it was posted. A page with no stated date
 * stores nothing: the fetch date is never used as the posted date. A cell that is not a number
 * ("N/A", "--", blank) is stored as null with the cell text in `note`; no rate is ever guessed.
 *
 * An address can be overridden per bank without a code change: FHLB_<BANK>_RATES_URL (for
 * example FHLB_DES_MOINES_RATES_URL) is tried before the remembered addresses.
 */

export interface FhlbBank {
  /** Partition key and series_key segment (kebab case; underscores in series keys). */
  key: string;
  name: string;
  district: number;
  /** Candidate public pages, tried in order (from memory; verified at run time). */
  pages: readonly string[];
}

export const FHLB_BANKS: readonly FhlbBank[] = [
  { key: "boston", name: "Federal Home Loan Bank of Boston", district: 1, pages: ["https://www.fhlbboston.com/fhlbank-boston/rates", "https://www.fhlbboston.com/rates"] },
  { key: "new-york", name: "Federal Home Loan Bank of New York", district: 2, pages: ["https://www.fhlbny.com/rates/", "https://www.fhlbny.com/products/advances/rates/"] },
  { key: "pittsburgh", name: "Federal Home Loan Bank of Pittsburgh", district: 3, pages: ["https://www.fhlb-pgh.com/resources/rates", "https://www.fhlb-pgh.com/rates"] },
  { key: "atlanta", name: "Federal Home Loan Bank of Atlanta", district: 4, pages: ["https://corp.fhlbatl.com/rates/", "https://www.fhlbatl.com/rates"] },
  { key: "cincinnati", name: "Federal Home Loan Bank of Cincinnati", district: 5, pages: ["https://www.fhlbcin.com/rates/", "https://www.fhlbcin.com/products-services/advances/rates/"] },
  { key: "indianapolis", name: "Federal Home Loan Bank of Indianapolis", district: 6, pages: ["https://www.fhlbi.com/rates", "https://www.fhlbi.com/products-services/advances/rates"] },
  { key: "chicago", name: "Federal Home Loan Bank of Chicago", district: 7, pages: ["https://www.fhlbc.com/rates", "https://www.fhlbc.com/products/advances/rates"] },
  { key: "des-moines", name: "Federal Home Loan Bank of Des Moines", district: 8, pages: ["https://www.fhlbdm.com/rates/", "https://www.fhlbdm.com/products-services/advances/rates/"] },
  { key: "dallas", name: "Federal Home Loan Bank of Dallas", district: 9, pages: ["https://www.fhlb.com/rates", "https://www.fhlb.com/products-and-services/advances/rates"] },
  { key: "topeka", name: "Federal Home Loan Bank of Topeka", district: 10, pages: ["https://www.fhlbtopeka.com/rates", "https://www.fhlbtopeka.com/products/advances/rates"] },
  { key: "san-francisco", name: "Federal Home Loan Bank of San Francisco", district: 11, pages: ["https://www.fhlbsf.com/rates", "https://www.fhlbsf.com/products/advances/rates"] },
];

export function fhlbBank(key: string): FhlbBank | null {
  return FHLB_BANKS.find((b) => b.key === key) ?? null;
}

export function fhlbUrlEnv(bank: FhlbBank): string {
  return `FHLB_${bank.key.toUpperCase().replace(/-/g, "_")}_RATES_URL`;
}

/** Lower snake case, letters and digits only, capped so a long header cannot make an unusable key. */
export function slug(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/%/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/g, "");
}

/**
 * A term label as a short key: "Overnight" -> overnight, "30 Day" -> 30d, "3 Mo" -> 3m,
 * "1 Year" -> 1y, "1.5 Yr" -> 1_5y. Null when the label is not a term.
 */
export function termKey(label: string | null | undefined): string | null {
  const raw = (label ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/^(overnight|o\/n|on|daily cash|cash management|1 day|one day)$/.test(raw)) return "overnight";
  const m = /^(\d+(?:\.\d+)?)\s*-?\s*(days?|d|weeks?|wks?|w|months?|mos?\.?|mths?|m|years?|yrs?\.?|y)$/.exec(raw);
  if (!m) return null;
  const n = m[1].replace(".", "_");
  const unit = m[2][0] === "d" ? "d" : m[2][0] === "w" ? "w" : m[2][0] === "m" ? "m" : "y";
  return `${n}${unit}`;
}

/** A posted rate cell: "4.52", "4.52%", " 4.520 " -> number; anything else -> null. */
export function rateValue(cell: string | null | undefined): number | null {
  const raw = (cell ?? "").replace(/\s+/g, "").replace(/%$/, "");
  if (!/^-?\d{1,2}(\.\d{1,5})?$/.test(raw)) return null;
  const out = Number(raw);
  return Number.isFinite(out) ? out : null;
}

const TERM_HEADER = /^(term|maturity|tenor|terms?\s*\/?\s*maturity|advance term|period)$/i;
const DATE_LABEL =
  /(?:rates?\s+(?:as\s+of|effective|for|posted)|effective(?:\s+date)?|as\s+of|posted(?:\s+on)?|rate\s+date|updated)\s*:?\s*(?:[A-Za-z]+day,?\s+)?([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i;

/** The posting date the page states ("Rates as of October 16, 2026", "Effective: 10/16/2026"); null when none. */
export function postedDate(text: string): string | null {
  const m = DATE_LABEL.exec(text);
  if (!m) return null;
  const raw = m[1].replace(/\.(?=\s)/, "");
  const twoDigitYear = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw);
  if (twoDigitYear) return eventDate(`${twoDigitYear[1]}/${twoDigitYear[2]}/20${twoDigitYear[3]}`);
  return eventDate(raw);
}

export interface RateCell {
  product: string;
  productLabel: string;
  term: string;
  termLabel: string;
  value: number | null;
  cell: string;
  unit: "percent" | "basis_points";
  tableIndex: number;
}

export interface RateTableRead {
  cells: RateCell[];
  /** Term labels (or product rows) that could not be read, kept for the partition detail. */
  unreadTerms: string[];
  orientation: "terms_down" | "terms_across";
}

function unitOf(label: string): "percent" | "basis_points" {
  return /\bbps\b|basis points?|spread/i.test(label) ? "basis_points" : "percent";
}

/**
 * One rate table: either a term column with one column per product (terms down), or a product
 * column with one column per term (terms across). Null when neither shape is there.
 */
export function readRateTable(table: Table, tableIndex: number): RateTableRead | null {
  for (let h = 0; h < Math.min(5, table.length); h += 1) {
    const header = table[h].map((c) => c.trim());
    const termCol = header.findIndex((c) => TERM_HEADER.test(c));
    if (termCol >= 0) {
      const products = header.map((label, i) => ({ label, i })).filter((p) => p.i !== termCol && p.label !== "");
      if (products.length === 0) continue;
      const cells: RateCell[] = [];
      const unreadTerms: string[] = [];
      for (const row of table.slice(h + 1)) {
        const termLabel = (row[termCol] ?? "").trim();
        const term = termKey(termLabel);
        if (!term) {
          if (termLabel) unreadTerms.push(termLabel.slice(0, 60));
          continue;
        }
        for (const p of products) {
          const cell = (row[p.i] ?? "").trim();
          cells.push({ product: slug(p.label), productLabel: p.label, term, termLabel, value: rateValue(cell), cell, unit: unitOf(p.label), tableIndex });
        }
      }
      if (cells.length > 0) return { cells, unreadTerms, orientation: "terms_down" };
    }
    const terms = header.map((label, i) => ({ label, i, term: termKey(label) })).filter((t) => t.i > 0 && t.term);
    if (terms.length >= 2) {
      const cells: RateCell[] = [];
      const unreadTerms = header.slice(1).filter((label) => label !== "" && !termKey(label)).map((l) => l.slice(0, 60));
      for (const row of table.slice(h + 1)) {
        const productLabel = (row[0] ?? "").trim();
        if (!productLabel || rateValue(productLabel) !== null) continue;
        for (const t of terms) {
          const cell = (row[t.i] ?? "").trim();
          cells.push({ product: slug(productLabel), productLabel, term: t.term!, termLabel: t.label, value: rateValue(cell), cell, unit: unitOf(productLabel), tableIndex });
        }
      }
      if (cells.length > 0) return { cells, unreadTerms, orientation: "terms_across" };
    }
  }
  return null;
}

/**
 * Rate lines in PDF text: "<term label> <rate> <rate> ..." under a header line naming the products.
 * Only lines whose first words read as a term and whose remaining tokens are all numbers count.
 */
export function pdfRateTable(text: string): Table {
  const rows: Table = [];
  let header: string | null = null;
  const rawLine = (l: string) => l.replace(/\s+/g, " ").trim();
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const m = /^((?:\d+(?:\.\d+)?\s*-?\s*[A-Za-z.]+)|overnight)\s+((?:-?\d{1,2}\.\d{1,5}%?|N\/A|--)(?:\s+(?:-?\d{1,2}\.\d{1,5}%?|N\/A|--))*)$/i.exec(rawLine(line));
    if (m && termKey(m[1])) {
      if (!header) return [];
      rows.push([m[1], ...m[2].split(" ")]);
      continue;
    }
    if (/^term\b/i.test(rawLine(line)) && rows.length === 0) header = line;
  }
  if (!header || rows.length === 0) return [];
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) return [];
  // PDF text keeps runs of spaces only sometimes; a header is used only when it splits into exactly
  // one label per column, or when there is a single rate column (the rest of the line is its label).
  const split = header.split(/\s{2,}|\t/).map((c) => c.trim()).filter(Boolean);
  const columns = split.length === width ? split : width === 2 ? [header.slice(0, 4), header.slice(4).trim()] : null;
  if (!columns) return [];
  return [["Term", ...columns.slice(1)], ...rows];
}

export type PageVerdict = "rates" | "member_login" | "images_only" | "no_rate_table";

export function pageVerdict(html: string, tablesRead: number): PageVerdict {
  if (tablesRead > 0) return "rates";
  if (/<input[^>]+type\s*=\s*["']?password/i.test(html) || /member\s*(log\s*-?in|sign\s*-?in|portal)|members?\s+only|log\s*in\s+to\s+view|enter\s+your\s+(work\s+|business\s+)?e-?mail/i.test(htmlToText(html))) return "member_login";
  if (/<img[^>]+(?:src|alt)\s*=\s*["'][^"']*rate/i.test(html)) return "images_only";
  return "no_rate_table";
}

export interface FhlbPageRead {
  url: string;
  verdict: PageVerdict;
  postedDate: string | null;
  tables: RateTableRead[];
  /** Data files linked from the page that were followed (CSV/PDF rate sheets). */
  followed: string[];
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

function readTables(tables: Table[]): RateTableRead[] {
  return tables.map((t, i) => readRateTable(t, i)).filter((t): t is RateTableRead => t !== null);
}

/** Reads one fetched document (HTML, CSV or PDF) as rate tables plus its stated posted date. */
export async function readRateDocument(url: string, bytes: Uint8Array, contentType: string): Promise<{ text: string; tables: RateTableRead[]; html: string | null }> {
  const isPdf = /pdf/i.test(contentType) || /\.pdf($|\?)/i.test(url) || (bytes[0] === 0x25 && bytes[1] === 0x50);
  if (isPdf) {
    const text = await pdfText(bytes);
    return { text, tables: readTables([pdfRateTable(text)].filter((t) => t.length > 0)), html: null };
  }
  const body = strFromU8(bytes);
  if (/csv|text\/plain/i.test(contentType) || /\.csv($|\?)/i.test(url)) {
    return { text: body, tables: readTables([parseCsvTable(body)]), html: null };
  }
  return { text: htmlToText(body), tables: readTables(readHtmlTables(body)), html: body };
}

/**
 * Reads one bank's page: its own tables first, then up to two linked CSV/PDF rate sheets when
 * the page itself carries none. The posted date comes from the document the rates came from,
 * else from the page that linked it.
 */
export async function readFhlbPage(url: string, options: RegistryFetchOptions = {}): Promise<FhlbPageRead> {
  const response = await registryFetch(url, options);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const doc = await readRateDocument(url, bytes, response.headers.get("content-type") ?? "");
  const pageDate = postedDate(doc.text);
  if (doc.tables.length > 0 || !doc.html) {
    return { url, verdict: doc.tables.length > 0 ? "rates" : "no_rate_table", postedDate: pageDate, tables: doc.tables, followed: [] };
  }
  const followed: string[] = [];
  const links = findDataLinks(doc.html, url, /rate/i).filter((l) => l.kind === "csv" || l.kind === "pdf").slice(0, 2);
  for (const link of links) {
    followed.push(link.url);
    try {
      const r = await registryFetch(link.url, { timeoutMs: 90_000, ...options });
      const linked = await readRateDocument(link.url, new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") ?? "");
      if (linked.tables.length > 0) {
        return { url: link.url, verdict: "rates", postedDate: postedDate(linked.text) ?? pageDate, tables: linked.tables, followed };
      }
    } catch {
      // a broken link is reported through `followed` and the page verdict below
    }
  }
  return { url, verdict: pageVerdict(doc.html, 0), postedDate: pageDate, tables: [], followed };
}

export const FHLB_SERIES_PREFIX = "fhlb";

/**
 * Rate cells as nation rows: series fhlb_<bank>_<product>_<term>, period = posted date. A
 * product name that two tables share is kept apart by its table number rather than merged.
 */
export function fhlbRateRows(bank: FhlbBank, read: { url: string; postedDate: string; tables: RateTableRead[] }): AreaStat[] {
  const bankKey = bank.key.replace(/-/g, "_");
  const productTable = new Map<string, number>();
  const rows: AreaStat[] = [];
  for (const table of read.tables) {
    for (const c of table.cells) {
      const owner = productTable.get(c.product);
      if (owner === undefined) productTable.set(c.product, c.tableIndex);
      const product = owner === undefined || owner === c.tableIndex ? c.product : `${c.product}_t${c.tableIndex}`;
      rows.push({
        geo_type: "nation",
        geo_code: "US",
        geo_name: bank.name,
        state_code: null,
        period: read.postedDate,
        series_key: `${FHLB_SERIES_PREFIX}_${bankKey}_${product || "rate"}_${c.term}`,
        value: c.value,
        unit: c.unit,
        note: c.value === null ? (c.cell === "" ? "blank" : c.cell.slice(0, 40)) : null,
        raw: {
          fhlbank: bank.key,
          district: bank.district,
          product_label: c.productLabel,
          term_label: c.termLabel,
          cell: c.cell,
          table_index: c.tableIndex,
          orientation: table.orientation,
          page_url: read.url,
        },
      });
    }
  }
  return rows;
}

export const FHLB_SKIP_REASONS: Record<Exclude<PageVerdict, "rates">, string> = {
  member_login: "no public rate table; the page sends visitors to a member login or an email sign-up (rates appear to be members-only)",
  images_only: "no rate table; the page shows rate images only, nothing machine-readable",
  no_rate_table: "no rate table found on the public page or its linked CSV/PDF rate sheets",
};

export interface FhlbFetch extends AreaFetch {
  bank: string;
  verdict: PageVerdict | "unreachable";
  tried: Array<{ url: string; status: string }>;
  unreadTerms: string[];
}

/** One bank: try the configured address, then the remembered ones; first page with rates wins. */
export async function fetchFhlbAdvanceRates(bank: FhlbBank, options: RegistryFetchOptions = {}, env: Record<string, string | undefined> = process.env): Promise<FhlbFetch> {
  const override = env[fhlbUrlEnv(bank)]?.trim();
  const urls = [...(override ? [override] : []), ...bank.pages];
  const tried: FhlbFetch["tried"] = [];
  let best: FhlbPageRead | null = null;
  for (const url of urls) {
    try {
      const read = await readFhlbPage(url, options);
      tried.push({ url, status: read.verdict });
      if (read.verdict === "rates") {
        best = read;
        break;
      }
      // Keep the most telling verdict (login over images over nothing).
      const rank = { member_login: 3, images_only: 2, no_rate_table: 1, rates: 4 } as const;
      if (!best || rank[read.verdict] > rank[best.verdict]) best = read;
    } catch (error) {
      tried.push({ url, status: error instanceof RegistryHttpError && error.status ? `http_${error.status}` : `error: ${String(error).slice(0, 120)}` });
    }
  }
  const base = { bank: bank.key, tried, skipped: {}, missingFields: [] as string[] };
  if (!best) {
    return { ...base, url: null, rows: [], verdict: "unreachable", unreadTerms: [], emptyReason: `no candidate rate page answered (${tried.map((t) => t.status).join(", ")})` };
  }
  const unreadTerms = best.tables.flatMap((t) => t.unreadTerms);
  if (best.verdict !== "rates") {
    return { ...base, url: best.url, rows: [], verdict: best.verdict, unreadTerms, emptyReason: FHLB_SKIP_REASONS[best.verdict] };
  }
  if (!best.postedDate) {
    return {
      ...base,
      url: best.url,
      rows: [],
      verdict: "rates",
      unreadTerms,
      missingFields: ["posted_date"],
      emptyReason: "rate table found but the page states no posted date; rates are not stored without one",
    };
  }
  const rows = fhlbRateRows(bank, { url: best.url, postedDate: best.postedDate, tables: best.tables });
  const skipped: Record<string, number> = {};
  if (unreadTerms.length > 0) skipped.unread_term_labels = unreadTerms.length;
  return { ...base, url: best.url, rows, verdict: "rates", unreadTerms, skipped, emptyReason: rows.length === 0 ? "rate table held no cells" : null };
}
