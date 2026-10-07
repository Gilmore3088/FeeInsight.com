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

/** Download one quarter's "Call Reports -- Single Period" tab-delimited bulk zip. */
export async function fetchFfiecCallBulk(q: Quarter, options: RegistryFetchOptions = {}): Promise<FfiecBulkDownload> {
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
  return { files: await unzipScheduleRi(download.body), fileName: name };
}

/** Schedule RI files only ("Schedule RI 06302026.txt", or "Schedule RI(1 of 2) ..."), not RIA, RIB... */
const SCHEDULE_RI = /Schedule RI\s*(\(\d of \d\))?\s*\d{8}\.txt$/i;

function cells(line: string): string[] {
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
  const files: Record<string, Uint8Array> = {};
  const pending: Array<Promise<void>> = [];
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (!SCHEDULE_RI.test(file.name)) return;
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
