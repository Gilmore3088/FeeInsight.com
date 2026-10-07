/**
 * The setting around an institution's fees for an exported answer: its state and Federal
 * Reserve district economy, who holds deposits in its local market, and household income
 * there. Every figure is read from tables the registry steps keep fresh (fed_economic_indicators,
 * fed_beige_book, fed_fomc_minutes, institution_branch_deposits, demographics); nothing is
 * fetched from outside. The builders are pure; each section carries a short commentary in
 * plain sentences built from its own figures, and never recommends a price move.
 */

import { getLocalMarketMembers, type LocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { sql } from "@/lib/data-store/connection";
import { getStateEconomicContext, type IndicatorSeries, type StateEconomicContext } from "@/lib/data-store/economic-context";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { beigeBookExcerpt } from "./workspace/economy";

export interface RatePoint {
  date: string;
  state: number;
  national: number;
}

export interface EconomyTile {
  label: string;
  figure: string;
  comparison: string;
}

export interface BriefEconomy {
  place: string;
  districtName: string | null;
  /** Monthly state and U.S. unemployment rates, oldest first, up to three years. */
  unemployment: RatePoint[];
  tiles: EconomyTile[];
  commentary: string[];
  beigeBook: { releaseDate: string; section: string; quote: string; url: string | null } | null;
  fomc: { meetingDate: string; text: string; url: string } | null;
  sources: string[];
}

export interface MarketShare {
  name: string;
  /** Share of SOD deposits in the market counties, 0 to 100. */
  share: number;
  isSubject: boolean;
}

export interface BriefMarket {
  places: string[];
  sodYear: number;
  institutions: number;
  hhi: number;
  top3Share: number;
  /** The largest holders, the subject added when it reports to the SOD and falls outside them. */
  shares: MarketShare[];
  /** False for institutions outside the FDIC Summary of Deposits (credit unions). */
  subjectInSod: boolean;
  commentary: string[];
}

export interface BriefLocalIncome {
  counties: { name: string; income: number }[];
  state: { name: string; income: number } | null;
  year: number;
  commentary: string[];
}

export interface BriefContext {
  economy: BriefEconomy | null;
  market: BriefMarket | null;
  localIncome: BriefLocalIncome | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UNEMPLOYMENT_MONTHS = 36;
const SHARE_BARS = 8;
/** The 2023 federal merger guidelines call a market above this HHI highly concentrated. */
const HHI_HIGH = 1800;
const HHI_MODERATE = 1000;

function monthLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

function dayLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

function pct1(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
}

function pct2(n: number): string {
  return `${n.toFixed(2)}%`;
}

function change12m(series: IndicatorSeries | null): number | null {
  if (!series?.year_ago || series.year_ago.value === 0) return null;
  return ((series.latest.value - series.year_ago.value) / series.year_ago.value) * 100;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** State and national unemployment by month, matched on date, oldest first. */
export function unemploymentPoints(state: IndicatorSeries | null, national: IndicatorSeries | null): RatePoint[] {
  if (!state || !national) return [];
  const us = new Map(national.history.map((p) => [p.date, p.value]));
  return state.history
    .filter((p) => us.has(p.date))
    .map((p) => ({ date: p.date, state: p.value, national: us.get(p.date)! }))
    .slice(-UNEMPLOYMENT_MONTHS);
}

export function buildEconomy(ctx: StateEconomicContext, place: string, districtName: string | null): BriefEconomy | null {
  const tiles: EconomyTile[] = [];
  const commentary: string[] = [];
  const sources: string[] = [];
  const st = ctx.state_unemployment;
  const us = ctx.national_unemployment;
  if (st) {
    const usSame = us?.history.find((p) => p.date === st.latest.date) ?? null;
    tiles.push({
      label: `${place} unemployment`,
      figure: pct1(st.latest.value),
      comparison: `${monthLabel(st.latest.date)}${usSame ? `; U.S. ${pct1(usSame.value)}` : ""}${st.year_ago ? `; ${pct1(st.year_ago.value)} a year earlier` : ""}`,
    });
    if (usSame) {
      const gap = st.latest.value - usSame.value;
      const relation = Math.abs(gap) < 0.15 ? "level with" : gap < 0 ? "below" : "above";
      const trend = st.year_ago
        ? `${st.latest.value > st.year_ago.value ? "up from" : st.latest.value < st.year_ago.value ? "down from" : "unchanged from"} ${pct1(st.year_ago.value)} a year earlier and `
        : "";
      commentary.push(`${place}'s unemployment rate was ${pct1(st.latest.value)} in ${monthLabel(st.latest.date)}, ${trend}${relation} the U.S. rate of ${pct1(usSame.value)}.`);
      commentary.push(
        relation === "above"
          ? "More people out of work than nationally means more accounts under strain, and overdraft and returned-item fees fall on strained accounts first."
          : "Fewer people out of work than nationally means fewer accounts under strain, which matters most for overdraft and returned-item fees, the charges that fall on strained accounts.",
      );
    }
    sources.push(`BLS unemployment rates via FRED (${st.series_id}${us ? `, ${us.series_id}` : ""})`);
  }
  const jobs = change12m(ctx.state_payrolls);
  if (jobs !== null && ctx.state_payrolls) {
    tiles.push({ label: `${place} payroll jobs`, figure: `${jobs >= 0 ? "+" : ""}${pct1(jobs)}`, comparison: `over 12 months to ${monthLabel(ctx.state_payrolls.latest.date)}` });
    commentary.push(`Payroll jobs in ${place} ${jobs >= 0 ? "grew" : "fell"} ${pct1(Math.abs(jobs))} over the year.`);
    sources.push(`BLS payroll employment via FRED (${ctx.state_payrolls.series_id})`);
  }
  const bank = change12m(ctx.cpi_bank_services);
  const all = change12m(ctx.cpi_all_items);
  if (bank !== null && ctx.cpi_bank_services) {
    tiles.push({
      label: "Bank-service prices, U.S.",
      figure: `${bank >= 0 ? "+" : ""}${pct1(bank)}`,
      comparison: `over 12 months to ${monthLabel(ctx.cpi_bank_services.latest.date)}${all !== null ? `; all prices ${all >= 0 ? "+" : ""}${pct1(all)}` : ""}`,
    });
    if (all !== null) {
      commentary.push(
        `Nationally, prices for checking and other bank services ${bank >= 0 ? "rose" : "fell"} ${pct1(Math.abs(bank))} over the year, ${bank > all ? "faster than" : bank < all ? "slower than" : "in line with"} the ${pct1(all)} for all consumer prices.`,
      );
    }
    sources.push(`BLS Consumer Price Index (${ctx.cpi_bank_services.series_id}${ctx.cpi_all_items ? `, ${ctx.cpi_all_items.series_id}` : ""})`);
  }
  if (ctx.fed_funds) {
    tiles.push({ label: "Federal funds rate", figure: pct2(ctx.fed_funds.latest.value), comparison: `${monthLabel(ctx.fed_funds.latest.date)}${ctx.fed_funds.year_ago ? `; ${pct2(ctx.fed_funds.year_ago.value)} a year earlier` : ""}` });
    sources.push("Federal Reserve via FRED (FEDFUNDS)");
  }
  const book = ctx.beige_book;
  const beigeBook = book
    ? {
        releaseDate: book.release_date,
        section: book.banking?.section_name ?? "Summary of Economic Activity",
        quote: beigeBookExcerpt(book.banking?.text ?? book.summary, 420),
        url: book.source_url,
      }
    : null;
  if (beigeBook) sources.push(`Federal Reserve Beige Book, ${districtName ?? "district"} district, ${beigeBook.releaseDate}`);
  const fomc = ctx.fomc ? { meetingDate: dayLabel(ctx.fomc.meeting_date), text: ctx.fomc.policy_action, url: ctx.fomc.source_url } : null;
  if (fomc) sources.push(`Minutes of the Federal Open Market Committee, ${fomc.meetingDate}`);
  if (tiles.length === 0 && !beigeBook) return null;
  return { place, districtName, unemployment: unemploymentPoints(st, us), tiles, commentary, beigeBook, fomc, sources };
}

function hhiWord(hhi: number): string {
  return hhi > HHI_HIGH ? "highly concentrated" : hhi >= HHI_MODERATE ? "moderately concentrated" : "unconcentrated";
}

export function buildMarket(members: LocalMarketMembers, subjectName: string): BriefMarket | null {
  const inSod = members.members.filter((m) => (m.market_deposits ?? 0) > 0);
  const total = inSod.reduce((sum, m) => sum + (m.market_deposits ?? 0), 0);
  if (inSod.length < 2 || total <= 0) return null;
  const all = inSod
    .map((m) => ({ name: m.institution_name, share: ((m.market_deposits ?? 0) / total) * 100, isSubject: m.is_subject }))
    .sort((a, b) => b.share - a.share);
  const hhi = Math.round(all.reduce((sum, m) => sum + m.share * m.share, 0));
  const top3Share = all.slice(0, 3).reduce((sum, m) => sum + m.share, 0);
  const shares = all.slice(0, SHARE_BARS);
  const subject = all.find((m) => m.isSubject) ?? null;
  if (subject && !shares.includes(subject)) shares.push(subject);
  const rank = subject ? all.indexOf(subject) + 1 : null;
  const where = members.places.join("; ");
  const commentary = [
    `${inSod.length} institutions report branch deposits to the FDIC in the market around ${where}. The three largest hold ${Math.round(top3Share)}% of them.`,
    `The market's HHI is ${hhi.toLocaleString("en-US")}, ${hhiWord(hhi)} by the measure in the 2023 federal merger guidelines.`,
    subject && rank
      ? `${subjectName} holds ${pct1(subject.share)} of local deposits, ${rank === 1 ? "the largest share" : `number ${rank} of ${inSod.length}`}.`
      : `${subjectName} is a credit union, and credit unions do not report branch deposits to the FDIC, so its own share is not shown.`,
    top3Share >= 50
      ? "When a few large institutions hold most deposits, their prices are the ones customers compare against; the competitor charts below show them."
      : "With deposits spread across many institutions, no single competitor's prices set the reference point; the competitor charts below show the largest.",
  ];
  return { places: members.places, sodYear: members.sod_year, institutions: inSod.length, hhi, top3Share, shares, subjectInSod: Boolean(subject), commentary };
}

export function buildLocalIncome(
  counties: { name: string; income: number; population: number }[],
  state: { name: string; income: number } | null,
  year: number,
): BriefLocalIncome | null {
  if (counties.length === 0) return null;
  const pop = counties.reduce((s, c) => s + c.population, 0);
  const weighted = pop > 0 ? counties.reduce((s, c) => s + c.income * c.population, 0) / pop : counties[0].income;
  const commentary: string[] = [];
  const label = counties.length === 1 ? counties[0].name : `the ${counties.length} market counties`;
  if (state) {
    const gap = (weighted - state.income) / state.income;
    commentary.push(
      `Median household income in ${label} is ${money(weighted)}${counties.length > 1 ? " (weighted by population)" : ""}, ${Math.abs(gap) < 0.03 ? "about the same as" : `${Math.round(Math.abs(gap) * 100)}% ${gap < 0 ? "below" : "above"}`} ${state.name}'s ${money(state.income)}.`,
    );
    commentary.push(
      gap < -0.03
        ? "Lower incomes leave less room in a monthly budget, so account and penalty fees weigh more on customers here than across the state."
        : gap > 0.03
          ? "Higher incomes leave more room in a monthly budget, so customers here are less pressed by account and penalty fees than across the state."
          : "Customers here face about the same household budgets as across the state.",
    );
  } else {
    commentary.push(`Median household income in ${label} is ${money(weighted)}.`);
  }
  return { counties: counties.map(({ name, income }) => ({ name, income })), state, year, commentary };
}

async function loadIncome(countyFips: string[]): Promise<BriefLocalIncome | null> {
  if (countyFips.length === 0) return null;
  const stateFips = countyFips[0].slice(0, 2);
  const ids = [...countyFips.map((f) => `county:${f}`), `state:${stateFips}`];
  const rows = await sql<{ geo_id: string; geo_type: string; geo_name: string; median_household_income: number | null; total_population: number | null; year: number }[]>`
    SELECT DISTINCT ON (geo_id) geo_id, geo_type, geo_name, median_household_income, total_population, year
      FROM demographics
     WHERE geo_id = ANY(${ids}::text[]) AND median_household_income IS NOT NULL
     ORDER BY geo_id, year DESC`;
  const counties = rows
    .filter((r) => r.geo_type === "county")
    .map((r) => ({ name: r.geo_name.replace(/,\s*[^,]+$/, ""), income: Number(r.median_household_income), population: Number(r.total_population ?? 0) }));
  const st = rows.find((r) => r.geo_type === "state");
  const year = Math.max(...rows.map((r) => Number(r.year)));
  return buildLocalIncome(counties, st ? { name: st.geo_name, income: Number(st.median_household_income) } : null, year);
}

export async function loadBriefContext(institutionId: number): Promise<BriefContext> {
  const [institution] = await sql<{ institution_name: string; state_code: string | null; fed_district: number | null }[]>`
    SELECT institution_name, state_code, fed_district FROM institution_sources WHERE id = ${institutionId}`;
  if (!institution) return { economy: null, market: null, localIncome: null };
  const stateCode = institution.state_code;
  const district = institution.fed_district === null ? null : Number(institution.fed_district);
  const place = stateCode ? STATE_NAMES[stateCode] ?? stateCode : null;
  const districtName = district ? DISTRICT_NAMES[district] ?? null : null;
  const [ctx, members] = await Promise.all([
    stateCode ? getStateEconomicContext(stateCode, district).catch(() => null) : Promise.resolve(null),
    getLocalMarketMembers(institutionId).catch(() => null),
  ]);
  const localIncome = members ? await loadIncome(members.county_fips).catch(() => null) : null;
  return {
    economy: ctx && place ? buildEconomy(ctx, place, districtName) : null,
    market: members ? buildMarket(members, institution.institution_name) : null,
    localIncome,
  };
}
