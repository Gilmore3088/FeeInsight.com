import { createHash } from "node:crypto";
import { craDate, normalizeCraRating, type CraRating } from "./cra";
import { htmlToText } from "./fed";
import { registryFetch, registryFetchJson, type RegistryFetchOptions } from "./http";

/**
 * CRA ratings read from each regulator's own public list (#1805), because the FFIEC interagency
 * ratings file (apps.ffiec.gov/craratings) answers production and this container with a
 * Cloudflare challenge (HTTP 403, `cf-mitigated: challenge`). Pure: fetches and parses, never
 * writes. Both lists are US government works; cite the agency.
 *
 * - FDIC: CRAPES (crapes.fdic.gov), the FDIC's CRA performance evaluation search. Its page calls
 *   a JSON API (`/api/getSearchResults`, POST `{release: "YYYY-M-D:YYYY-M-D"}`, the public date
 *   window) that returns at most 500 rows per request, so a year is read month by month and a
 *   month that returns 500 rows is reported as possibly cut short. Rows carry the FDIC cert, the
 *   public date (not the exam date), the overall and component ratings, the exam method and the
 *   performance evaluation file (`/publish/<file>`). Checked live on 2026-11-02.
 * - Federal Reserve: CRAPubWeb (www.federalreserve.gov/apps/CRAPubWeb), state member banks. The
 *   result page lists one row per bank with RSSD id, overall rating, exam date, public date, exam
 *   method, assets ($ thousands) and a PE link, 30 rows a page; the search filters are not applied
 *   to these GET pages, so every page is read. Checked live on 2026-11-02 (64 pages).
 * - OCC: not read. www.occ.gov redirects to www.occ.treas.gov and the CRA search is on
 *   apps.occ.gov; neither host was reachable from the build container on 2026-11-02, so no URL or
 *   layout is confirmed.
 *
 * Nothing is filled in: an unreadable date, rating or amount stays null and is counted.
 */

export const CRAPES_BASE = "https://crapes.fdic.gov";
export const CRAPES_SEARCH_URL = `${CRAPES_BASE}/api/getSearchResults`;
/** The most rows CRAPES returns for one request (seen 2026-11-02: 2025 as one window gave exactly 500). */
export const CRAPES_ROW_CAP = 500;
/** First public year read from CRAPES. */
export const CRAPES_FIRST_YEAR = 2010;

export const FRB_CRA_BASE = "https://www.federalreserve.gov/apps/CRAPubWeb/CRA";
/** The result list with every filter at "All", as the page's own pager links it. */
export const FRB_CRA_RESULT_URL =
  `${FRB_CRA_BASE}/BankRatingResult?SearchClick=T&NameID=&CRARating=0&City=&County=&States=0&AssetSize=0&ExamYears=0` +
  "&PublicYears=0&ExamMethod=All&LendingL=0&Investment=0&Service=0&LendingS=0&Community=0";
/** Stop walking pages here even if the pager says more (64 pages on 2026-11-02). */
export const FRB_CRA_MAX_PAGES = 200;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

function amount(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  return value.replace(/[$,\s.\d-]/g, "") === "" && Number.isFinite(n) ? n : null;
}

/** Key for an agency-list rating: the agency, its institution id and the dated event it lists. */
export function agencyRatingKey(regulator: "FDIC" | "FRB", id: string | null, name: string | null, dateKind: string, dateRaw: string | null): string {
  return createHash("sha1")
    .update(["agency-list", regulator, id ?? "", id ? "" : name ?? "", dateKind, dateRaw ?? ""].join("|"))
    .digest("hex");
}

// ---------------------------------------------------------------------------------------------
// FDIC CRAPES
// ---------------------------------------------------------------------------------------------

export interface CrapesRow {
  ORG_CERT_NUM?: number | string | null;
  EXM_CRA_PUB_DTE?: string | null;
  INST_FIN_LGL_NME?: string | null;
  LOCN_PHY_CTY_NME?: string | null;
  LOCN_ST_ABBV_NME?: string | null;
  EXM_INST_ASET_AMT?: string | null;
  EXM_RTG_FULL_DESC?: string | null;
  EXM_ACT_PROC_DESC?: string | null;
  SYS_EXTRN_FILE_ID?: string | null;
  [field: string]: unknown;
}

/** The fields a CRAPES row must carry to be read; a row without them is counted, not guessed. */
export const CRAPES_REQUIRED_FIELDS = ["ORG_CERT_NUM", "EXM_CRA_PUB_DTE", "EXM_RTG_FULL_DESC"] as const;

/** One CRAPES row as a cra_ratings record. The exam date is not in the list: it stays null. */
export function crapesRating(row: CrapesRow): CraRating {
  const cert = text(row.ORG_CERT_NUM)?.replace(/^0+(?=\d)/, "") ?? null;
  const certId = cert && /^\d+$/.test(cert) ? cert : null;
  const name = text(row.INST_FIN_LGL_NME);
  const publicRaw = text(row.EXM_CRA_PUB_DTE);
  const ratingRaw = text(row.EXM_RTG_FULL_DESC);
  const file = text(row.SYS_EXTRN_FILE_ID);
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) raw[k] = String(v);
  raw.public_date = craDate(publicRaw) ?? "";
  return {
    ratingKey: agencyRatingKey("FDIC", certId, name, "public", publicRaw),
    rssd: null,
    fdicCert: certId,
    agencyId: certId,
    regulatorRaw: "FDIC",
    regulator: "FDIC",
    name,
    city: text(row.LOCN_PHY_CTY_NME),
    state: text(row.LOCN_ST_ABBV_NME),
    examDate: null,
    examDateRaw: null,
    ratingRaw,
    ratingCode: normalizeCraRating(ratingRaw),
    examMethod: text(row.EXM_ACT_PROC_DESC),
    // CRAPES prints dollars in thousands with cents ("$28,021,961.00" for Ameris Bank, about $28B).
    assetSize: amount(text(row.EXM_INST_ASET_AMT)),
    evaluationUrl: file ? `${CRAPES_BASE}/publish/${file.split("/").map(encodeURIComponent).join("/")}` : null,
    raw,
  };
}

/** The public-date window CRAPES takes for one calendar month ("2026-10-1:2026-10-31"). */
export function crapesMonthWindow(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${month}-1:${year}-${month}-${last}`;
}

export interface CrapesYear {
  url: string;
  year: number;
  ratings: CraRating[];
  /** Months whose response hit the row cap, so may be cut short. */
  cappedMonths: string[];
  /** Rows missing a required field, by field. */
  missingFields: Record<string, number>;
  /** Fields seen that this reader does not map (kept in raw_json). */
  unexpectedFields: string[];
  monthsRead: number;
}

const CRAPES_KNOWN_FIELDS = new Set([
  "ORG_CERT_NUM", "EXM_CRA_PUB_DTE", "INST_FIN_LGL_NME", "LOCN_PHY_CTY_NME", "LOCN_ST_ABBV_NME", "INST_FIN_ACTV_FLG",
  "EXM_INST_ASET_AMT", "EXM_RTG_FULL_DESC", "EXM_ACT_PROC_DESC", "SYS_EXTRN_FILE_ID", "SYS_EXTRN_INET_ADDR",
  "LOCN_PHY_POST_CDE", "LOCN_PHY_LNE1_TXT", "RATING_POINTS", "LENDING_RATING", "INVEST_RATING", "SERVICE_RATING", "row_num",
]);

/** Reads one public year from CRAPES, month by month (months after `now` are skipped). */
export async function fetchCrapesYear(year: number, options: RegistryFetchOptions = {}, now: Date = new Date()): Promise<CrapesYear> {
  const ratings: CraRating[] = [];
  const cappedMonths: string[] = [];
  const missingFields: Record<string, number> = {};
  const unexpected = new Set<string>();
  let monthsRead = 0;
  for (let month = 1; month <= 12; month += 1) {
    if (Date.UTC(year, month - 1, 1) > now.getTime()) break;
    const release = crapesMonthWindow(year, month);
    const body = await registryFetchJson<{ status?: string; data?: CrapesRow[]; error?: string }>(CRAPES_SEARCH_URL, options, { json: { release } });
    if (body.status !== "success" || !Array.isArray(body.data)) {
      throw new Error(`CRAPES answered ${release} with ${body.status ?? "no status"}${body.error ? `: ${body.error}` : ""}`);
    }
    monthsRead += 1;
    if (body.data.length >= CRAPES_ROW_CAP) cappedMonths.push(release);
    for (const row of body.data) {
      for (const k of Object.keys(row)) if (!CRAPES_KNOWN_FIELDS.has(k)) unexpected.add(k);
      const missing = CRAPES_REQUIRED_FIELDS.filter((f) => text(row[f]) === null);
      for (const f of missing) missingFields[f] = (missingFields[f] ?? 0) + 1;
      if (missing.length > 0) continue;
      ratings.push(crapesRating(row));
    }
  }
  return { url: CRAPES_SEARCH_URL, year, ratings, cappedMonths, missingFields, unexpectedFields: [...unexpected].sort(), monthsRead };
}

// ---------------------------------------------------------------------------------------------
// Federal Reserve CRAPubWeb
// ---------------------------------------------------------------------------------------------

/** "Feb 05, 2018" -> "2018-02-05"; anything else -> null. */
export function frbCraDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]) + 1;
  if (month === 0) return null;
  return craDate(`${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
}

export interface FrbCraPage {
  ratings: CraRating[];
  /** Data rows whose cells could not all be found. */
  unreadableRows: number;
  /** The last page number the pager links, when it has one. */
  lastPage: number | null;
}

function cell(row: string, cls: string): string | null {
  const m = new RegExp(`<td[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</td>`, "i").exec(row);
  return m ? m[1] : null;
}

/** Parses one CRAPubWeb result page. */
export function parseFrbCraPage(html: string, pageUrl: string): FrbCraPage {
  const ratings: CraRating[] = [];
  let unreadableRows = 0;
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = m[1];
    if (!/class="bankDetail"/i.test(row)) continue;
    const id = /class="bankDetail"[^>]*id="(\d+)\|(\d{8})"/i.exec(row);
    const label = /class="bankDetail"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    const firstCell = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(row)?.[1] ?? "";
    const location = text(htmlToText(firstCell.split(/<br\s*\/?>/i)[1] ?? ""));
    const ratingRaw = text(htmlToText(cell(row, "Rating") ?? ""));
    const examCell = cell(row, "ExamDate") ?? "";
    const examRaw = text(htmlToText(examCell.split(/<br\s*\/?>/i)[0] ?? ""));
    const publicRaw = text(htmlToText(cell(row, "PublicDate") ?? ""));
    const pe = /class="PE"[^>]*href="([^"]+)"/i.exec(examCell)?.[1] ?? null;
    if (!id || !label || !ratingRaw || !examRaw) {
      unreadableRows += 1;
      continue;
    }
    const rssd = id[1].replace(/^0+(?=\d)/, "");
    const name = text(htmlToText(label[1]).replace(/\s*-\s*\d+\s*$/, ""));
    const locationMatch = location ? /^(.*),\s*([A-Z]{2})$/.exec(location) : null;
    const methodRaw = text(htmlToText(cell(row, "Method") ?? ""));
    const assetsRaw = text(htmlToText(cell(row, "Assets") ?? ""));
    ratings.push({
      ratingKey: agencyRatingKey("FRB", rssd, name, "exam", id[2]),
      rssd,
      fdicCert: null,
      agencyId: rssd,
      regulatorRaw: "FRB",
      regulator: "FRB",
      name,
      city: locationMatch ? text(locationMatch[1]) : location,
      state: locationMatch ? locationMatch[2] : null,
      examDate: frbCraDate(examRaw),
      examDateRaw: examRaw,
      ratingRaw,
      ratingCode: normalizeCraRating(ratingRaw),
      examMethod: methodRaw,
      assetSize: amount(assetsRaw),
      evaluationUrl: pe ? new URL(pe.replace(/&amp;/g, "&"), `${FRB_CRA_BASE}/`).toString() : null,
      raw: {
        rssd,
        exam_key: id[2],
        name_cell: htmlToText(label[1]),
        location: location ?? "",
        rating: ratingRaw,
        exam_date: examRaw,
        public_date: publicRaw ?? "",
        public_date_iso: frbCraDate(publicRaw) ?? "",
        method: methodRaw ?? "",
        assets_thousands: assetsRaw ?? "",
        page_url: pageUrl,
      },
    });
  }
  const pages = [...html.matchAll(/[?&](?:amp;)?page=(\d+)/gi)].map((p) => Number(p[1]));
  return { ratings, unreadableRows, lastPage: pages.length > 0 ? Math.max(...pages) : null };
}

export interface FrbCraList {
  url: string;
  ratings: CraRating[];
  pagesRead: number;
  lastPage: number | null;
  unreadableRows: number;
}

/** Walks every CRAPubWeb result page. */
export async function fetchFrbCraRatings(options: RegistryFetchOptions = {}): Promise<FrbCraList> {
  const ratings: CraRating[] = [];
  let unreadableRows = 0;
  let lastPage: number | null = null;
  let page = 1;
  for (; page <= FRB_CRA_MAX_PAGES; page += 1) {
    const url = page === 1 ? FRB_CRA_RESULT_URL : `${FRB_CRA_RESULT_URL}&page=${page}`;
    const html = await (await registryFetch(url, options)).text();
    const parsed = parseFrbCraPage(html, url);
    if (page === 1 && parsed.ratings.length === 0) {
      const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "no title";
      throw new Error(`CRAPubWeb result page had no rating rows (page title: ${title})`);
    }
    ratings.push(...parsed.ratings);
    unreadableRows += parsed.unreadableRows;
    lastPage = Math.max(lastPage ?? 0, parsed.lastPage ?? 0) || null;
    if (parsed.ratings.length === 0 || lastPage === null || page >= lastPage) break;
  }
  return { url: FRB_CRA_RESULT_URL, ratings, pagesRead: Math.min(page, FRB_CRA_MAX_PAGES), lastPage, unreadableRows };
}
