import { strFromU8, unzipSync } from "fflate";
import { STATE_FROM_FIPS, stateCodeFromName, type AreaFetch, type AreaStat } from "./economy";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { parseCsvTable } from "./industry-events";
import { bump, fetchFirstAvailable, isZip, pageLinks, slug, valueWithFlag } from "./risk-costs";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * USDA farm economy by state: ERS Farm Income and Wealth Statistics (net farm income, net cash
 * farm income, cash receipts, farm debt) and NASS cash rents per acre by county, state and
 * nation from the Quick Stats API (free key in NASS_API_KEY). Pure transport and parsing: no DB
 * access.
 *
 * ers.usda.gov and quickstats.nass.usda.gov are blocked from the sandbox this was written in.
 * The ERS data-files page address, the CSV columns (Year, State, Amount and the variable
 * description) and the variable wording, and the Quick Stats field names, are from memory. The
 * ERS file is found from links on the data-files page (or USDA_FARM_INCOME_URL); its variables are
 * matched by description at run time and every match is reported. Quick Stats marks withheld
 * values "(D)" and too-small ones "(Z)"; those stay null with the mark in `note`.
 */

export const ERS_FARM_INCOME_PAGE =
  "https://www.ers.usda.gov/data-products/farm-income-and-wealth-statistics/data-files-u-s-and-state-level-farm-income-and-wealth-statistics";
export const USDA_FARM_INCOME_URL_ENV = "USDA_FARM_INCOME_URL";
export const NASS_KEY_ENV = "NASS_API_KEY";
export const NASS_API_URL = "https://quickstats.nass.usda.gov/api/api_GET/";

/**
 * ERS variables kept, matched on the normalised description (lower case, punctuation folded).
 * State values are published in thousands of dollars per the ERS documentation (unconfirmed
 * here: a Unit column, when the file carries one, overrides it).
 */
export const ERS_SERIES = [
  { key: "usda_farm_net_income", label: "Net farm income", match: /^net farm income$/ },
  { key: "usda_farm_net_income_cash", label: "Net cash farm income", match: /^net cash (farm )?income$/ },
  { key: "usda_farm_cash_receipts", label: "Cash receipts, all commodities", match: /^(total )?cash receipts( value)?( all commodities| from farming)?$/ },
  { key: "usda_farm_debt", label: "Farm debt, total", match: /^(total )?(farm )?(sector )?debts?( total)?$/ },
] as const;

export const ERS_COLUMNS = { year: ["year"], state: ["state", "statename", "state_name"], amount: ["amount", "value"], description: ["variabledescriptiontotal", "variabledescription", "variabledescriptionpart1"] } as const;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "");
export const normaliseDescription = (s: string) => s.toLowerCase().replace(/[,;:()]/g, " ").replace(/\s+/g, " ").trim();

const RELEASE_DATE = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\s+release/i;
const MONTH_NUMBER: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** "September 3, 2026 release" -> "2026-09-03"; null when the text names no release date. */
export function ersReleaseDate(text: string): string | null {
  const m = RELEASE_DATE.exec(text);
  if (!m) return null;
  return `${m[3]}-${String(MONTH_NUMBER[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * The ERS CSV (or zip holding it) links on the data-files page, likeliest first. The full U.S. and
 * state bundles are linked as "<Month D, YYYY> release" zips (their /media/<id>/ numbers are not in
 * date order), so the newest dated release comes first. The "Data Archive" zip is U.S. only and the
 * 1960-2003 files are history, so neither is used.
 */
export function ersFileLinks(html: string, pageUrl: string): string[] {
  const links = pageLinks(html, pageUrl)
    .filter((l) => /\.(zip|csv)(\?|$)/i.test(l.href))
    .filter((l) => !/archive|\b1960\s*-/i.test(l.text) && !/archive/i.test(l.href));
  const releases = links
    .map((l) => ({ href: l.href, date: ersReleaseDate(l.text) }))
    .filter((l): l is { href: string; date: string } => l.date !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((l) => l.href);
  const score = (href: string, text: string) => {
    const s = `${href} ${text}`.toLowerCase();
    return (/farmincome|farm income|wealthstatistics|wealth statistics/.test(s) ? 4 : 0) + (/\.zip/.test(href.toLowerCase()) ? 1 : 0) + (/state/.test(s) ? 1 : 0);
  };
  const named = links
    .map((l) => ({ href: l.href, score: score(l.href, l.text) }))
    .filter((l) => l.score >= 4)
    .sort((a, b) => b.score - a.score)
    .map((l) => l.href);
  return [...new Set([...releases, ...named])];
}

function stateOf(value: string): { geo_type: "nation" | "state"; code: string } | null {
  const v = value.trim();
  if (/^(us|u\.s\.|united states|us total)$/i.test(v)) return { geo_type: "nation", code: "US" };
  const code = stateCodeFromName(v);
  return code && STATE_NAMES[code] ? { geo_type: "state", code } : null;
}

export interface ErsParse extends AreaFetch {
  info: { matched: Record<string, string[]>; near_misses: string[]; unit_column: string | null };
}

/** Parses the ERS CSV for one year into state and nation rows. */
export function parseErsFarmIncome(csv: string, year: number, url: string | null): ErsParse {
  const table = parseCsvTable(csv);
  const headerAt = table.findIndex((r) => r.some((c) => squash(c) === "year") && r.some((c) => (ERS_COLUMNS.amount as readonly string[]).includes(squash(c))));
  const info: ErsParse["info"] = { matched: {}, near_misses: [], unit_column: null };
  if (headerAt < 0) return { url, rows: [], missingFields: ["Year/Amount header"], skipped: {}, emptyReason: "No Year/Amount header in the ERS farm income file", info };
  const header = table[headerAt].map(squash);
  const find = (names: readonly string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const col = { year: find(ERS_COLUMNS.year), state: find(ERS_COLUMNS.state), amount: find(ERS_COLUMNS.amount), description: find(ERS_COLUMNS.description) };
  const part2 = header.indexOf("variabledescriptionpart2");
  const unitCol = header.findIndex((h) => h === "unit" || h === "units" || h === "unitdesc");
  info.unit_column = unitCol >= 0 ? table[headerAt][unitCol] : null;
  const missingFields = Object.entries(col)
    .filter(([, i]) => i < 0)
    .map(([k]) => `ers:${k} (${ERS_COLUMNS[k as keyof typeof ERS_COLUMNS].join("/")})`);
  if (missingFields.length > 0) return { url, rows: [], missingFields, skipped: {}, emptyReason: `ERS farm income file lacks ${missingFields.join(", ")}`, info };
  const skipped: Record<string, number> = {};
  const near = new Set<string>();
  const rows: AreaStat[] = [];
  for (const r of table.slice(headerAt + 1)) {
    if (Number(r[col.year]) !== year) continue;
    const descRaw =
      header[col.description] === "variabledescriptionpart1" && part2 >= 0 ? [r[col.description], r[part2]].filter(Boolean).join(", ") : (r[col.description] ?? "");
    const desc = normaliseDescription(descRaw);
    const series = ERS_SERIES.find((s) => s.match.test(desc));
    if (!series) {
      if (/net farm income|cash receipts|debt/.test(desc) && near.size < 20) near.add(descRaw.slice(0, 100));
      continue;
    }
    const geo = stateOf(r[col.state] ?? "");
    if (!geo) {
      bump(skipped, "state_not_placed");
      continue;
    }
    const matched = (info.matched[series.key] ??= []);
    if (!matched.includes(descRaw)) matched.push(descRaw);
    const { value, flag } = valueWithFlag(r[col.amount]);
    const extra: Record<string, unknown> = {};
    header.forEach((h, i) => {
      if (![col.year, col.state, col.amount].includes(i)) extra[h] = r[i] ?? null;
    });
    rows.push({
      geo_type: geo.geo_type,
      geo_code: geo.code,
      geo_name: geo.geo_type === "nation" ? "United States" : STATE_NAMES[geo.code] ?? null,
      state_code: geo.geo_type === "state" ? geo.code : null,
      period: String(year),
      series_key: series.key,
      value,
      unit: unitCol >= 0 && r[unitCol] ? r[unitCol].trim().slice(0, 40) : "thousands_dollars",
      note: flag,
      raw: { description: descRaw, unit_basis: unitCol >= 0 ? "file unit column" : "ERS documentation (state values in $1,000)", ...extra },
    });
  }
  info.near_misses = [...near];
  const notMatched = ERS_SERIES.filter((s) => !info.matched[s.key]).map((s) => `ers:${s.label}`);
  return {
    url,
    rows,
    missingFields: notMatched,
    skipped,
    emptyReason: rows.length === 0 ? `No ERS farm income rows for ${year}` : null,
    info,
  };
}

export async function fetchErsFarmIncome(year: number, options: RegistryFetchOptions & { url?: string } = {}): Promise<ErsParse> {
  const info: ErsParse["info"] = { matched: {}, near_misses: [], unit_column: null };
  let candidates: string[] = options.url?.trim() ? [options.url.trim()] : [];
  if (candidates.length === 0) {
    const page = await fetchFirstAvailable([ERS_FARM_INCOME_PAGE], options);
    if (page.url === null) return { url: null, rows: [], missingFields: ["ers:data-files page"], skipped: {}, emptyReason: `ERS data-files page not found at ${ERS_FARM_INCOME_PAGE}`, info };
    candidates = ersFileLinks(await page.response.text(), ERS_FARM_INCOME_PAGE);
    if (candidates.length === 0) return { url: ERS_FARM_INCOME_PAGE, rows: [], missingFields: ["ers:farm income CSV link"], skipped: {}, emptyReason: "No farm income CSV or zip link on the ERS data-files page", info };
  }
  const found = await fetchFirstAvailable(candidates.slice(0, 3), { timeoutMs: 180_000, ...options });
  if (found.url === null) return { url: null, rows: [], missingFields: ["ers:farm income file"], skipped: {}, emptyReason: `ERS farm income file not found (tried ${candidates.slice(0, 3).join(", ")})`, info };
  const bytes = new Uint8Array(await found.response.arrayBuffer());
  let csv: string;
  if (isZip(bytes)) {
    const files = unzipSync(bytes, { filter: (f) => /\.csv$/i.test(f.name) });
    const [entry] = Object.entries(files).sort(([, a], [, b]) => b.length - a.length);
    if (!entry) return { url: found.url, rows: [], missingFields: ["ers:CSV in zip"], skipped: {}, emptyReason: "ERS farm income zip held no CSV", info };
    csv = strFromU8(entry[1], true);
  } else csv = strFromU8(bytes, true);
  return parseErsFarmIncome(csv, year, found.url);
}

// ---------------------------------------------------------------------------
// NASS Quick Stats cash rents
// ---------------------------------------------------------------------------

export const NASS_LEVELS = ["NATIONAL", "STATE", "COUNTY"] as const;
export const NASS_FIELDS = ["Value", "short_desc", "agg_level_desc", "state_alpha", "state_fips_code", "county_code", "year", "unit_desc", "reference_period_desc"] as const;

export function nassUrl(key: string, year: number, level: (typeof NASS_LEVELS)[number]): string {
  const params = new URLSearchParams({ key, source_desc: "SURVEY", commodity_desc: "RENT", year: String(year), agg_level_desc: level, format: "JSON" });
  return `${NASS_API_URL}?${params.toString()}`;
}

/** "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE" -> "usda_farm_cash_rent_cropland_non_irrigated". */
export function cashRentSeries(shortDesc: string): string | null {
  const m = shortDesc.toUpperCase().match(/^RENT,\s*CASH,\s*(.+?)\s+-\s+EXPENSE,\s*MEASURED IN \$ \/ ACRE$/);
  return m ? `usda_farm_cash_rent_${slug(m[1])}` : null;
}

export interface NassParse extends AreaFetch {
  info: { series: string[]; other_short_desc: string[] };
}

export function parseNassCashRents(body: unknown, year: number, url: string | null): NassParse {
  const data = (body as { data?: unknown })?.data;
  const info: NassParse["info"] = { series: [], other_short_desc: [] };
  if (!Array.isArray(data)) return { url, rows: [], missingFields: ["nass:data array"], skipped: {}, emptyReason: "Quick Stats answer had no data array", info };
  const first = (data[0] ?? {}) as Record<string, unknown>;
  const missingFields = data.length > 0 ? NASS_FIELDS.filter((f) => !(f in first)).map((f) => `nass:${f}`) : [];
  const skipped: Record<string, number> = {};
  const other = new Set<string>();
  const rows: AreaStat[] = [];
  for (const rec of data as Array<Record<string, unknown>>) {
    const shortDesc = String(rec.short_desc ?? "");
    const series = cashRentSeries(shortDesc);
    if (!series) {
      if (other.size < 10) other.add(shortDesc.slice(0, 100));
      continue;
    }
    if (rec.reference_period_desc !== undefined && String(rec.reference_period_desc).toUpperCase() !== "YEAR") {
      bump(skipped, "not_annual");
      continue;
    }
    if (Number(rec.year) !== year) {
      bump(skipped, "other_year");
      continue;
    }
    const level = String(rec.agg_level_desc ?? "").toUpperCase();
    const stateAlpha = String(rec.state_alpha ?? "").toUpperCase();
    const stateFips = String(rec.state_fips_code ?? "").padStart(2, "0");
    const stateCode = STATE_NAMES[stateAlpha] ? stateAlpha : STATE_FROM_FIPS[stateFips] ?? null;
    let geo: Pick<AreaStat, "geo_type" | "geo_code" | "geo_name" | "state_code"> | null = null;
    if (level === "NATIONAL") geo = { geo_type: "nation", geo_code: "US", geo_name: "United States", state_code: null };
    else if (level === "STATE" && stateCode) geo = { geo_type: "state", geo_code: stateCode, geo_name: STATE_NAMES[stateCode] ?? null, state_code: stateCode };
    else if (level === "COUNTY") {
      const county = String(rec.county_code ?? "").padStart(3, "0");
      if (county === "998" || county === "999" || !/^\d{3}$/.test(county)) {
        bump(skipped, "combined_or_unknown_county");
        continue;
      }
      if (stateCode && /^\d{2}$/.test(stateFips)) geo = { geo_type: "county", geo_code: `${stateFips}${county}`, geo_name: rec.county_name ? String(rec.county_name) : null, state_code: stateCode };
    }
    if (!geo) {
      bump(skipped, "area_not_placed");
      continue;
    }
    const { value, flag } = valueWithFlag(rec.Value);
    if (!info.series.includes(series)) info.series.push(series);
    rows.push({
      ...geo,
      period: String(year),
      series_key: series,
      value,
      unit: "dollars_per_acre",
      note: flag,
      raw: { short_desc: shortDesc, unit_desc: rec.unit_desc ?? null, cv_pct: rec["CV (%)"] ?? null, asd_desc: rec.asd_desc ?? null, load_time: rec.load_time ?? null },
    });
  }
  info.other_short_desc = [...other];
  return { url, rows, missingFields, skipped, emptyReason: rows.length === 0 ? `No NASS cash rent values for ${year}` : null, info };
}

/** Removes the key from a Quick Stats URL before it is stored. */
export function redactKey(url: string): string {
  return url.replace(/([?&]key=)[^&]*/i, "$1REDACTED");
}

export async function fetchNassCashRents(year: number, key: string | undefined, options: RegistryFetchOptions = {}): Promise<NassParse & { skippedNoKey: boolean }> {
  const info: NassParse["info"] = { series: [], other_short_desc: [] };
  if (!key?.trim()) return { url: null, rows: [], missingFields: [], skipped: {}, emptyReason: `no ${NASS_KEY_ENV} set`, info, skippedNoKey: true };
  const parts: NassParse[] = [];
  for (const level of NASS_LEVELS) {
    const url = nassUrl(key.trim(), year, level);
    try {
      const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
      parts.push(parseNassCashRents(await response.json(), year, redactKey(url)));
    } catch (error) {
      // Quick Stats answers a query with no matching records with HTTP 400 ("bad request - invalid query").
      if (error instanceof RegistryHttpError && (error.status === 400 || error.status === 404)) {
        parts.push({ url: redactKey(url), rows: [], missingFields: [], skipped: {}, emptyReason: `Quick Stats has no ${level.toLowerCase()} cash rents for ${year}`, info: { series: [], other_short_desc: [] } });
        continue;
      }
      throw error;
    }
  }
  const rows = parts.flatMap((p) => p.rows);
  return {
    url: parts[0]?.url ?? null,
    rows,
    missingFields: [...new Set(parts.flatMap((p) => p.missingFields))],
    skipped: parts.reduce<Record<string, number>>((acc, p) => {
      for (const [k, v] of Object.entries(p.skipped)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
    emptyReason: rows.length === 0 ? `No NASS cash rent values for ${year}` : null,
    info: { series: [...new Set(parts.flatMap((p) => p.info.series))], other_short_desc: [...new Set(parts.flatMap((p) => p.info.other_short_desc))].slice(0, 10) },
    skippedNoKey: false,
  };
}
