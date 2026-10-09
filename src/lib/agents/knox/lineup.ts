import { AMOUNT_PATTERN, amountsIn, BALANCE_BELOW_CLAUSE } from "@/lib/agents/knox/rules";

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

/** The account's lines around the fee: the fee's own line, a few above it up to its heading, two below. */
interface AccountBlock {
  heading: string | null;
  feeLine: string;
  /** Lines of the same account, nearest the fee first, the fee's own line excluded. */
  nearby: string[];
}

const BLOCK_LINES_ABOVE = 4;
const BLOCK_LINES_BELOW = 2;

function accountBlock(text: string, excerpt: string): AccountBlock | null {
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const probe = squash(excerpt).slice(0, 30);
  if (probe.length < 8) return null;
  const at = lines.findIndex((line) => line.includes(probe));
  if (at < 0) return null;
  let heading: string | null = null;
  let headingAt = -1;
  for (let index = at - 1; index >= Math.max(0, at - HEADING_LOOKBACK_LINES); index -= 1) {
    const line = lines[index];
    if (line.includes("$") || line.includes("|")) continue;
    const named = distinctAccountName(line.replace(HEADING_TAIL, ""));
    if (named) {
      heading = named;
      headingAt = index;
      break;
    }
  }
  const nearby: string[] = [];
  // Below the fee: stop at the next account's heading.
  for (let index = at + 1; index <= Math.min(lines.length - 1, at + BLOCK_LINES_BELOW); index += 1) {
    if (!lines[index].includes("$") && distinctAccountName(lines[index].replace(HEADING_TAIL, ""))) break;
    nearby.push(lines[index]);
  }
  // Above the fee: never past its own heading.
  for (let index = at - 1; index >= Math.max(0, at - BLOCK_LINES_ABOVE, headingAt + 1); index -= 1) nearby.push(lines[index]);
  return { heading, feeLine: lines[at], nearby };
}

/** The nearest short account heading in the lines just above the fee's own line. */
export function accountHeadingAbove(text: string, excerpt: string): string | null {
  return accountBlock(text, excerpt)?.heading ?? null;
}

const FIGURE = String.raw`\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)`;
/** "minimum daily balance of $1,500 ... to avoid", "maintain a $500 average balance to avoid". */
const BALANCE_TO_AVOID = [
  new RegExp(String.raw`\b(?:minimum|min\.?|average|daily|monthly|ledger|collected)[^.$|]{0,40}\bbalances?\s+(?:of\s+|is\s+|:\s*|[-–]\s*)?${FIGURE}[^.|]{0,80}\b(?:avoid|waive)`, "i"),
  new RegExp(String.raw`${FIGURE}\s+(?:minimum\s+|average\s+|daily\s+){1,3}balance[^.|]{0,80}\b(?:avoid|waive)`, "i"),
  new RegExp(String.raw`\b(?:avoid|waive)[^.|]{0,80}\b(?:minimum|average|daily)\s+(?:(?:daily|average|monthly|collected|ledger)\s+){0,2}balance\s+(?:of\s+)?${FIGURE}`, "i"),
];
/** "$100 minimum opening deposit", "Minimum deposit to open: $25.00". */
const OPENING_DEPOSIT = [
  new RegExp(String.raw`${FIGURE}\s+(?:minimum\s+)?(?:opening\s+(?:deposit|balance)|to open)`, "i"),
  new RegExp(String.raw`\b(?:minimum\s+)?(?:opening\s+(?:deposit|balance)|(?:deposit|balance)\s+(?:required\s+)?to\s+open(?:\s+(?:this|an|the)\s+account)?)\s*(?:is|of|:|[-–])?\s*(?:you must deposit\s+)?${FIGURE}`, "i"),
];
const WAIVER_START = /\b(?:waived?|avoid(?:ed)?|unless|none with|no (?:monthly )?(?:fee|charge) (?:with|if|when))\b/i;
const FEE_WORD = /\b(?:fee|charge)s?\b/i;

function figureOf(match: RegExpMatchArray | null): number | null {
  const value = match ? Number(match[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The balance that avoids the fee, stated in one line: the fee's own condition or an "avoid" sentence. */
export function minBalanceFromExcerpt(line: string): number | null {
  const clause = line.match(BALANCE_BELOW_CLAUSE)?.[0];
  if (clause) {
    const figure = [...clause.matchAll(AMOUNT_PATTERN)].at(-1)?.[1];
    const value = figure ? Number(figure.replace(/,/g, "")) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  for (const pattern of BALANCE_TO_AVOID) {
    const value = figureOf(line.match(pattern));
    if (value !== null) return value;
  }
  return null;
}

/** The words that say how the fee is waived ("waived if a Direct Deposit ..."), from one line's own cell. */
export function waiverFromExcerpt(line: string): string | null {
  const start = line.search(WAIVER_START);
  if (start < 0) return null;
  const text = line.slice(start).split("|")[0].split(/(?<=[a-z0-9)])\.\s/i)[0].replace(/[\s.;,)]+$/, "").trim();
  return text.length >= 8 ? text.slice(0, MAX_WAIVER_CHARS) : null;
}

function openingDepositIn(line: string): number | null {
  for (const pattern of OPENING_DEPOSIT) {
    const value = figureOf(line.match(pattern));
    if (value !== null) return value;
  }
  return null;
}

/**
 * v49: a monthly fee with no account name takes it from its own name or the heading above it.
 * v51: the balance that avoids the fee, the waiver and the opening deposit are read the same
 * way: the fee's own line first, then the account's lines around it (never past its heading or
 * into the next account's). A balance or waiver read from a nearby line needs the line to talk
 * about the fee ("avoid the monthly fee", "service charge waived"). Every value is grounded
 * against the text before it is written (`groundLineup`).
 */
export function withLineupFromText<T extends { canonicalHint: string; feeName: string; excerpt: string; lineup?: AccountLineup | null }>(
  candidate: T,
  text: string,
): T {
  if (candidate.canonicalHint !== LINEUP_CATEGORY) return candidate;
  const current: AccountLineup = candidate.lineup ?? { productName: null, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null };
  const block = accountBlock(text, candidate.excerpt);
  const own = [candidate.excerpt, ...(block ? [block.feeLine] : [])];
  const aboutTheFee = (block?.nearby ?? []).filter((line) => FEE_WORD.test(line));
  const first = <V>(lines: string[], read: (line: string) => V | null): V | null => {
    for (const line of lines) {
      const value = read(line);
      if (value !== null) return value;
    }
    return null;
  };
  const filled: AccountLineup = {
    productName: current.productName ?? productNameFromFeeName(candidate.feeName) ?? block?.heading ?? null,
    minBalanceToAvoid: current.minBalanceToAvoid ?? first([...own, ...aboutTheFee], minBalanceFromExcerpt),
    minOpeningDeposit: current.minOpeningDeposit ?? first([...own, ...(block?.nearby ?? [])], openingDepositIn),
    waiverText: current.waiverText ?? first([...own, ...aboutTheFee], waiverFromExcerpt),
  };
  const changed = (Object.keys(filled) as (keyof AccountLineup)[]).some((key) => filled[key] !== current[key]);
  return changed ? { ...candidate, lineup: filled } : candidate;
}
