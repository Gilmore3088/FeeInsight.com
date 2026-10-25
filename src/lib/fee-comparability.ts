/**
 * Whether a published fee measures what its category's median measures. A CD early-withdrawal
 * fee or an IRA closing fee filed under a checking-account category (early account closure, say)
 * is a different product's price: it keeps its row on the institution's page but is never placed
 * above, inside or below that category's median. Pure, so client components can use it.
 */

/** Categories whose median is built from CD or IRA fees, where such a fee is the expected product. */
import { specialUnitReason } from "@/lib/fee-unit";

const CD_IRA_CATEGORIES: ReadonlySet<string> = new Set(["ira_termination", "ira_administration"]);

const CD_IRA_TOKEN = /\b(?:CDs?|IRAs?)\b/;
const CD_IRA_WORDS = /certificates? of deposit|share certificates?|individual retirement|retirement account|time deposit/i;

/**
 * Categories that price a deposit account left unused. A card's own inactivity fee (a debit card
 * not swiped for six months, a prepaid or gift card that sits unused) is filed under them too, but
 * it is a card's price, not the account's, so it is never placed against their median.
 */
const ACCOUNT_DORMANCY_CATEGORIES: ReadonlySet<string> = new Set(["dormant_account"]);

const CARD_NAME = /\bcards?\b/i;
/** The schedule line says the charge falls on the card itself: "the card will be charged $5.00". */
const CARD_LINE = /\bthe card (?:will be|is) charged\b|\bcard balance\b/i;

/**
 * Categories that price a safe deposit box's rent. Drilling a box open, replacing a key, a refundable key
 * deposit and paying the rent late are filed under them too, but they are service charges with their
 * own prices ($250 to drill against a $30 to $65 rent), so they are never placed against the rent's
 * median or range. The taxonomy keeps them in the category; only the comparison leaves them out.
 */
/**
 * A safe deposit row whose name says it is a service charge, not the rent. "Lock Box Rental" and
 * "Lock Box Annual Fee" are rents, so "lock" counts only when "box" does not follow it (#1816).
 */
const SAFE_DEPOSIT_SERVICE = /\bdrill|\bkeys?\b|\block(?:s|ed|out)?\b(?!\s*box)|\blate\b|\bpast due\b|\bforced?\b/i;
/**
 * The same rule as a Postgres `~*` pattern, for the statistics row filter (fee-stats.ts
 * statsRowFilter), so every median leaves out the rows the institution page does. Postgres marks
 * word edges with \m and \M (\b is a backspace there). Kept in step by fee-comparability.test.ts.
 */
export const SAFE_DEPOSIT_SERVICE_SQL =
  "\\mdrill|\\mkeys?\\M|\\mlock(s|ed|out)?\\M(?!\\s*box)|\\mlate\\M|\\mpast due\\M|\\mforced?\\M";
export const SAFE_DEPOSIT_CATEGORY = "safe_deposit_box";
const SAFE_DEPOSIT_RENT_CATEGORIES: ReadonlySet<string> = new Set([SAFE_DEPOSIT_CATEGORY]);

/**
 * One charging basis per category (#1901). Every category's median assumes one basis, so a row
 * whose stated frequency says it is charged on another never sits in that median: Navy Federal's
 * $3 a quarter dormant fee is not a monthly price, a $5 a month bill pay subscription is not a
 * per-payment price, and an overdraft transfer stated as $5 a day is not a per-transfer price.
 *
 * Categories priced by a period are listed in CATEGORY_BASIS; every other category, and any new
 * one, is priced per event (per item, per occurrence, per transaction, or one time per event).
 * A blank or "other" frequency states no basis and keeps its place everywhere. The rule is one
 * function pair (basisMismatchReason, basisMismatchSql) that the statistics row filter, the
 * institution page and Hamilton's report comparison all read, so the medians and the subject's
 * own value never disagree on what is comparable.
 */
export type ChargingBasis = "monthly" | "annual" | "daily" | "per_event";
export type PeriodBasis = Exclude<ChargingBasis, "per_event">;

export const CATEGORY_BASIS: Readonly<Record<string, PeriodBasis>> = {
  dormant_account: "monthly",
  minimum_balance: "monthly",
  monthly_maintenance: "monthly",
  paper_statement: "monthly",
  returned_mail: "monthly",
  bill_pay: "monthly",
  safe_deposit_box: "annual",
  ira_administration: "annual",
  continuous_od: "daily",
  od_daily_cap: "daily",
};

/** Frequencies that mean one charge per event. */
export const PER_EVENT_FREQUENCIES: readonly string[] = ["per_item", "per_occurrence", "per_transaction", "one_time"];

/**
 * Period categories where a per-item price is a different fee, not a count unit. In most period
 * categories "per item" is Knox's reading of "each" on a periodic price ("$45 ea." for a box's
 * yearly rent, "$5 each" for a monthly paper statement), so it keeps its place. A returned mail
 * fee per returned piece and a bill pay fee per payment are charged per event, unlike these
 * categories' monthly price, so there they leave the median. Read 2026-10-25: returned mail has
 * 507 institutions stating monthly against about 400 per event; bill pay 273 against about 220.
 */
export const PER_EVENT_CONTRADICTS_PERIOD: ReadonlySet<string> = new Set(["returned_mail", "bill_pay"]);

/** Stated frequencies that contradict each basis (a per-event category's list is the periods). */
export const CONTRADICTING_FREQUENCIES: Readonly<Record<ChargingBasis, readonly string[]>> = {
  monthly: ["quarterly", "annual", "daily", "hourly", "one_time"],
  annual: ["monthly", "quarterly", "daily", "hourly", "one_time"],
  daily: ["monthly", "quarterly", "annual", "hourly", "one_time"],
  per_event: ["monthly", "quarterly", "annual", "daily"],
};

/** The basis a category's median assumes. */
export function categoryBasis(category: string): ChargingBasis {
  return CATEGORY_BASIS[category] ?? "per_event";
}

/** The stated frequencies that contradict this category's basis. */
export function contradictingFrequencies(category: string): readonly string[] {
  const list = CONTRADICTING_FREQUENCIES[categoryBasis(category)];
  if (!PER_EVENT_CONTRADICTS_PERIOD.has(category)) return list;
  return [...list, ...PER_EVENT_FREQUENCIES.filter((f) => !list.includes(f))];
}

const FREQUENCY_LABEL: Readonly<Record<string, string>> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  daily: "Daily",
  hourly: "Hourly",
  one_time: "One-time",
  per_item: "Per-item",
  per_occurrence: "Per-occurrence",
  per_transaction: "Per-transaction",
};

const BASIS_LABEL: Readonly<Record<ChargingBasis, string>> = {
  monthly: "monthly",
  annual: "annual",
  daily: "daily",
  per_event: "per item",
};

/** "Quarterly charge, not monthly" when the stated frequency contradicts the category's basis; else null. */
export function basisMismatchReason(category: string | null | undefined, frequency: string | null | undefined): string | null {
  if (!category || !frequency) return null;
  const stated = frequency.trim().toLowerCase();
  return contradictingFrequencies(category).includes(stated)
    ? `${FREQUENCY_LABEL[stated]} charge, not ${BASIS_LABEL[categoryBasis(category)]}`
    : null;
}

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

/**
 * The basis rule as a SQL predicate on a catalog alias, for the statistics row filter (rule 9):
 * the twin of basisMismatchReason, checked category by category in fee-comparability.test.ts.
 * Always true or false, never NULL, so `NOT` keeps rows with a blank frequency or category.
 */
export function basisMismatchSql(alias: string): string {
  const frequency = `lower(btrim(${alias}.frequency, E' \\t\\r\\n'))`;
  // Period categories, grouped by the frequencies that contradict them.
  const groups = new Map<string, string[]>();
  for (const category of Object.keys(CATEGORY_BASIS)) {
    const key = quoted(contradictingFrequencies(category));
    groups.set(key, [...(groups.get(key) ?? []), category]);
  }
  const arms = [...groups].map(
    ([frequencies, categories]) => `(${alias}.fee_category IN (${quoted(categories)}) AND ${frequency} IN (${frequencies}))`,
  );
  arms.push(
    `(${alias}.fee_category NOT IN (${quoted(Object.keys(CATEGORY_BASIS))}) AND ${frequency} IN (${quoted(CONTRADICTING_FREQUENCIES.per_event)}))`,
  );
  // COALESCE: a blank frequency or category is never a mismatch, and NOT NULL would drop the row.
  return `COALESCE(${arms.join(" OR ")}, false)`;
}

export const CD_IRA_REASON = "CD/IRA fee";
export const CARD_INACTIVITY_REASON = "Card inactivity fee";
export const SAFE_DEPOSIT_SERVICE_REASON = "Box drilling or key fee";

/**
 * Words every text rule below needs to see in the fee's name, account or schedule line, case ignored.
 * A fee whose text holds none of them is comparable unless its frequency contradicts its category's basis, so a market read can fetch the text
 * only for rows that match (fee-index.ts getComparableMarketIndex) and still apply this rule to
 * exactly the rows the institution's own side does. Plain alternation, valid in JavaScript and as
 * a Postgres `~*` pattern. Every word a rule tests must appear here as a substring.
 */
export const COMPARABILITY_SCREEN = "cd|ira|certificate|retirement|time deposit|card|drill|key|lock|late|past due|force";
const SCREEN = new RegExp(COMPARABILITY_SCREEN, "i");

/**
 * "CD/IRA fee" when the fee belongs to a CD or IRA and its category does not measure one;
 * "Card inactivity fee" when an account-dormancy row is a card's inactivity charge, by its name or
 * by the schedule line it was read from; "Box drilling or key fee" when a safe deposit row is a
 * service charge rather than the box's rent; "Quarterly charge, not monthly" (and the like) when the
 * stated frequency contradicts the category's charging basis (basisMismatchReason, #1901); else null.
 * The basis rule reads only the frequency, so it runs before the text screen.
 */
export function notComparableReason(
  category: string | null | undefined,
  feeName: string | null | undefined,
  accountProduct: string | null | undefined,
  sourceLine?: string | null,
  frequency?: string | null,
): string | null {
  if (!category) return null;
  const basis = basisMismatchReason(category, frequency);
  if (basis) return basis;
  const unit = specialUnitReason(frequency);
  if (unit) return unit;
  if (!SCREEN.test([feeName ?? "", accountProduct ?? "", sourceLine ?? ""].join(" "))) return null;
  if (SAFE_DEPOSIT_RENT_CATEGORIES.has(category) && SAFE_DEPOSIT_SERVICE.test(feeName ?? "")) {
    return SAFE_DEPOSIT_SERVICE_REASON;
  }
  if (ACCOUNT_DORMANCY_CATEGORIES.has(category)) {
    // The account's product name is left out: a "card" there names the account, not the fee.
    if (CARD_NAME.test(feeName ?? "") || CARD_LINE.test(sourceLine ?? "")) return CARD_INACTIVITY_REASON;
  }
  if (CD_IRA_CATEGORIES.has(category)) return null;
  const text = [feeName ?? "", accountProduct ?? ""].join(" ");
  return CD_IRA_TOKEN.test(text) || CD_IRA_WORDS.test(text) ? CD_IRA_REASON : null;
}
