import type { ExtractedFee } from "@/lib/data-store/types";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { CityFeeKey, CityMarket } from "@/lib/data-store/city-market";
import { HIGHEST_TIER_CATEGORIES } from "@/lib/data-store/fee-stats";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { Guide } from "@/lib/guides/types";
import { productNameFromFeeName } from "@/lib/agents/knox/lineup";
import { accountPricesText, priceRangeText, type AccountPrice } from "@/lib/fee-representative";
import { STATE_NAMES } from "@/lib/us-states";
import { marketEligibilityOf, pickHeadlineValues } from "../institution/[id]/profile-data";
import { countsInMarketComparison } from "@/lib/market-eligibility";

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

/**
 * The rows the medians count for one fee: the shared market-eligibility test pickHeadlineValues
 * uses (sourced, personal, not business-only, not a fee filed under a category it doesn't match).
 */
function personalRows(fees: ExtractedFee[], category: string): ExtractedFee[] {
  return fees.filter((fee) => fee.fee_category === category && countsInMarketComparison(marketEligibilityOf(fee)));
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
/**
 * The comparison price named for what it is, worded as the institution page words it:
 * "Compared at $8.45, the middle of its two prices", or for overdraft "Compared at $35, the
 * highest of its prices". Null when it publishes one distinct price.
 */
export function checkComparedAt(value: number, amounts: number[], highestTier: boolean): string | null {
  const distinct = new Set(amounts).size;
  if (distinct < 2) return null;
  const which = highestTier ? "the highest of its prices" : `the middle of its ${distinct === 2 ? "two " : ""}prices`;
  return `Compared at ${money(value)}, ${which}`;
}

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
        comparedAt: checkComparedAt(value.amount, amounts, HIGHEST_TIER_CATEGORIES.has(value.category)),
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

/** How the compared fees sit against their medians, for the result's one big figure. */
export interface CheckCounts {
  above: number;
  below: number;
  same: number;
  compared: number;
  /** "state" when every compared fee is read against its state median, "us" when every one is national, else "mixed". */
  level: "state" | "us" | "mixed";
}

export function checkCounts(rows: CheckRow[]): CheckCounts | null {
  const counts = { above: 0, below: 0, same: 0, compared: 0 };
  const levels = new Set<"state" | "us">();
  for (const row of rows) {
    const ref = referenceOf(row);
    if (!ref) continue;
    counts[positionOf(row.value, ref.band.median)] += 1;
    counts.compared += 1;
    levels.add(ref.level);
  }
  if (counts.compared === 0) return null;
  return { ...counts, level: levels.size > 1 ? "mixed" : [...levels][0] };
}

/** The lead fee as a chip: its name, and "$3 above the FL median". Null when no fee sits above. */
export function leadChip(rows: CheckRow[], stateCode: string | null): { label: string; gap: string } | null {
  const lead = leadRow(rows);
  const ref = lead ? referenceOf(lead) : null;
  if (!lead || !ref) return null;
  const where = ref.level === "state" && stateCode ? stateCode : "U.S.";
  return { label: lead.label, gap: `${money(Math.round((lead.value - ref.band.median) * 100) / 100)} above the ${where} median` };
}

/**
 * The one finding, prices first: the fee furthest above its median as its range and named
 * account prices, then, as benchmark detail, the value compared and its gap to the median.
 * Without a fee above the median, `price` is null and `benchmark` says how the main fees sit.
 */
export interface CheckFinding {
  /** "Capital City Bank's monthly maintenance fee runs $7.95 to $8.95, depending on account." */
  price: string | null;
  /** "Carefree Checking $7.95 · Everyday Checking $8.95", when the schedule names every price. */
  accounts: string | null;
  benchmark: string;
}

export function checkFinding(rows: CheckRow[], name: string, stateName: string | null): CheckFinding | null {
  const placeOf = (level: "state" | "us") => (level === "state" && stateName ? stateName : "U.S.");
  const lead = leadRow(rows);
  if (lead) {
    const ref = referenceOf(lead)!;
    const diff = lead.value - ref.band.median;
    const gap = `${money(Math.abs(diff))} above the ${money(ref.band.median)} ${placeOf(ref.level)} median (${ref.band.institutions.toLocaleString("en-US")} institutions)`;
    const fee = lowerLabel(lead.label);
    return lead.comparedAt
      ? {
          price: `${name}'s ${fee} fee runs ${rowPriceText(lead)}.`,
          accounts: accountPricesText(lead.prices, lead.amounts),
          benchmark: `${lead.comparedAt}, it sits ${gap}.`,
        }
      : { price: `${name}'s ${fee} fee is ${money(lead.value)}.`, accounts: null, benchmark: `It sits ${gap}.` };
  }
  const pairs = rows.flatMap((row) => {
    const ref = referenceOf(row);
    return ref ? [{ position: positionOf(row.value, ref.band.median), level: ref.level }] : [];
  });
  if (pairs.length === 0) return null;
  const place = placeOf(pairs.some((p) => p.level === "state") ? "state" : "us");
  const same = pairs.filter((p) => p.position === "same").length;
  const of = `${pairs.length} compared ${pairs.length === 1 ? "fee" : "fees"}`;
  const below = pairs.length - same;
  const benchmark =
    same === pairs.length
      ? `About the same as the ${place} median on all ${of}.`
      : same > 0
        ? `Below the ${place} median on ${below} of ${of} and about the same on ${same}.`
        : `Below the ${place} median on all ${of}.`;
  return { price: null, accounts: null, benchmark };
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

/** The fees a local comparison covers for this institution, as words: "monthly maintenance or overdraft". */
export function localFeeWords(rows: CheckRow[]): string {
  return rows
    .filter((row) => (ALTERNATIVE_FEES as string[]).includes(row.category))
    .map((row) => lowerLabel(row.label))
    .join(" or ");
}

/** True when another institution in the place publishes a fee the lists compare. */
export function hasLocalComparison(lists: AlternativeList[]): boolean {
  return lists.length > 0 && lists.some((list) => list.publishing > 0);
}

/** Where the visitor's place stands, without the market itself, for the section's one line. */
export type LocalLineStatus =
  | { kind: "none" }
  | { kind: "needs-state"; text: string }
  | { kind: "not-found"; text: string }
  | { kind: "no-fees"; city: string }
  | { kind: "found"; place: string };

/** The local section's one line: a prompt, a problem with the place entered, or the finding. */
export function localOptionsLine(status: LocalLineStatus, lists: AlternativeList[], fees: string, name: string): string {
  switch (status.kind) {
    case "needs-state":
      return /^[\d-]+$/.test(status.text)
        ? "Enter a five-digit ZIP code, or a city and state such as Tampa, FL."
        : `Add the state to \u201c${status.text}\u201d, for example Tampa, FL.`;
    case "not-found":
      return `No bank or credit union branch is on record for \u201c${status.text}\u201d. Try a nearby city or another ZIP code.`;
    case "no-fees":
      return `No published fees for ${status.city} yet.`;
    case "found": {
      if (!hasLocalComparison(lists)) return `No comparison is available for ${status.place} yet.`;
      const lower = new Set(lists.flatMap((l) => l.lower.map((alt) => alt.id))).size;
      const listed = lists.map((l) => lowerLabel(l.label)).join(" or ");
      return lower === 0
        ? `No other bank or credit union with a branch in ${status.place} lists a lower ${listed} fee than ${name}'s lowest price.`
        : `${lower} ${lower === 1 ? "bank or credit union" : "banks and credit unions"} with a branch in ${status.place} ${lower === 1 ? "lists" : "list"} a lower ${listed} fee than ${name}'s lowest price.`;
    }
    default:
      return `Banks and credit unions with a branch in your city that list a lower ${fees} fee than ${name}.`;
  }
}

/**
 * Where the visitor is, from `?near=`: a five-digit ZIP, or a city with its state ("Tallahassee,
 * FL", "Tallahassee FL", "Tallahassee, Florida"). A city without a recognizable state is
 * `needs-state`, so the page asks for one rather than guessing. Null for an empty value.
 */
export type CheckLocation =
  | { kind: "zip"; zip: string }
  | { kind: "city"; city: string; state: string }
  | { kind: "needs-state"; text: string };

const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

function stateCodeOf(text: string): string | null {
  const t = text.trim().replace(/\./g, "");
  if (/^[a-z]{2}$/i.test(t) && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(t.toLowerCase().replace(/\s+/g, " ")) ?? null;
}

export function parseLocation(value: string | undefined): CheckLocation | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return null;
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(text);
  if (zip) return { kind: "zip", zip: zip[1] };
  const comma = text.lastIndexOf(",");
  if (comma > 0) {
    const city = text.slice(0, comma).trim();
    const state = stateCodeOf(text.slice(comma + 1));
    return city && state ? { kind: "city", city, state } : { kind: "needs-state", text };
  }
  // No comma: the state is the last one to three words ("New Mexico", "Washington DC").
  const words = text.split(" ");
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const state = stateCodeOf(words.slice(-n).join(" "));
    if (state) return { kind: "city", city: words.slice(0, -n).join(" "), state };
  }
  return { kind: "needs-state", text };
}

/** The id from `?id=`: a positive integer, or null. */
export function parseCheckId(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}
