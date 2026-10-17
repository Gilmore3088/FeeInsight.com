import type { ExtractedFee } from "@/lib/data-store/types";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { CityFeeKey, CityMarket } from "@/lib/data-store/city-market";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { countsAsPersonal } from "@/lib/fee-audience";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { Guide } from "@/lib/guides/types";
import { productNameFromFeeName } from "@/lib/agents/knox/lineup";
import { isBusinessOnlyLink } from "@/lib/agents/magellan/link-coverage";
import { comparedAtText, priceRangeText, type AccountPrice } from "@/lib/fee-representative";
import { pickHeadlineValues } from "../institution/[id]/profile-data";

/** The first headline rows, in the institution page's order; the full schedule is one click away. */
export const CHECK_ROWS_SHOWN = 5;

/** One market's spread for a fee: the live index entry's min, middle 50%, median and max. */
export interface CheckBand {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  institutions: number;
}

export interface CheckRow {
  category: string;
  label: string;
  /**
   * The one value the index counts for this institution (institutionValue in fee-stats: the
   * middle of its prices, the highest for overdraft). Used for the comparison only; with several
   * prices it is labelled by `comparedAt` and never shown as "its fee".
   */
  value: number;
  low: number;
  high: number;
  /** Named account prices, lowest first, when the schedule names them. */
  prices: AccountPrice[];
  /** Every amount the range is built from, so a partly named list is not shown (accountPricesText). */
  amounts: number[];
  /** "Compared at $8.45, the middle of its prices" (fee-representative); null when it lists one price. */
  comparedAt: string | null;
  sourceUrl: string | null;
  state: CheckBand | null;
  nation: CheckBand | null;
}

export type Position = "below" | "same" | "above";

/** "$35", "$2.50", "$1,250": the profile's and the city page's format. */
export function money(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Within 1% of the median reads as about the same, as on the state, district and profile pages. */
export function positionOf(value: number, median: number): Position {
  if (Math.abs(value - median) <= Math.abs(median) * 0.01) return "same";
  return value > median ? "above" : "below";
}

/** "Overdraft (OD)" reads as "overdraft" inside a sentence; ATM and NSF keep their case. */
export function lowerLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());
}

/** "$7.95 to $8.95, depending on account", or its one price: the shared rule's own words. */
export function rowPriceText(row: Pick<CheckRow, "low" | "high">): string {
  return priceRangeText([row.low, row.high]) ?? money(row.low);
}

/** A market's band for one fee, only where enough institutions publish it for a median. */
export function marketBand(entry: IndexEntry | undefined): CheckBand | null {
  if (
    !entry ||
    entry.maturity_tier === "insufficient" ||
    entry.min_amount == null ||
    entry.p25_amount == null ||
    entry.median_amount == null ||
    entry.p75_amount == null ||
    entry.max_amount == null
  ) {
    return null;
  }
  return {
    min: entry.min_amount,
    p25: entry.p25_amount,
    median: entry.median_amount,
    p75: entry.p75_amount,
    max: entry.max_amount,
    institutions: entry.institution_count,
  };
}

/** The personal rows the statistics count for one fee, filtered as pickHeadlineValues does. */
function personalRows(fees: ExtractedFee[], category: string): ExtractedFee[] {
  return fees.filter(
    (fee) =>
      fee.fee_category === category &&
      fee.amount !== null &&
      fee.amount >= 0 &&
      countsAsPersonal(fee.fee_audience) &&
      !(fee.source_url && isBusinessOnlyLink(fee.source_url)),
  );
}

/** Every named account price, lowest first; accountPricesText groups them by account. */
export function accountPrices(rows: ExtractedFee[]): AccountPrice[] {
  return rows
    .flatMap((fee) => {
      const account = productNameFromFeeName(fee.fee_name);
      return account ? [{ account, amount: fee.amount as number }] : [];
    })
    .sort((a, b) => a.amount - b.amount || a.account.localeCompare(b.account));
}

/**
 * The headline rows: one value per headline fee by the index's own rule (pickHeadlineValues),
 * its range and named prices, and the state and U.S. bands, kept only where a market has a median.
 * The state band is the state page's (every bank and credit union headquartered in the state),
 * the same population the institution profile compares against.
 */
export function buildCheckRows(input: {
  verifiedFees: ExtractedFee[];
  nationalIndex: IndexEntry[];
  stateIndex: IndexEntry[];
  fallbackSourceUrl: string | null;
}): CheckRow[] {
  const nation = new Map(input.nationalIndex.map((entry) => [entry.fee_category, entry]));
  const state = new Map(input.stateIndex.map((entry) => [entry.fee_category, entry]));
  return pickHeadlineValues(input.verifiedFees, HEADLINE_FEE_KEYS)
    .map((value) => {
      const rows = personalRows(input.verifiedFees, value.category);
      const amounts = rows.map((fee) => fee.amount as number);
      return {
        category: value.category,
        label: getDisplayName(value.category),
        value: value.amount,
        low: value.low,
        high: value.high,
        prices: value.low === value.high ? [] : accountPrices(rows),
        amounts,
        comparedAt: comparedAtText({
          value: value.amount,
          amounts,
          highestTier: HIGHEST_TIER_CATEGORIES.has(value.category),
        }),
        sourceUrl: value.sourceUrl ?? input.fallbackSourceUrl,
        state: marketBand(state.get(value.category)),
        nation: marketBand(nation.get(value.category)),
      };
    })
    .filter((row) => row.state !== null || row.nation !== null)
    .slice(0, CHECK_ROWS_SHOWN);
}

/** The band a row is read against: its state's, else the U.S. */
export function referenceOf(row: CheckRow): { band: CheckBand; level: "state" | "us" } | null {
  if (row.state) return { band: row.state, level: "state" };
  if (row.nation) return { band: row.nation, level: "us" };
  return null;
}

/** The row furthest above its median, relative to it; null when none sits above. */
export function leadRow(rows: CheckRow[]): CheckRow | null {
  let best: { row: CheckRow; gap: number } | null = null;
  for (const row of rows) {
    const ref = referenceOf(row);
    if (!ref || ref.band.median <= 0 || positionOf(row.value, ref.band.median) !== "above") continue;
    const gap = (row.value - ref.band.median) / ref.band.median;
    if (!best || gap > best.gap) best = { row, gap };
  }
  return best?.row ?? null;
}

/**
 * The one finding: the fee furthest above its median, in the profile's words; otherwise how the
 * main fees sit against the median.
 */
export function checkFinding(rows: CheckRow[], name: string, stateName: string | null): string | null {
  const placeOf = (level: "state" | "us") => (level === "state" && stateName ? stateName : "U.S.");
  const lead = leadRow(rows);
  if (lead) {
    const ref = referenceOf(lead)!;
    const diff = lead.value - ref.band.median;
    const gap = `${money(Math.abs(diff))} above the ${money(ref.band.median)} ${placeOf(ref.level)} median (${ref.band.institutions.toLocaleString("en-US")} institutions)`;
    return lead.comparedAt
      ? `${name}'s ${lowerLabel(lead.label)} fee runs ${rowPriceText(lead)}. ${lead.comparedAt}, it sits ${gap}.`
      : `${name}'s ${lowerLabel(lead.label)} fee is ${money(lead.value)}, ${gap}.`;
  }
  const pairs = rows.flatMap((row) => {
    const ref = referenceOf(row);
    return ref ? [{ position: positionOf(row.value, ref.band.median), level: ref.level }] : [];
  });
  if (pairs.length === 0) return null;
  const place = placeOf(pairs.some((p) => p.level === "state") ? "state" : "us");
  const same = pairs.filter((p) => p.position === "same").length;
  const of = `${pairs.length} compared ${pairs.length === 1 ? "fee" : "fees"}`;
  if (same === pairs.length) return `About the same as the ${place} median on all ${of}.`;
  const below = pairs.length - same;
  return same > 0
    ? `Below the ${place} median on ${below} of ${of} and about the same on ${same}.`
    : `Below the ${place} median on all ${of}.`;
}

/** "Florida banks and credit unions" when any row has a state band; null means every comparison is national. */
export function stateGroupLabel(rows: CheckRow[], stateName: string | null): string | null {
  if (!stateName || !rows.some((row) => row.state !== null)) return null;
  return `${stateName} banks and credit unions`;
}

/** Guide sections that say how to avoid or reduce a charge, by their ids in the guide catalog. */
const AVOID_SECTION_IDS = ["avoid", "how-to-avoid", "find-cash"];

/** "/guides/atm-fees#find-cash": the guide for a fee, at its section on avoiding it when it has one. */
export function avoidGuideHref(category: string, guides: Guide[]): string | null {
  const guide =
    guides.find((g) => g.primaryCategory === category) ?? guides.find((g) => g.relatedCategories.includes(category));
  if (!guide) return null;
  const section = guide.sections.find((s) => AVOID_SECTION_IDS.includes(s.id));
  return `/guides/${guide.slug}${section ? `#${section.id}` : ""}`;
}

/** The fees the alternatives exhibit names, where a city page has them. */
export const ALTERNATIVE_FEES: CityFeeKey[] = ["monthly_maintenance", "overdraft"];
export const ALTERNATIVES_SHOWN = 5;

export interface Alternative {
  id: number;
  name: string;
  account: string | null;
  amount: number;
}

export interface AlternativeList {
  category: CityFeeKey;
  label: string;
  /** This institution's lowest published price for the fee, of the kind compared: the list holds prices below it. */
  floor: number;
  /** The account that lowest price belongs to, when the schedule names it. */
  floorAccount: string | null;
  /** Other institutions with a branch in the city that publish a price of the kind compared. */
  publishing: number;
  lower: Alternative[];
}

/** A checking account's price: the account or fee line says checking. */
const CHECKING = /\bchecking\b/i;

/**
 * Which published prices are compared with which. A monthly maintenance fee belongs to one
 * account, so only checking accounts are compared with checking accounts; a savings or
 * certificate fee in the same category is a different product. Overdraft is per item and
 * compares as published.
 */
function comparable(category: CityFeeKey, account: string | null, feeName: string): boolean {
  return category !== "monthly_maintenance" || CHECKING.test(`${account ?? ""} ${feeName}`);
}

/**
 * Institutions with a branch in the same city whose published price for the fee is lower than
 * every comparable price this institution lists. Prices and account names are the city page's
 * (getCityMarket), so the two pages agree; the read itself is unchanged.
 */
export function buildAlternatives(
  market: CityMarket | null,
  institutionId: number,
  rows: CheckRow[],
  verifiedFees: ExtractedFee[],
): AlternativeList[] {
  if (!market) return [];
  const lists: AlternativeList[] = [];
  for (const category of ALTERNATIVE_FEES) {
    if (!rows.some((row) => row.category === category)) continue;
    const own = personalRows(verifiedFees, category)
      .map((fee) => ({ amount: fee.amount as number, account: productNameFromFeeName(fee.fee_name), feeName: fee.fee_name }))
      .filter((fee) => comparable(category, fee.account, fee.feeName))
      .sort((a, b) => a.amount - b.amount);
    if (own.length === 0) continue;
    const floor = own[0];
    const others = market.institutions.filter((inst) => {
      const fee = inst.fees[category];
      return inst.id !== institutionId && fee && comparable(category, fee.account, fee.fee_name);
    });
    const lower = others
      .map((inst) => ({ id: inst.id, name: inst.name, account: inst.fees[category]!.account, amount: inst.fees[category]!.amount }))
      .filter((alt) => alt.amount < floor.amount)
      .sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
    lists.push({
      category,
      label: getDisplayName(category),
      floor: floor.amount,
      floorAccount: floor.account,
      publishing: others.length,
      lower,
    });
  }
  return lists;
}

/** Above this many branch cities, the headquarters city does not stand for the institution's market. */
export const MAX_BRANCH_CITIES_FOR_ALTERNATIVES = 50;

/** The id from `?id=`: a positive integer, or null. */
export function parseCheckId(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
