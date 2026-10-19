import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import { STATE_NAMES, US_STATES_ONLY } from "@/lib/us-states";
import { BLS_SERIES_TITLES, BLS_YEARS, CPI_BANK_SERVICES_SERIES, CPI_FINANCIAL_SERVICES_SERIES, type IndicatorObservation } from "./fed";
import { FRB_XML_PACKAGES, periodStartDate, scaleSdmxValue, type SdmxSeries } from "./fed-board-data";

/**
 * The economic indicators in fed_economic_indicators, each read from its original publisher
 * (DECISIONS.md "No non-commercial data": FRED replaced by the original publishers, James,
 * 2026-10-18). Our series_id stays the id readers already use (UNRATE, FEDFUNDS, {ST}UR, ...); the
 * publisher's own id is beside it. Pure: definitions, request builders and parsers, no DB.
 *
 * - BLS public data API (api.bls.gov, keyless v1 or v2 with BLS_API_KEY): CPI, the national
 *   unemployment rate and payrolls, and each state's unemployment rate (LAUS) and payroll jobs
 *   (CES state and area). BLS: "everything that we publish ... is in the public domain" (bls.gov
 *   /opub/copyright-information.htm, read 2026-10-18); cite BLS.
 * - BEA NIPA tables through the BEA API (apps.bea.gov/api/data, BEA_API_KEY, as the CAINC1 loader
 *   uses): real GDP, the GDP price index and the personal saving rate.
 * - Federal Reserve Board H.15 release package: the effective federal funds rate, monthly.
 *
 * The publisher hosts could not be reached from the container this was written in. BLS and BEA
 * request and reply shapes follow the code already in production for them (fed.ts, economy.ts);
 * the series ids, table names and line labels are unconfirmed until the first run, and a series a
 * publisher does not return is reported by name, never substituted.
 */

export type IndicatorPublisher = "bls" | "bea" | "frb";

export interface PublisherIndicator {
  /** Our series_id (stable: readers, charts and the data catalog use it). */
  series_id: string;
  series_title: string;
  units: string;
  frequency: "Monthly" | "Quarterly";
  fed_district: number | null;
  publisher: IndicatorPublisher;
  /** The publisher's own id for the series. */
  publisher_id: string;
  /** BEA: the NIPA table, its frequency code, the line (matched on LineDescription) and the unit to scale to. */
  bea?: { table: string; frequency: "Q" | "M"; line: RegExp; scaleTo: number };
  /** Federal Reserve Board: the release package that carries the series. */
  frb?: { pkg: keyof typeof FRB_XML_PACKAGES; frequency: "monthly" | "quarterly" };
}

/** The page a reader cites for a series, at its original publisher. */
export function publisherSeriesUrl(series: Pick<PublisherIndicator, "publisher" | "publisher_id" | "bea">): string {
  if (series.publisher === "bls") return `https://data.bls.gov/timeseries/${series.publisher_id}`;
  if (series.publisher === "bea") return "https://apps.bea.gov/iTable/?reqid=19&step=2&isuri=1&categories=survey";
  return "https://www.federalreserve.gov/releases/h15/";
}

const bls = (series_id: string, publisher_id: string, series_title: string, units: string, fed_district: number | null = null): PublisherIndicator => ({
  series_id,
  publisher_id,
  series_title,
  units,
  frequency: "Monthly",
  fed_district,
  publisher: "bls",
});

/** Unemployment rate ({ST}UR, LAUS, seasonally adjusted) and nonfarm payroll jobs ({ST}NA, CES state, seasonally adjusted) for the 50 states and DC. */
function stateLaborSeries(): PublisherIndicator[] {
  return Object.entries(STATE_NAMES)
    .filter(([code]) => (US_STATES_ONLY.has(code) || code === "DC") && STATE_TO_FIPS[code])
    .flatMap(([code, name]) => {
      const place = code === "DC" ? "the District of Columbia" : name;
      const fips = STATE_TO_FIPS[code];
      const district = STATE_TO_DISTRICT[code] ?? null;
      return [
        bls(`${code}UR`, `LASST${fips}0000000000003`, `Unemployment Rate in ${place}`, "Percent", district),
        bls(`${code}NA`, `SMS${fips}000000000000001`, `All Employees: Total Nonfarm in ${place}`, "Thousands of Persons", district),
      ];
    });
}

/** Every indicator registry-fred loads, with its publisher. */
export const PUBLISHER_INDICATORS: PublisherIndicator[] = [
  bls("UNRATE", "LNS14000000", "Unemployment Rate", "Percent"),
  bls("LNS14000000", "LNS14000000", "Unemployment Rate (BLS LNS14000000)", "Percent"),
  bls("CES0000000001", "CES0000000001", "All Employees, Total Nonfarm", "Thousands of Persons"),
  bls("CPIAUCSL", "CUSR0000SA0", "Consumer Price Index for All Urban Consumers: All Items (seasonally adjusted)", "Index 1982-1984=100"),
  ...Object.entries(BLS_SERIES_TITLES).map(([id, title]) => bls(id, id, title, "Index")),
  ...stateLaborSeries(),
  {
    series_id: "FEDFUNDS",
    publisher_id: "RIFSPFF_N.M",
    series_title: "Federal Funds Effective Rate",
    units: "Percent",
    frequency: "Monthly",
    fed_district: null,
    publisher: "frb",
    frb: { pkg: "h15", frequency: "monthly" },
  },
  {
    series_id: "GDPC1",
    publisher_id: "T10106 line 1",
    series_title: "Real Gross Domestic Product",
    units: "Billions of Chained 2017 Dollars",
    frequency: "Quarterly",
    fed_district: null,
    publisher: "bea",
    bea: { table: "T10106", frequency: "Q", line: /^Gross domestic product$/i, scaleTo: 1e9 },
  },
  {
    series_id: "GDPCTPI",
    publisher_id: "T10104 line 1",
    series_title: "Gross Domestic Product: Chain-type Price Index",
    units: "Index 2017=100",
    frequency: "Quarterly",
    fed_district: null,
    publisher: "bea",
    bea: { table: "T10104", frequency: "Q", line: /^Gross domestic product$/i, scaleTo: 1 },
  },
  {
    series_id: "PSAVERT",
    publisher_id: "T20600 personal saving rate",
    series_title: "Personal Saving Rate",
    units: "Percent",
    frequency: "Monthly",
    fed_district: null,
    publisher: "bea",
    bea: { table: "T20600", frequency: "M", line: /saving as a percentage of disposable personal income/i, scaleTo: 1 },
  },
];

/** Kept for readers and tests that name the bank-services CPI series. */
export const BANK_CPI_SERIES = [CPI_BANK_SERVICES_SERIES, CPI_FINANCIAL_SERVICES_SERIES] as const;

// ---------------------------------------------------------------------------
// BLS: many series per request
// ---------------------------------------------------------------------------

/** Series per BLS request: 25 for keyless v1, 50 with a v2 key (BLS's published limits). */
export function blsBatchSize(apiKey: string | null | undefined): number {
  return apiKey ? 50 : 25;
}

export interface BlsBatchRequest {
  url: string;
  json: { seriesid: string[]; startyear: string; endyear: string; registrationkey?: string; catalog?: boolean };
}

export function blsBatchRequest(seriesIds: string[], apiKey?: string | null, now = new Date()): BlsBatchRequest {
  const endYear = now.getUTCFullYear();
  return {
    url: apiKey ? "https://api.bls.gov/publicAPI/v2/timeseries/data/" : "https://api.bls.gov/publicAPI/v1/timeseries/data/",
    json: {
      seriesid: seriesIds,
      startyear: String(endYear - BLS_YEARS + 1),
      endyear: String(endYear),
      ...(apiKey ? { registrationkey: apiKey, catalog: true } : {}),
    },
  };
}

interface BlsBatchResponse {
  status?: string;
  message?: string[];
  Results?: {
    series?: Array<{ seriesID?: string; catalog?: { series_title?: string }; data?: Array<{ year?: string; period?: string; value?: string }> }>;
  };
}

export interface BlsBatchParse {
  bySeries: Map<string, IndicatorObservation[]>;
  catalogTitles: Record<string, string>;
  /** BLS's own messages ("No Data Available for Series ..."), kept for the run detail. */
  messages: string[];
}

/** Monthly observations per series id (M01-M12; annual averages M13 skipped; "-" blanks skipped). */
export function parseBlsBatch(body: unknown): BlsBatchParse {
  const response = body as BlsBatchResponse;
  const bySeries = new Map<string, IndicatorObservation[]>();
  const catalogTitles: Record<string, string> = {};
  const messages = Array.isArray(response?.message) ? response.message.map(String) : [];
  if (response?.status !== "REQUEST_SUCCEEDED") return { bySeries, catalogTitles, messages };
  for (const series of response.Results?.series ?? []) {
    const id = series.seriesID;
    if (!id) continue;
    const out: IndicatorObservation[] = [];
    for (const point of series.data ?? []) {
      const month = /^M(0[1-9]|1[0-2])$/.exec(point.period ?? "");
      const value = Number(point.value);
      if (!month || !/^\d{4}$/.test(point.year ?? "") || point.value === undefined || point.value.trim() === "" || !Number.isFinite(value)) continue;
      out.push({ observation_date: `${point.year}-${month[1]}-01`, value });
    }
    if (out.length > 0) bySeries.set(id, out.sort((a, b) => a.observation_date.localeCompare(b.observation_date)));
    const title = series.catalog?.series_title;
    if (typeof title === "string" && title.trim()) catalogTitles[id] = title.trim();
  }
  return { bySeries, catalogTitles, messages };
}

// ---------------------------------------------------------------------------
// BEA NIPA tables
// ---------------------------------------------------------------------------

export const BEA_NIPA_URL = "https://apps.bea.gov/api/data";
/** First year asked of BEA (report trends deflate from 2009). */
export const BEA_FIRST_YEAR = 2000;

export function beaNipaUrl(key: string, table: string, frequency: "Q" | "M", now = new Date(), firstYear = BEA_FIRST_YEAR): string {
  const years: string[] = [];
  for (let y = firstYear; y <= now.getUTCFullYear(); y += 1) years.push(String(y));
  const params = new URLSearchParams({
    UserID: key,
    method: "GetData",
    datasetname: "NIPA",
    TableName: table,
    Frequency: frequency,
    Year: years.join(","),
    ResultFormat: "json",
  });
  return `${BEA_NIPA_URL}?${params.toString()}`;
}

interface BeaNipaResponse {
  BEAAPI?: {
    Error?: { APIErrorDescription?: string };
    Results?: { Error?: { APIErrorDescription?: string }; Data?: Array<Record<string, unknown>> };
  };
}

/** "2026Q2" -> "2026-04-01"; "2026M08" or "2026M8" -> "2026-08-01"; null otherwise. */
export function beaPeriodDate(timePeriod: string): string | null {
  const q = /^(\d{4})Q([1-4])$/.exec(timePeriod.trim());
  if (q) return `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const m = /^(\d{4})M(\d{1,2})$/.exec(timePeriod.trim());
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
  return null;
}

export interface BeaLineParse {
  observations: IndicatorObservation[];
  /** Why nothing was read: BEA's error, or the line not in the table. */
  problem: string | null;
  /** The LineDescription matched, for the run detail. */
  line: string | null;
}

/**
 * One line of a NIPA table: the first LineDescription that matches, values scaled from BEA's
 * UNIT_MULT (a base-10 exponent: 6 is millions) to `scaleTo` (1e9 for billions).
 */
export function parseBeaNipaLine(body: unknown, line: RegExp, scaleTo: number): BeaLineParse {
  const api = (body as BeaNipaResponse)?.BEAAPI;
  const error = api?.Error?.APIErrorDescription ?? api?.Results?.Error?.APIErrorDescription;
  const data = api?.Results?.Data;
  if (!Array.isArray(data)) return { observations: [], problem: error ?? "BEA reply held no Data array", line: null };
  const first = data.find((d) => line.test(String(d.LineDescription ?? "").trim()));
  if (!first) return { observations: [], problem: `no line matching ${line}`, line: null };
  const lineNumber = String(first.LineNumber ?? "");
  const description = String(first.LineDescription ?? "").trim();
  const out: IndicatorObservation[] = [];
  for (const d of data) {
    if (String(d.LineNumber ?? "") !== lineNumber || String(d.LineDescription ?? "").trim() !== description) continue;
    const date = beaPeriodDate(String(d.TimePeriod ?? ""));
    const raw = Number(String(d.DataValue ?? "").replace(/,/g, ""));
    if (!date || !Number.isFinite(raw) || String(d.DataValue ?? "").trim() === "") continue;
    const exponent = Number(d.UNIT_MULT ?? 0);
    const value = (raw * 10 ** (Number.isFinite(exponent) ? exponent : 0)) / scaleTo;
    out.push({ observation_date: date, value: Number(value.toPrecision(12)) });
  }
  return { observations: out.sort((a, b) => a.observation_date.localeCompare(b.observation_date)), problem: out.length ? null : "line had no values", line: description };
}

/** FRB SDMX observations as fed_economic_indicators rows (period start dates; no-data points dropped). */
export function frbObservations(series: SdmxSeries | undefined, frequency: "monthly" | "quarterly", targetFactor = 1): IndicatorObservation[] {
  const out: IndicatorObservation[] = [];
  for (const o of series?.observations ?? []) {
    const date = periodStartDate(o.period, frequency);
    if (!date || o.value === null) continue;
    out.push({ observation_date: date, value: scaleSdmxValue(o.value, series?.multiplier ?? null, targetFactor) });
  }
  return out.sort((a, b) => a.observation_date.localeCompare(b.observation_date));
}
