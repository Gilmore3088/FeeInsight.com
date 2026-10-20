import type { AreaEconomy, StateLocalEconomy } from "@/lib/data-store/local-economy";

/** What the explorer's "Local economy" block shows for a city. Pure, with no server imports. */

export interface EconomyRow {
  label: string;
  /** The county's figure as printed. */
  value: string;
  /** The state's figure for the same measure, "Florida: $69,303"; null when it is not loaded. */
  compare: string | null;
}

export type CityEconomyView =
  /** The read failed or missed its deadline: say so, show no figure. */
  | { status: "unavailable" }
  /** The city's branch records name no county. */
  | { status: "no_county" }
  /** The county is known but no Census or BLS figure for it is stored. */
  | { status: "not_loaded" }
  | { status: "ok"; county: string; rows: EconomyRow[]; sources: string[] };

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const COUNT = new Intl.NumberFormat("en-US");

export const dollars = (n: number): string => DOLLARS.format(Math.round(n));
export const count = (n: number): string => COUNT.format(Math.round(n));
/** 0.1234 -> "12.3%". */
export const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

/** The ACS 5-year vintage ending in `year`, as Census names it: "2020-2024". */
export const acsPeriod = (year: number): string => `${year - 4}-${year}`;

type Measure = {
  label: string;
  pick: (a: AreaEconomy) => number | null;
  year: (a: AreaEconomy) => string | null;
  format: (n: number) => string;
};

const MEASURES: Measure[] = [
  { label: "Median household income", pick: (a) => a.median_household_income, year: (a) => (a.acs_year ? String(a.acs_year) : null), format: dollars },
  { label: "Average annual pay", pick: (a) => a.avg_annual_pay, year: (a) => a.pay_year, format: dollars },
  { label: "Below the poverty line", pick: (a) => a.poverty_rate, year: (a) => (a.acs_year ? String(a.acs_year) : null), format: percent },
  { label: "Population", pick: (a) => a.population, year: (a) => (a.acs_year ? String(a.acs_year) : null), format: count },
];

/**
 * The selected city's county figures beside the state's. A figure the source left blank is left
 * out, never shown as 0; a state figure from another year than the county's names its year.
 */
export function cityEconomyView(economy: StateLocalEconomy | null, cityKeyValue: string, stateName: string): CityEconomyView {
  if (!economy) return { status: "unavailable" };
  const fips = economy.city_counties[cityKeyValue];
  if (!fips) return { status: "no_county" };
  const county = economy.counties[fips];
  if (!county) return { status: "not_loaded" };

  const rows: EconomyRow[] = [];
  for (const m of MEASURES) {
    const value = m.pick(county);
    if (value == null) continue;
    const stateValue = economy.state ? m.pick(economy.state) : null;
    const stateYear = economy.state ? m.year(economy.state) : null;
    const sameYear = stateYear === m.year(county);
    rows.push({
      label: m.label,
      value: m.format(value),
      compare: stateValue == null ? null : `${stateName}: ${m.format(stateValue)}${sameYear || !stateYear ? "" : ` (${stateYear})`}`,
    });
  }
  if (rows.length === 0) return { status: "not_loaded" };

  const sources: string[] = [];
  if (county.acs_year && (county.median_household_income != null || county.poverty_rate != null || county.population != null)) {
    sources.push(`U.S. Census Bureau, American Community Survey 5-year estimates, ${acsPeriod(county.acs_year)}`);
  }
  if (county.avg_annual_pay != null && county.pay_year) {
    sources.push(`U.S. Bureau of Labor Statistics, Quarterly Census of Employment and Wages, ${county.pay_year}, all covered jobs`);
  }
  return { status: "ok", county: county.name, rows, sources };
}
