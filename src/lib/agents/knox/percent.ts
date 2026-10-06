import { checkRateAgainstSource } from "@/lib/custom-report/source-check";
import { PERCENT_FEE_RANGES, percentFeeAllowed, type RateBasis } from "@/lib/percent-fees";
import { cleanFeeName, tidyFeeName } from "@/lib/agents/knox/layout";
import type { HeldFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * Knox's percentage fees: a held "1% of the transaction" line becomes a rate fee Darwin can
 * verify, when its category publishes rates (`percentFeeAllowed`, the list Darwin applies)
 * and the rate traces to the document's text with the shared rate check
 * (`checkRateAgainstSource`). Everything else stays held as `knox_review:percentage`:
 * interest and dividend rates, "up to" rates, lines with two different rates, and rates
 * the check cannot find under the fee's name.
 */

export interface RateFeeCandidate {
  feeName: string;
  canonicalHint: string;
  ratePercent: number;
  rateMinAmount: number | null;
  rateMaxAmount: number | null;
  rateBasis: RateBasis | null;
  frequency: string | null;
  excerpt: string;
}

/** Why a held rate stays held (counted in dry runs). */
export type RateHoldReason =
  | "category_not_published"
  | "no_rate"
  | "interest_rate"
  | "up_to_rate"
  | "several_rates"
  | "outside_range"
  | "no_clean_name"
  | "untraced";

// The shared check's rate token: "1.1%", "3 percent", never the end of a range ("2.5-3.5%").
const RATE = /(?<![\d.]|\d\s?[-–]\s?)(\d{1,3}(?:\.\d{1,4})?)\s*(?:%|percent\b)/gi;
const INTEREST = /\b(apy|apr|annual percentage|interest|dividend|rate earned|yield|variable)\b/i;
const UP_TO_BEFORE = /\b(?:up to|maximum of|max(?:imum)?\.?|not to exceed|as much as|no more than)\s*$/i;
const MIN_AMOUNT = /\$\s?(\d{1,4}(?:\.\d{2})?)\s*(?:min(?:imum)?\b|minimum)|\bmin(?:imum)?\.?\s*(?:of\s*|fee\s*(?:of\s*)?)?\$\s?(\d{1,4}(?:\.\d{2})?)/i;
const MAX_AMOUNT = /\$\s?(\d{1,4}(?:\.\d{2})?)\s*(?:max(?:imum)?\b)|\b(?:max(?:imum)?\.?|not to exceed|cap(?:ped)? at)\s*(?:of\s*)?\$\s?(\d{1,4}(?:\.\d{2})?)/i;
/** A safe deposit box's late charge is a percent of its rent, not a late payment fee. */
const NOT_LATE_PAYMENT = /\b(box|rental|rent)\b/i;
const BALANCE_TRANSFER = /\bbalance transfers?\b/i;
const CASH_ADVANCE = /\bcash advances?\b/i;

/** The category's own words, the core of a name built from the line. */
const CATEGORY_CORE: Record<string, RegExp> = {
  card_foreign_txn: /\b(?:foreign (?:transaction|currency(?: conversion)?)|international (?:transaction|service)|currency conversion|cross[- ]border)\b/i,
  cash_advance: /\b(?:cash advance|balance transfer)(?:\s*(?:and|&|or|\/)\s*(?:cash advance|balance transfer))?\b/i,
  coin_counting: /\bcoin (?:counting|processing)\b/i,
  late_payment: /\blate (?:payment|charge|fee)\b/i,
};
/** Capitalized words that open a sentence or label a column, never part of a fee's name. */
const NOT_A_NAME_WORD = /^(?:A|An|The|All|There|This|That|These|If|When|Type|Rate|Fee|Fees|Our|Your|We|You|It|Each|Any|In|For|On|Of|Possible|Further|Therefore)$/;
const NAME_CONNECTORS = new Set(["of", "and", "or", "for", "on", "to", "the", "a", "an", "in", "&", "-", "–", "/", "with", "per"]);

/** A tidied name that reads as a fee's name: no clause, no open parenthesis, no column label. */
function readsAsName(name: string): boolean {
  if (/[:;]/.test(name) || (name.match(/\(/g) ?? []).length !== (name.match(/\)/g) ?? []).length) return false;
  const outside = name.replace(/\([^()]*\)/g, " ").split(/\s+/).filter(Boolean);
  const inside = [...name.matchAll(/\(([^()]*)\)/g)].map((match) => match[1].split(/\s+/).length);
  if (outside.length < 2 || outside.length > 9 || inside.some((count) => count > 5)) return false;
  if (NOT_A_NAME_WORD.test(outside[0])) return false;
  if (NAME_CONNECTORS.has(outside.at(-1)!.toLowerCase())) return false;
  return outside.every((word) => /^[A-Z0-9(\/&\-–]/.test(word) || NAME_CONNECTORS.has(word.toLowerCase()) || /^(?:fee|charge|assessment)s?$/i.test(word));
}

/** The category's words in the line with the capitalized words just before them and a fee word after. */
function nameFromLine(text: string, key: string): string | null {
  const core = CATEGORY_CORE[key]?.exec(text);
  if (!core) return null;
  const before = text.slice(0, core.index).split(/\s+/).filter(Boolean);
  const lead: string[] = [];
  for (let k = before.length - 1; k >= 0 && lead.length < 3; k -= 1) {
    const word = before[k].replace(/[|:,.;]+$/, "");
    if (!word || word !== before[k] && lead.length === 0 && /[|:,.;]$/.test(before[k])) break;
    if (!/^[A-Z][\w®&'/-]*$/.test(word) || NOT_A_NAME_WORD.test(word)) break;
    lead.unshift(word);
  }
  const tail = /^\s+(fees?|charges?|assessments?)\b/i.exec(text.slice(core.index + core[0].length))?.[1] ?? "";
  const name = [...lead, core[0], tail].filter(Boolean).join(" ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function basisFor(key: string, text: string): RateBasis | null {
  if (key === "cash_advance") {
    const advance = CASH_ADVANCE.test(text);
    const transfer = BALANCE_TRANSFER.test(text);
    if (advance && transfer) return null;
    if (transfer) return "balance_transferred";
    if (advance || /\bof (?:the|each) advance\b/i.test(text)) return "advance";
    return null;
  }
  if (key === "card_foreign_txn") {
    return /\b(?:transactions?|purchases?|amount swiped|transaction amount)\b/i.test(text) ? "transaction" : null;
  }
  return null;
}

function amountOf(match: RegExpExecArray | null): number | null {
  const value = match ? Number(match[1] ?? match[2]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The fee's name: the tidied name Knox read, when it reads as a name and carries the
 * category's words, else the category's words from the line ("A 1% Currency Conversion
 * Fee will be assessed ..." is the "Currency Conversion Fee"; "you will be charged a
 * foreign transaction fee of 1%" is the "Foreign transaction fee").
 */
export function rateFeeName(feeName: string, excerpt: string, key: string): string | null {
  const tidy = cleanFeeName(tidyFeeName(feeName));
  if (tidy && readsAsName(tidy) && CATEGORY_CORE[key]?.test(tidy)) return tidy;
  return nameFromLine(tidy && CATEGORY_CORE[key]?.test(tidy) ? tidy : excerpt, key) ?? nameFromLine(excerpt, key);
}

export function rateFeeFromHeld(
  held: Pick<HeldFeeCandidate, "shape" | "feeName" | "canonicalHint" | "percent" | "frequency" | "excerpt">,
  text: string | null,
): RateFeeCandidate | RateHoldReason {
  const excerpt = held.excerpt;
  let key = held.canonicalHint;
  // "Balance transfer" has no category of its own; its rate is a cash advance fee's.
  if (!key && BALANCE_TRANSFER.test(`${held.feeName} ${excerpt}`)) key = "cash_advance";
  if (!key || !percentFeeAllowed(key) || (key === "late_payment" && NOT_LATE_PAYMENT.test(`${held.feeName} ${excerpt}`))) {
    return "category_not_published";
  }
  if (INTEREST.test(excerpt)) return "interest_rate";
  const rates = [...excerpt.matchAll(RATE)].map((match) => ({ value: Number(match[1]), start: match.index ?? 0 }));
  const values = [...new Set(rates.map((rate) => rate.value))];
  if (values.length === 0 || values[0] <= 0) return "no_rate";
  if (values.length > 1 || /\bflat fee\b/i.test(excerpt)) return "several_rates";
  if (rates.some((rate) => UP_TO_BEFORE.test(excerpt.slice(Math.max(0, rate.start - 24), rate.start)))) return "up_to_rate";
  const ratePercent = values[0];
  const range = PERCENT_FEE_RANGES[key];
  if (range && (ratePercent < range.min || ratePercent > range.max)) return "outside_range";
  const feeName = rateFeeName(held.feeName, excerpt, key);
  if (!feeName) return "no_clean_name";
  if (!text || !checkRateAgainstSource(text, feeName, ratePercent, ".").ok) return "untraced";
  const after = excerpt.slice(rates[0].start);
  // "Greater of 10% or $29.00", "5% of payment or $30.00, whichever is lower".
  const or = /\bor\s+\$\s?(\d{1,4}(?:\.\d{2})?)/i.exec(after);
  const greater = /\bgreater of\b|whichever is (?:greater|more|higher)/i.test(excerpt);
  const lower = /\blesser of\b|whichever is (?:less|lower|smaller)/i.test(excerpt);
  const rateMinAmount = amountOf(MIN_AMOUNT.exec(after)) ?? (or && greater ? amountOf(or) : null);
  const rateMaxAmount = amountOf(MAX_AMOUNT.exec(after)) ?? (or && lower ? amountOf(or) : null);
  // A cap below the floor is a misread; the tiers' CHECK would reject it too.
  if (rateMinAmount !== null && rateMaxAmount !== null && rateMaxAmount < rateMinAmount) return "several_rates";
  return {
    feeName,
    canonicalHint: key,
    ratePercent,
    rateMinAmount,
    rateMaxAmount,
    rateBasis: basisFor(key, `${feeName} ${excerpt}`),
    frequency: held.frequency,
    excerpt,
  };
}
