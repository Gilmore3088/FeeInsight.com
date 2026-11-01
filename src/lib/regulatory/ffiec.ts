import { strFromU8, Unzip, UnzipInflate } from "fflate";
import { REGISTRY_USER_AGENT, RegistryHttpError, type RegistryFetchOptions } from "./http";
import type { Quarter } from "./quarters";
import { quarterEndDate } from "./quarters";

/**
 * FFIEC Central Data Repository bulk call reports. Pure transport and parsing: no DB access.
 *
 * The FDIC BankFind API does not carry the Schedule RI memoranda fee lines, so the one line
 * Hamilton needs from them comes from the FFIEC "Call Reports -- Single Period" bulk file:
 * RIAD H032, consumer overdraft-related service charges (overdraft and NSF together), filed by
 * banks with $1 billion or more in assets since 2015. Values are year to date, in thousands.
 *
 * The bulk page is an ASP.NET form: GET it, then post back the product, the period, the
 * tab-delimited format and the Download button, carrying __VIEWSTATE and the session cookie.
 */

export const FFIEC_BULK_URL = "https://cdr.ffiec.gov/public/pws/downloadbulkdata.aspx";
const PRODUCT = "ReportingSeriesSinglePeriod";
const FORMAT = "TSVRadioButton";
const FIELD = "ctl00$MainContentHolder$";

export const FFIEC_OVERDRAFT_FIELD = "RIADH032";

interface FormState {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string | null;
  cookies: Map<string, string>;
}

function hidden(html: string, name: string): string | null {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

function decodeHtml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

export function readFormState(html: string, cookies: Map<string, string>): FormState {
  const viewState = hidden(html, "__VIEWSTATE");
  const viewStateGenerator = hidden(html, "__VIEWSTATEGENERATOR");
  if (viewState === null || viewStateGenerator === null) {
    throw new RegistryHttpError("FFIEC bulk page has no __VIEWSTATE; the page layout may have changed", FFIEC_BULK_URL, null);
  }
  const eventValidation = hidden(html, "__EVENTVALIDATION");
  return {
    viewState: decodeHtml(viewState),
    viewStateGenerator: decodeHtml(viewStateGenerator),
    eventValidation: eventValidation === null ? null : decodeHtml(eventValidation),
    cookies,
  };
}

/** Period dropdown option value for one quarter end; options read "06/30/2026". */
export function periodOptionValue(html: string, q: Quarter): string | null {
  const select = /<select[^>]*name="ctl00\$MainContentHolder\$DatesDropDownList"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!select) return null;
  const [year, month, day] = quarterEndDate(q).split("-");
  const label = `${month}/${day}/${year}`;
  for (const option of select[1].matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/g)) {
    if (option[2].trim() === label) return option[1];
  }
  return null;
}

/** What an FFIEC bulk page says and asks for, so a failed download can name it. */
export interface FfiecPageDescription {
  title: string | null;
  /** Visible message text: validation summaries, error or message labels, script alerts. */
  messages: string[];
  /**
   * Form fields: a bare name for hidden and typed-value inputs (text, email, number, search...; no values), "name[type=value]" for
   * radios, checkboxes and buttons, "name[select N options, label*]" for selects; "*" marks the
   * checked or selected one.
   */
  fields: string[];
}

const MAX_PAGE_MESSAGES = 6;
const MAX_PAGE_FIELDS = 40;

function pageText(fragment: string): string {
  return decodeHtml(fragment.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/**
 * Title, visible messages and form fields of an FFIEC bulk page. Hidden ASP.NET state fields are
 * named without their values. Pure; used when a download step answers with HTML instead of a file.
 */
export function describeFfiecPage(html: string): FfiecPageDescription {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? pageText(titleMatch[1]) || null : null;

  const messages: string[] = [];
  const pushMessage = (text: string) => {
    const clean = text.slice(0, 240);
    if (clean && !messages.includes(clean) && messages.length < MAX_PAGE_MESSAGES) messages.push(clean);
  };
  for (const m of html.matchAll(/<(span|div|p|td|li|label|font)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const marker = `${attr(m[2], "id") ?? ""} ${attr(m[2], "class") ?? ""}`;
    if (!/error|message|msg|warn|valid|alert|notice|status/i.test(marker)) continue;
    pushMessage(pageText(m[3]));
  }
  for (const m of html.matchAll(/alert\(\s*(['"])([\s\S]*?)\1\s*\)/g)) pushMessage(pageText(m[2]));

  const fields: string[] = [];
  const addField = (field: string) => {
    if (!fields.includes(field) && fields.length < MAX_PAGE_FIELDS) fields.push(field);
  };
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(m[0], "name");
    if (!name) continue;
    const type = (attr(m[0], "type") ?? "text").toLowerCase();
    if (["hidden", "text", "password", "email", "number", "search", "tel", "url"].includes(type)) addField(name);
    else addField(`${name}[${type}=${attr(m[0], "value") ?? ""}${/\schecked\b/i.test(m[0]) ? "*" : ""}]`);
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attr(m[1], "name");
    if (!name) continue;
    const selected = /<option\b[^>]*\sselected\b[^>]*>([^<]*)/i.exec(m[2]);
    const count = [...m[2].matchAll(/<option\b/gi)].length;
    addField(`${name}[select ${count} options${selected ? `, ${pageText(selected[1])}*` : ""}]`);
  }
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const name = attr(m[1], "name");
    if (name) addField(`${name}[button=${pageText(m[2])}]`);
  }
  return { title, messages, fields };
}

/** One line for an error message: `title "..."; messages: ...; fields: ...`. */
export function formatFfiecPage(page: FfiecPageDescription): string {
  return [
    `title ${page.title ? `"${page.title}"` : "none"}`,
    `messages: ${page.messages.length > 0 ? page.messages.map((m) => `"${m}"`).join(" | ") : "none"}`,
    `fields: ${page.fields.join(", ") || "none"}`,
  ].join("; ");
}

/** Name of the page's submit control labelled "Download", when there is one. */
export function downloadButtonName(html: string): string | null {
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const type = (attr(m[0], "type") ?? "").toLowerCase();
    if ((type === "submit" || type === "image" || type === "button") && /^\s*download\s*$/i.test(attr(m[0], "value") ?? "")) {
      return attr(m[0], "name");
    }
  }
  return null;
}

function absorbCookies(response: Response, cookies: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
  for (const line of list) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(
  options: RegistryFetchOptions,
  cookies: Map<string, string>,
  form?: Record<string, string>,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(FFIEC_BULK_URL, {
    method: form ? "POST" : "GET",
    headers: {
      "User-Agent": REGISTRY_USER_AGENT,
      Accept: "text/html,application/octet-stream,*/*",
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded", Referer: FFIEC_BULK_URL, Origin: "https://cdr.ffiec.gov" } : {}),
      ...(cookies.size > 0 ? { Cookie: cookieHeader(cookies) } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    redirect: "follow",
  });
  absorbCookies(response, cookies);
  if (!response.ok) throw new RegistryHttpError(`HTTP ${response.status} from ${FFIEC_BULK_URL}`, FFIEC_BULK_URL, response.status);
  return response;
}

function postBack(state: FormState, target: string, extra: Record<string, string>): Record<string, string> {
  return {
    __EVENTTARGET: target,
    __EVENTARGUMENT: "",
    __VIEWSTATE: state.viewState,
    __VIEWSTATEGENERATOR: state.viewStateGenerator,
    ...(state.eventValidation !== null ? { __EVENTVALIDATION: state.eventValidation } : {}),
    ...extra,
  };
}

export interface FfiecBulkDownload {
  /** Schedule RI text files from the bulk zip; null when FFIEC does not list this quarter yet. */
  files: Record<string, Uint8Array> | null;
  fileName: string | null;
}

/**
 * Download one quarter's "Call Reports -- Single Period" tab-delimited bulk zip, keeping the
 * schedule files whose names match `schedules` (Schedule RI alone by default).
 */
export async function fetchFfiecCallBulk(
  q: Quarter,
  options: RegistryFetchOptions = {},
  schedules: RegExp = SCHEDULE_RI,
): Promise<FfiecBulkDownload> {
  const cookies = new Map<string, string>();
  const first = await request(options, cookies);
  let state = readFormState(await first.text(), cookies);

  const product = await request(options, cookies, postBack(state, `${FIELD}ListBox1`, { [`${FIELD}ListBox1`]: PRODUCT }));
  const productHtml = await product.text();
  state = readFormState(productHtml, cookies);
  const period = periodOptionValue(productHtml, q);
  if (period === null) return { files: null, fileName: null };

  const base = { [`${FIELD}ListBox1`]: PRODUCT, [`${FIELD}DatesDropDownList`]: period };
  const periodPage = await request(options, cookies, postBack(state, `${FIELD}DatesDropDownList`, base));
  state = readFormState(await periodPage.text(), cookies);
  const formatPage = await request(options, cookies, postBack(state, `${FIELD}${FORMAT}`, { ...base, [`${FIELD}FormatType`]: FORMAT }));
  state = readFormState(await formatPage.text(), cookies);

  const download = await request(options, cookies, {
    ...postBack(state, "", { ...base, [`${FIELD}FormatType`]: FORMAT }),
    [`${FIELD}TabStrip1$Download_0`]: "Download",
  });
  const type = download.headers.get("content-type") ?? "";
  const disposition = download.headers.get("content-disposition") ?? "";
  if (!/octet-stream|zip/i.test(type) && !/attachment/i.test(disposition)) {
    throw new RegistryHttpError(`FFIEC returned ${type || "no content type"} instead of the bulk zip`, FFIEC_BULK_URL, download.status);
  }
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
  if (!download.body) throw new RegistryHttpError("FFIEC sent an empty bulk download", FFIEC_BULK_URL, download.status);
  return { files: await unzipSchedules(download.body, schedules), fileName: name };
}

/** Schedule RI files only ("Schedule RI 06302026.txt", or "Schedule RI(1 of 2) ..."), not RIA, RIB... */
const SCHEDULE_RI = /Schedule RI\s*(\(\d of \d\))?\s*\d{8}\.txt$/i;

/**
 * Bulk-zip file names for the given schedule codes, e.g. ["RI", "RIBI", "RCN"]. Wide schedules
 * come in parts, and the part marker follows the date ("Schedule RCO 03312026(1 of 2).txt").
 */
export function schedulePattern(codes: readonly string[]): RegExp {
  return new RegExp(`Schedule (${codes.join("|")})\\s*(\\(\\d of \\d\\))?\\s*\\d{8}\\s*(\\(\\d of \\d\\))?\\.txt$`, "i");
}

export function cells(line: string): string[] {
  return line.split("\t").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
}

export interface FfiecOverdraftRow {
  rssd: string;
  /** Year to date, thousands of dollars. */
  ytdThousands: number;
}

export interface FfiecOverdraftFile {
  /** Schedule RI files in the zip, and whether any carried the H032 column. */
  files: string[];
  hasColumn: boolean;
  rows: FfiecOverdraftRow[];
}

const UNZIP_CHUNK = 1 << 20;
const MAX_SCHEDULE_BYTES = 256 * 1024 * 1024;

/**
 * Pull only the Schedule RI files out of the all-schedules bulk zip, reading it as a stream.
 * The whole zip is never held in memory, and output buffers grow with the inflated data rather
 * than being sized from the zip headers. Buffering the zip and unzipping it in one call failed on
 * prod with "Array buffer allocation failed" (Oct 2026).
 */
export async function unzipScheduleRi(source: Uint8Array | ReadableStream<Uint8Array>): Promise<Record<string, Uint8Array>> {
  return unzipSchedules(source, SCHEDULE_RI);
}

/** Same streaming read as unzipScheduleRi, for any set of schedule files. */
export async function unzipSchedules(
  source: Uint8Array | ReadableStream<Uint8Array>,
  pattern: RegExp,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const pending: Array<Promise<void>> = [];
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (!pattern.test(file.name)) return;
    const parts: Uint8Array[] = [];
    let size = 0;
    pending.push(
      new Promise<void>((resolve) => {
        file.ondata = (error, data, final) => {
          if (error) {
            failure ??= error;
            return resolve();
          }
          size += data.length;
          if (size > MAX_SCHEDULE_BYTES) {
            failure ??= new Error(`${file.name} is larger than ${MAX_SCHEDULE_BYTES} bytes`);
            file.terminate();
            return resolve();
          }
          parts.push(data);
          if (final) {
            const out = new Uint8Array(size);
            let at = 0;
            for (const part of parts) {
              out.set(part, at);
              at += part.length;
            }
            files[file.name] = out;
            resolve();
          }
        };
      }),
    );
    file.start();
  });
  unzip.register(UnzipInflate);

  if (source instanceof Uint8Array) {
    for (let at = 0; at < source.length; at += UNZIP_CHUNK) unzip.push(source.subarray(at, at + UNZIP_CHUNK), false);
  } else {
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) unzip.push(value, false);
      if (failure) {
        await reader.cancel();
        break;
      }
    }
  }
  unzip.push(new Uint8Array(0), true);
  await Promise.all(pending);
  if (failure) throw failure;
  return files;
}

/** RIAD H032 for every bank that filed a value; blank cells are left out, never read as zero. */
export function readScheduleRiOverdraft(files: Record<string, Uint8Array>): FfiecOverdraftFile {
  const rows = new Map<string, number>();
  let hasColumn = false;
  const names = Object.keys(files).sort();
  for (const name of names) {
    const lines = strFromU8(files[name], true).split(/\r?\n/);
    const header = cells(lines[0] ?? "").map((h) => h.toUpperCase());
    const rssdAt = header.indexOf("IDRSSD");
    const valueAt = header.indexOf(FFIEC_OVERDRAFT_FIELD);
    if (rssdAt < 0 || valueAt < 0) continue;
    hasColumn = true;
    for (const line of lines.slice(1)) {
      const row = cells(line);
      const rssd = row[rssdAt];
      const raw = row[valueAt];
      if (!rssd || !/^\d+$/.test(rssd) || raw === undefined || raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value)) rows.set(rssd, value);
    }
  }
  return { files: names, hasColumn, rows: [...rows].map(([rssd, ytdThousands]) => ({ rssd, ytdThousands })) };
}

/** Read H032 straight from a whole bulk zip (tests and small files). */
export async function readFfiecOverdraft(zip: Uint8Array): Promise<FfiecOverdraftFile> {
  return readScheduleRiOverdraft(await unzipScheduleRi(zip));
}

/**
 * The bulk zip's panel-of-reporters file ("FFIEC CDR Call Bulk POR 06302026.txt"): one row per
 * bank (IDRSSD) with its name, filing type and "Last Date/Time Submission Updated On", the last
 * time the bank's call report for that quarter was submitted or amended at the CDR. It is the only
 * place the bulk file says which version of a report it carries (#1925).
 */
export const FFIEC_POR_FILE = /Call Bulk POR\s*\d{8}\.txt$/i;
/** The POR column, matched loosely: FFIEC has written it with and without the slash and "On". */
const POR_LAST_UPDATED = /^LAST\s+DATE\s*\/?\s*TIME\s+SUBMISSION\s+UPDATED/i;
/**
 * The POR file's "FDIC Certificate Number" column, matched loosely ("FDIC Cert Number", "FDIC
 * Certificate No."). It says which FDIC certificate filed as that IDRSSD in that quarter, which is
 * how a bank that merged into a different charter keeps its own history (#2625).
 */
const POR_FDIC_CERT = /^FDIC\s+CERT(?:IFICATE)?\.?\s*(?:NUMBER|NUM|NO\.?|#)?$/i;

export interface FfiecPorRow {
  rssd: string;
  /** The cell as filed, e.g. "2026-08-14T10:02:31". */
  lastUpdated: string;
  /** Seconds since 1970-01-01 UTC, the filed clock time read as US Eastern (the CDR's clock). */
  epochSeconds: number;
}

export interface FfiecPorRead {
  file: string | null;
  /** The column header as filed, or null when the file or column is missing. */
  column: string | null;
  rows: FfiecPorRow[];
  /** Non-blank cells that could not be read as a date and time. */
  unreadable: number;
  /** The FDIC certificate column header as filed, or null when the file or column is missing (#2625). */
  certColumn: string | null;
  /** Banks with an FDIC certificate in that column; a blank or 0 (no FDIC certificate) is left out. */
  certs: FfiecPorCertRow[];
  /** Non-blank certificate cells that are not a whole number: refused, never guessed. */
  certUnreadable: number;
}

export interface FfiecPorCertRow {
  rssd: string;
  /** The FDIC certificate the bank filed that quarter's report under, without leading zeros. */
  cert: string;
}

export const NO_FFIEC_POR: FfiecPorRead = { file: null, column: null, rows: [], unreadable: 0, certColumn: null, certs: [], certUnreadable: 0 };

/** Offset of US Eastern from UTC, in ms, at a UTC instant (-4h in summer, -5h in winter). */
function easternOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/**
 * A POR timestamp as epoch seconds: ISO ("2026-08-14T10:02:31", "2026-08-14 10:02") or US
 * ("8/14/2026 10:02:31 AM"). A stated zone ("Z", "+00:00") is honoured; a bare clock time is read
 * as US Eastern. Null when the cell is not a date and time.
 */
export function parsePorTimestamp(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  let y: number, mo: number, d: number, h: number, mi: number, s: number;
  let zone: string | undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(text);
  if (iso) {
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    [h, mi, s] = [Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0)];
    zone = iso[7];
  } else if (us) {
    [mo, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    [h, mi, s] = [Number(us[4] ?? 0), Number(us[5] ?? 0), Number(us[6] ?? 0)];
    const meridiem = us[7]?.toUpperCase();
    if (meridiem && (h < 1 || h > 12)) return null;
    if (meridiem === "PM" && h < 12) h += 12;
    if (meridiem === "AM" && h === 12) h = 0;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(wall).getUTCDate() !== d) return null;
  let utc: number;
  if (zone && zone.toUpperCase() !== "Z") {
    const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
    utc = wall - (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000;
  } else if (zone) {
    utc = wall;
  } else {
    // Two passes settle the offset across a daylight-saving change.
    utc = wall - easternOffsetMs(wall);
    utc = wall - easternOffsetMs(utc);
  }
  return Math.floor(utc / 1000);
}

/**
 * The POR file's last-updated time and FDIC certificate per bank. Blank cells are left out;
 * unreadable ones are counted, never guessed. Each column is read on its own, so a file missing
 * one still gives the other.
 */
export function readFfiecPor(files: Record<string, Uint8Array>): FfiecPorRead {
  const name = Object.keys(files).sort().find((n) => FFIEC_POR_FILE.test(n)) ?? null;
  if (!name) return { ...NO_FFIEC_POR };
  const lines = strFromU8(files[name], true).split(/\r?\n/);
  const header = cells(lines[0] ?? "");
  const rssdAt = header.findIndex((h) => h.toUpperCase() === "IDRSSD");
  if (rssdAt < 0) return { ...NO_FFIEC_POR, file: name };
  const at = header.findIndex((h) => POR_LAST_UPDATED.test(h));
  const certAt = header.findIndex((h) => POR_FDIC_CERT.test(h));
  const rows = new Map<string, FfiecPorRow>();
  const certs = new Map<string, FfiecPorCertRow>();
  let unreadable = 0;
  let certUnreadable = 0;
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const rssd = row[rssdAt];
    // A second header row (descriptions), if FFIEC ever adds one, has no numeric IDRSSD.
    if (!rssd || !/^\d+$/.test(rssd)) continue;
    const raw = at >= 0 ? (row[at] ?? "") : "";
    if (raw !== "") {
      const epochSeconds = parsePorTimestamp(raw);
      if (epochSeconds === null) unreadable += 1;
      else rows.set(rssd, { rssd, lastUpdated: raw, epochSeconds });
    }
    const certRaw = certAt >= 0 ? (row[certAt] ?? "") : "";
    if (certRaw !== "") {
      if (!/^\d+$/.test(certRaw)) certUnreadable += 1;
      else if (Number(certRaw) > 0) certs.set(rssd, { rssd, cert: String(Number(certRaw)) });
    }
  }
  return {
    file: name,
    column: at >= 0 ? header[at] : null,
    rows: [...rows.values()],
    unreadable,
    certColumn: certAt >= 0 ? header[certAt] : null,
    certs: [...certs.values()],
    certUnreadable,
  };
}
