/**
 * Regulatory Wire, stage 3: from a wire item to the fee data. An item's fee-type tag
 * (wire-fee-types, from its headline) maps to fee categories in the taxonomy, and the
 * item's state (or the nation, for a federal item) picks the index those figures come from.
 *
 * Pure: no database, no React. The figures are the index's own entries (IndexEntry from
 * data-store/fee-index: published_fee_catalog dollar fees under the statistics contract);
 * this module only picks and words them. A category with no published fee says so in plain
 * words and never shows a number; a category below the minimum sample shows its count and
 * no median.
 *
 * The links go into existing pages: the state's fee report, each category's page, the Pro
 * institution search filtered to the state, and the price simulator. The simulator link is
 * always labelled a scenario exercise; nothing here suggests what a fee should be.
 */

import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { STATE_NAMES } from "@/lib/us-states";
import { feeTypesOf, type FeeType } from "./wire-fee-types";

/**
 * Fee-type tag → `fee_category` values (the canonical keys in FEE_FAMILIES), most relevant
 * first. "Overdraft & NSF" is the overdraft and NSF categories only: a returned deposited
 * item (`deposited_item_return`, RDI) is a different fee charged to the depositor and is not
 * NSF. "Card & interchange" maps to the consumer card fees the index holds; interchange is
 * a merchant price and has no category. "Other fees" names no category, so it gets no strip.
 */
export const FEE_TYPE_CATEGORIES: Record<FeeType, readonly string[]> = {
  overdraft: ["overdraft", "nsf"],
  atm: ["atm_non_network", "atm_international"],
  maintenance: ["monthly_maintenance"],
  wire: ["wire_domestic_outgoing", "wire_intl_outgoing"],
  card: ["card_foreign_txn", "card_replacement"],
  other: [],
};

/** Most categories one strip lists, so an item tagged with several types stays compact. */
export const MAX_STRIP_CATEGORIES = 4;

/** The categories for an item's tags, in tag order, without repeats, capped. */
export function categoriesForFeeTypes(types: readonly FeeType[], max = MAX_STRIP_CATEGORIES): string[] {
  const out: string[] = [];
  for (const type of types) {
    for (const category of FEE_TYPE_CATEGORIES[type] ?? []) {
      if (!out.includes(category)) out.push(category);
    }
  }
  return out.slice(0, max);
}

/** The fields of an index entry the strip reads (data-store/fee-index IndexEntry). */
export interface StripIndexEntry {
  fee_category: string;
  median_amount: number | null;
  institution_count: number;
  last_updated?: string | null;
}

export type FigureStatus = "median" | "too_few" | "none";

export interface FeeFigure {
  category: string;
  /** Display name with the parenthetical dropped: "Overdraft", "NSF / Returned Item". */
  label: string;
  status: FigureStatus;
  /** Null unless status is "median". */
  median: number | null;
  /** Institutions with a published fee in this category and place (0 when none). */
  institutions: number;
  /** The figure in words, e.g. "$30.00 median · 112 institutions with a published fee". */
  text: string;
  /** The category's page. */
  href: string;
}

export interface StripLink {
  label: string;
  href: string;
}

export interface FeeDataStrip {
  scope: "state" | "national";
  stateCode: string | null;
  /** "California", or "the national index". */
  place: string;
  figures: FeeFigure[];
  links: StripLink[];
  scenario: { label: string; href: string; caption: string };
  /** Newest publish time behind the figures shown (ISO), when the index records one. */
  asOf: string | null;
}

export const SCENARIO_CAPTION = "Scenario exercise — not a compliance recommendation or a forecast.";

export function categoryLabel(category: string): string {
  return getDisplayName(category).replace(/\s*\([^)]*\)/g, "").trim();
}

export function stateReportHref(stateCode: string): string {
  return `/research/state/${stateCode.toUpperCase()}`;
}

export function categoryHref(category: string): string {
  return `/fees/${encodeURIComponent(category)}`;
}

/** The Pro institution search (/pro/data), filtered to the state when there is one. */
export function compareHref(stateCode: string | null): string {
  return stateCode ? `/pro/data?state=${encodeURIComponent(stateCode.toUpperCase())}` : "/pro/data";
}

/** The price simulator (/pro/simulate reads `fee`), opened on the category. */
export function scenarioHref(category: string): string {
  return `/pro/simulate?fee=${encodeURIComponent(category)}`;
}

function institutions(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "institution" : "institutions"}`;
}

/** One category's figure, worded. `entry` is the place's index entry, or undefined if it has none. */
export function figureFor(category: string, entry: StripIndexEntry | undefined, place: string): FeeFigure {
  const label = categoryLabel(category);
  const href = categoryHref(category);
  const count = entry ? Math.max(0, Math.floor(Number(entry.institution_count) || 0)) : 0;
  if (!entry || count === 0) {
    return {
      category, label, href, status: "none", median: null, institutions: 0,
      text: `No published fees for this category in ${place} yet`,
    };
  }
  const median = entry.median_amount === null || entry.median_amount === undefined ? null : Number(entry.median_amount);
  if (median === null || !Number.isFinite(median) || count < MIN_INSTITUTIONS_FOR_MEDIAN) {
    return {
      category, label, href, status: "too_few", median: null, institutions: count,
      text:
        count < MIN_INSTITUTIONS_FOR_MEDIAN
          ? `${institutions(count)} with a published fee: too few for a median (${MIN_INSTITUTIONS_FOR_MEDIAN} needed)`
          : `${institutions(count)} with a published fee: too few state a dollar amount for a median`,
    };
  }
  return {
    category, label, href, status: "median", median, institutions: count,
    text: `${formatAmount(median)} median · ${institutions(count)} with a published fee`,
  };
}

/**
 * The strip for one wire item. `entries` is the place's index (a state's `all` index for a
 * state item, the national index for a federal one). Null when the tags map to no category.
 */
export function buildFeeDataStrip(input: {
  feeTypes: readonly FeeType[];
  stateCode: string | null;
  entries: readonly StripIndexEntry[];
}): FeeDataStrip | null {
  const categories = categoriesForFeeTypes(input.feeTypes);
  if (categories.length === 0) return null;
  const stateCode = input.stateCode ? input.stateCode.toUpperCase() : null;
  const stateName = stateCode ? STATE_NAMES[stateCode] ?? stateCode : null;
  const place = stateName ?? "the national index";
  const byCategory = new Map(input.entries.map((e) => [e.fee_category, e]));
  const figures = categories.map((c) => figureFor(c, byCategory.get(c), place));

  const links: StripLink[] = [];
  if (stateCode && stateName) links.push({ label: `${stateName} fee report`, href: stateReportHref(stateCode) });
  for (const figure of figures) links.push({ label: `${figure.label} across the index`, href: figure.href });
  links.push({
    label: stateName ? `Compare ${stateName} institutions` : "Compare institutions",
    href: compareHref(stateCode),
  });

  const asOf = categories
    .map((c) => byCategory.get(c)?.last_updated ?? null)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? null;

  return {
    scope: stateCode ? "state" : "national",
    stateCode,
    place,
    figures,
    links,
    scenario: { label: "Try a scenario", href: scenarioHref(categories[0]), caption: SCENARIO_CAPTION },
    asOf,
  };
}

/** A wire item as the strip needs it: its key on the page, headline and state (null = federal). */
export interface StripItem {
  key: string;
  title: string;
  stateCode: string | null;
}

/** What to read for a page: the states whose index is needed and whether the national one is. */
export function indexesNeeded(items: readonly StripItem[]): { states: string[]; national: boolean } {
  const states = new Set<string>();
  let national = false;
  for (const item of items) {
    if (categoriesForFeeTypes(feeTypesOf(item.title)).length === 0) continue;
    if (item.stateCode) states.add(item.stateCode.toUpperCase());
    else national = true;
  }
  return { states: [...states].sort(), national };
}

/**
 * Strips for a page of items, keyed by item key. An index that could not be read is absent
 * from `byState` (or `national` is null), and its items get no strip rather than a false
 * "no published fees".
 */
export function buildFeeDataStrips(
  items: readonly StripItem[],
  indexes: { byState: ReadonlyMap<string, readonly StripIndexEntry[]>; national: readonly StripIndexEntry[] | null },
): Map<string, FeeDataStrip> {
  const strips = new Map<string, FeeDataStrip>();
  for (const item of items) {
    const stateCode = item.stateCode ? item.stateCode.toUpperCase() : null;
    const entries = stateCode ? indexes.byState.get(stateCode) : indexes.national;
    if (!entries) continue;
    const strip = buildFeeDataStrip({ feeTypes: feeTypesOf(item.title), stateCode, entries });
    if (strip) strips.set(item.key, strip);
  }
  return strips;
}
