import { amountsIn } from "@/lib/agents/knox/rules";

/**
 * A checking account's lineup facts, read with its monthly maintenance fee: the product's
 * name, the balance that avoids the fee, the deposit needed to open it, and the waiver
 * wording. Pure.
 *
 * Every value is grounded in the source text the way amounts are: a dollar figure must
 * appear in the text, and the product name and waiver text must be found in the text once
 * case and whitespace are normalized. A value that is not there is stored as null, never
 * guessed.
 */
export interface AccountLineup {
  productName: string | null;
  minBalanceToAvoid: number | null;
  minOpeningDeposit: number | null;
  waiverText: string | null;
}

/** The only category that carries lineup fields. */
export const LINEUP_CATEGORY = "monthly_maintenance";
const MAX_PRODUCT_NAME_CHARS = 80;
const MAX_WAIVER_CHARS = 240;
const MAX_THRESHOLD = 10_000_000;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comparable(value: string): string {
  return squash(value.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"'));
}

function groundedPhrase(value: unknown, haystack: string, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const phrase = squash(value);
  if (phrase.length < 3 || phrase.length > maxChars) return null;
  return haystack.includes(comparable(phrase)) ? phrase : null;
}

function figureText(value: number): string[] {
  const fixed = value.toFixed(2);
  const whole = Number.isInteger(value) ? String(value) : fixed;
  const comma = (text: string) => text.replace(/\B(?=(\d{3})+(?!\d))/, ",");
  return Array.from(new Set([fixed, whole, comma(fixed), comma(whole)]));
}

function groundedFigure(value: unknown, text: string): number | null {
  if (value == null || value === "") return null;
  const figure = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(figure) || figure < 0 || figure > MAX_THRESHOLD) return null;
  const rounded = Math.round(figure * 100) / 100;
  if (amountsIn(text).some((found) => found.value === rounded)) return rounded;
  // "a minimum daily balance of 1,500": the figure without its dollar sign.
  const bare = figureText(rounded).some((form) => new RegExp(`(^|[^\\d.,])${form.replace(".", "\\.")}(?![\\d]|[.,]\\d)`).test(text));
  return bare ? rounded : null;
}

/** Lineup values checked against the text; null when none of them is stated there. */
export function groundLineup(
  values: { productName?: unknown; minBalanceToAvoid?: unknown; minOpeningDeposit?: unknown; waiverText?: unknown },
  text: string,
): AccountLineup | null {
  const haystack = comparable(text);
  const lineup: AccountLineup = {
    productName: groundedPhrase(values.productName, haystack, MAX_PRODUCT_NAME_CHARS),
    minBalanceToAvoid: groundedFigure(values.minBalanceToAvoid, text),
    minOpeningDeposit: groundedFigure(values.minOpeningDeposit, text),
    waiverText: groundedPhrase(values.waiverText, haystack, MAX_WAIVER_CHARS),
  };
  return Object.values(lineup).some((value) => value !== null) ? lineup : null;
}

/**
 * v49: the account a monthly fee belongs to, when the read did not name one. Most schedules
 * name the account in the fee's own words ("No Boundaries Checking Account Monthly
 * Maintenance Fee", "Service charge fee (Checking + Interest Account)") or in a short
 * heading a few lines above the fee ("Exchange Advantage Checking"). Only 906 of 11,870
 * monthly fee rows had a product name on 2026-10-09; the rest were read from rows like these.
 */
const ACCOUNT_WORD = /\b(?:checking|savings|money market|share draft|share|club|account|statement savings)\b/i;
/** Words that say what kind of account it is, not which one. */
const GENERIC_ACCOUNT_WORDS = new Set([
  "monthly", "maintenance", "service", "services", "account", "accounts", "fee", "fees", "charge", "charges", "low",
  "balance", "minimum", "min", "min.", "the", "a", "an", "for", "per", "month", "all", "each", "if", "of", "and", "or",
  "checking", "savings", "share", "shares", "draft", "drafts", "money", "market", "club", "personal", "business",
  "consumer", "our", "your", "compare", "open", "banking", "deposit", "deposits", "products", "product", "other",
  "features", "feature", "benefits", "details", "schedule", "rates", "rate", "information", "options", "types",
  "commercial", "individual", "joint", "with", "to", "&", "+", "-", "–",
]);
const FEE_NAME_TAIL =
  /\s*[-–:]?\s*(?:low balance\s+)?(?:monthly\s+)?(?:maintenance\s+|service\s+|account\s+)*(?:fee|charge|service charge|maintenance)s?(?:\s+of)?\s*$/i;
const HEADING_TAIL = /\s+(?:features|benefits|details|account details|overview|highlights)\s*$/i;
const SENTENCE_WORDS = /\b(?:is|are|you|your|we|our|will|may|must|when|if|per|this|that)\b/i;
const HEADING_LOOKBACK_LINES = 12;

/** A name that says which account: an account word plus a word of its own, 2 to 6 words. */
function distinctAccountName(value: string): string | null {
  const name = squash(value).replace(/[\s\-–:|,.]+$/, "");
  if (name.length < 4 || name.length > MAX_PRODUCT_NAME_CHARS) return null;
  if (!/^[A-Z0-9]/.test(name) || /\$|\d{2,}|[;.!?]/.test(name) || SENTENCE_WORDS.test(name)) return null;
  const words = name.split(" ");
  if (words.length < 2 || words.length > 6 || !ACCOUNT_WORD.test(name)) return null;
  return words.some((word) => !GENERIC_ACCOUNT_WORDS.has(word.toLowerCase())) ? name : null;
}

/** "Freedom Checking Monthly Fee" -> "Freedom Checking"; "Service charge (Checking + Interest Account)" -> the parenthetical. */
export function productNameFromFeeName(feeName: string): string | null {
  const parenthetical = feeName.match(/\(([^()]{4,80})\)/)?.[1];
  if (parenthetical) {
    const named = distinctAccountName(parenthetical);
    if (named) return named;
  }
  const prefix = feeName.replace(/\([^()]*\)/g, " ").replace(FEE_NAME_TAIL, "");
  return squash(prefix) === squash(feeName) ? null : distinctAccountName(prefix);
}

/** The nearest short account heading in the lines just above the fee's own line. */
export function accountHeadingAbove(text: string, excerpt: string): string | null {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const probe = squash(excerpt).slice(0, 30);
  if (probe.length < 8) return null;
  const at = lines.findIndex((line) => line.includes(probe));
  if (at < 0) return null;
  for (let index = at - 1; index >= Math.max(0, at - HEADING_LOOKBACK_LINES); index -= 1) {
    const line = lines[index];
    if (line.includes("$") || line.includes("|")) continue;
    const named = distinctAccountName(line.replace(HEADING_TAIL, ""));
    if (named) return named;
  }
  return null;
}

/** A monthly fee with no account name gets one from its own name or the heading above it. */
export function withAccountName<T extends { canonicalHint: string; feeName: string; excerpt: string; lineup?: AccountLineup | null }>(
  candidate: T,
  text: string,
): T {
  if (candidate.canonicalHint !== LINEUP_CATEGORY || candidate.lineup?.productName) return candidate;
  const productName = productNameFromFeeName(candidate.feeName) ?? accountHeadingAbove(text, candidate.excerpt);
  if (!productName) return candidate;
  const lineup: AccountLineup = candidate.lineup ?? { productName: null, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null };
  return { ...candidate, lineup: { ...lineup, productName } };
}
