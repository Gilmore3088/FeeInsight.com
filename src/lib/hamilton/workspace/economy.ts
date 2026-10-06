/**
 * The economy behind a fee, shaped for Hamilton's economist role: the state and national
 * unemployment rates, payroll growth, the fed funds rate, consumer and bank-service price
 * inflation, and the district's latest Beige Book. Pure and client-safe; the series come
 * from getStateEconomicContext (fed_economic_indicators, fed_beige_book).
 */

import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";
import type { EconomicBackdrop, EconomicIndicator, EconomicIndicatorKey, SourceRef } from "./types";

const TABLE = "fed_economic_indicators";

function fredUrl(seriesId: string): string {
  return seriesId.startsWith("CUUR")
    ? `https://data.bls.gov/timeseries/${seriesId}`
    : `https://fred.stlouisfed.org/series/${seriesId}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rate(key: EconomicIndicatorKey, label: string, publisher: string, series: IndicatorSeries | null): EconomicIndicator | null {
  if (!series) return null;
  return {
    key,
    label,
    measure: "rate",
    value: round1(series.latest.value),
    yearAgo: series.year_ago ? round1(series.year_ago.value) : null,
    asOf: series.latest.date,
    source: { label: `${publisher} (${series.series_id})`, table: TABLE, url: fredUrl(series.series_id), asOf: series.latest.date },
  };
}

/** Percent change over 12 months; null without the observation a year earlier. */
function change12m(key: EconomicIndicatorKey, label: string, publisher: string, series: IndicatorSeries | null): EconomicIndicator | null {
  if (!series?.year_ago || series.year_ago.value === 0) return null;
  return {
    key,
    label,
    measure: "change_12m",
    value: round1(((series.latest.value - series.year_ago.value) / series.year_ago.value) * 100),
    yearAgo: null,
    asOf: series.latest.date,
    source: { label: `${publisher} (${series.series_id})`, table: TABLE, url: fredUrl(series.series_id), asOf: series.latest.date },
  };
}

/** The first sentence or two of a Beige Book section, at most `maxChars`, cut at a sentence end. */
export function beigeBookExcerpt(text: string, maxChars = 320): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > maxChars) break;
    out += s;
  }
  return (out || sentences[0]).trim();
}

export function economicBackdrop(
  ctx: StateEconomicContext,
  place: string,
  district: number | null,
  districtName: string | null,
): EconomicBackdrop | null {
  const indicators = [
    rate("state_unemployment", `${place} unemployment rate`, "BLS, via FRED", ctx.state_unemployment),
    rate("national_unemployment", "U.S. unemployment rate", "BLS, via FRED", ctx.national_unemployment),
    change12m("state_payrolls", `${place} payroll jobs`, "BLS, via FRED", ctx.state_payrolls),
    rate("fed_funds", "Federal funds rate", "Federal Reserve, via FRED", ctx.fed_funds),
    change12m("cpi_all_items", "All consumer prices", "BLS Consumer Price Index", ctx.cpi_all_items),
    change12m("cpi_bank_services", "Prices for checking and other bank services", "BLS Consumer Price Index", ctx.cpi_bank_services),
  ].filter((i): i is EconomicIndicator => i !== null);

  const book = ctx.beige_book;
  const beigeBook = book
    ? {
        releaseDate: book.release_date,
        text: beigeBookExcerpt(book.banking?.text ?? book.summary),
        source: {
          label: `Federal Reserve Beige Book, ${districtName ?? `district ${district}`} district${book.banking ? `, ${book.banking.section_name}` : ""}`,
          table: "fed_beige_book",
          url: book.source_url ?? undefined,
          asOf: book.release_date,
        } satisfies SourceRef,
      }
    : null;

  if (indicators.length === 0 && !beigeBook) return null;
  return { place, district, districtName, indicators, beigeBook };
}
