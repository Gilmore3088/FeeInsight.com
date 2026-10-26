/**
 * #2040: a plain sentence saying the bank does not charge a named fee ("We do not charge a returned
 * item/non-sufficient funds (NSF) fee for items returned unpaid.", Wells Fargo doc 33356) states that
 * fee's price: $0. Knox read a "No Fee" table cell as the fee's $0 (`zero`), but dropped the sentence,
 * so the bank's NSF showed "Not published". Shared by Knox's rules (the read, v124) and the shared
 * source check (`checkFeeAgainstSource`, so Knox's self-check and Darwin trace the $0 to the sentence).
 * Pure: no database and no agent imports.
 *
 * Only a whole sentence of one grammar counts, so a waiver, a cap or a band is never read as $0:
 *
 *   <subject> <present negation> <charge verb> [you] [a|an|any] <the fee> [<allowed tail>].
 *
 * - subject: "We", "The bank", "The credit union". A sentence that opens with anything else ("In
 *   that case, we ...", "However, ...", "If this occurs ...", a product name such as "TD Essential
 *   Banking will not charge any overdraft fees") is a consequence of another sentence or one
 *   account's terms, not the bank's price.
 * - negation: "do not", "don't", "does not", "doesn't", "never", optionally "currently". Not "will
 *   not"/"won't": on these pages it states what happens in the scenario just described ("If we
 *   decline the transaction, ... We will not charge you an overdraft fee"). Not "no longer": prod
 *   holds no such unconditional sentence (Oct 26), and the read cannot see whether the copy it reads
 *   is the page's current one or when the change took effect.
 * - the fee is named explicitly, in one of three categories only (below), and the sentence ends
 *   right after it or after a tail that only restates what the fee is ("for items returned unpaid").
 *   Any other words ("if ...", "when ...", "on transactions under $5", "for the first ...", "more
 *   than 3 per day", "for one-time debit card or ATM transactions", "on Assure Checking accounts",
 *   a colon that opens a list of conditions) mean no read. An NSF name must carry an NSF word ("NSF",
 *   "non-sufficient funds", "insufficient funds"): "returned item" or "returned checks" alone is as
 *   often a returned deposited item.
 *
 * And the document must agree (`noChargeStatementsInText`, review of #2710):
 * - the nearest heading above (or a heading-like sentence before it on the line) names the fee's own
 *   topic or is a general fee heading; "Bill Pay Service" or "SafeBalance Banking" over the sentence
 *   makes it that service's or account's terms;
 * - no line of the document names the fee's category with a price above $0, whether or not any reader
 *   reads it ("NSF Fee $35.00", "Paid or returned item (NSF) 35"): a priced line and a "we do not
 *   charge" sentence on one page are two products' terms, never the bank's $0.
 *
 * Categories (`NO_CHARGE_CATEGORIES`): `nsf`, `overdraft` and `od_protection_transfer`. These are the
 * fees banks announce in prose that they have dropped (NSF since 2022, overdraft at a few banks,
 * overdraft protection transfers on overdraft pages), and the three the issue names. Other "we do not
 * charge for ..." sentences are mostly Reg E boilerplate ("we do not charge for electronic fund
 * transfers") whose object is not one fee, so they stay unread. A sentence naming both overdraft and
 * NSF ("overdraft or NSF fees") is not read: one name would file two categories, and prod (Oct 26) has
 * no such sentence without a condition.
 */

export const NO_CHARGE_CATEGORIES = ["nsf", "overdraft", "od_protection_transfer"] as const;
export type NoChargeCategory = (typeof NO_CHARGE_CATEGORIES)[number];

export interface NoChargeStatement {
  canonicalKey: NoChargeCategory;
  /** The fee's name as the sentence prints it ("Returned item/non-sufficient funds (NSF) fee"). */
  feeName: string;
  /** The whole sentence, as printed. */
  sentence: string;
  /** True when the sentence prints the fee's name itself ("a returned item/NSF fee"), not only what it is for. */
  namePrinted: boolean;
}

const SUBJECT = String.raw`(?:we|the\s+bank|the\s+credit\s+union)`;
const NEGATION = String.raw`(?:currently\s+)?(?:do\s+not|don['’]t|does\s+not|doesn['’]t|never)(?:\s+currently)?`;
const VERB = String.raw`(?:charge|assess|impose)`;
const OPENING = String.raw`^${SUBJECT}\s+${NEGATION}\s+${VERB}(?:\s+(?:you|members|customers))?`;
const ARTICLE = String.raw`(?:\s+(?:an?|any))?`;
const FEE_NOUN = String.raw`(?:fees?|charges?)`;
// The sentence must end on its own line: a line that stops mid-sentence ("We do not currently charge a
// Nonsufficient Funds (NSF) Fee" / "for returning an item unpaid.", Monet Bank) may go on to a condition.
const ENDING = String.raw`\s*[.!]$`;

// An NSF word: "returned item", "NSF", "non-sufficient funds", "insufficient funds", each with an
// optional "(NSF)" after it, joined by "/", "or", "and" or a space ("returned item/non-sufficient
// funds (NSF)", "NSF returned item"). The name must carry one of the last three (`NSF_CORE`).
const NSF_WORD = String.raw`(?:returned[\s-]+items?|nsf|non[\s-]?sufficient[\s-]+funds|insufficient[\s-]+funds)(?:\s*\(nsf\))?`;
const NSF_NAME = String.raw`${NSF_WORD}(?:(?:\s*\/\s*|\s+or\s+|\s+and\s+|\s+)${NSF_WORD})*\s+(?:items?\s+)?${FEE_NOUN}`;
const NSF_CORE = /\b(?:nsf|non[\s-]?sufficient|insufficient)\b/i;
// What an NSF fee is charged for, restated: "for items returned unpaid", "for items we return unpaid",
// "for returned items".
const NSF_TAIL = String.raw`(?:\s+(?:for|on)\s+(?:items|checks|payments|transactions)\s+(?:that\s+are\s+returned|we\s+return|returned)(?:\s+unpaid)?|\s+for\s+returned\s+(?:items|checks|payments|transactions))?`;
const OD_NAME = String.raw`(?:overdraft|od)(?:\s+(?:paid\s+)?items?)?\s+${FEE_NOUN}`;
const ODT_NAME = String.raw`overdraft\s+(?:protection\s+)?transfer\s+${FEE_NOUN}`;

interface Shape {
  key: NoChargeCategory;
  pattern: RegExp;
  /** The fee's name when the sentence names only what it is for; null when it prints the fee's name. */
  name: string | null;
}

// A fee + "for" + what it is for ("a fee for an NSF return", "a transfer fee for overdraft protection
// transfers", "for overdraft protection transfers").
const FOR_FEE = String.raw`(?:\s+(?:an?|any)\s+(?:transfer\s+)?(?:fee|charge)|\s+(?:transfer\s+)?(?:fees|charges))?\s+for\s+(?:using\s+)?(?:an?\s+|any\s+|our\s+|the\s+)?`;

const SHAPES: Shape[] = [
  { key: "od_protection_transfer", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${ODT_NAME})${ENDING}`, "i"), name: null },
  { key: "nsf", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${NSF_NAME})${NSF_TAIL}${ENDING}`, "i"), name: null },
  { key: "overdraft", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${OD_NAME})${ENDING}`, "i"), name: null },
  {
    key: "od_protection_transfer",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>overdraft\\s+(?:protection\\s+)?transfers?)(?:\\s+service)?${ENDING}`, "i"),
    name: "Overdraft transfer fee",
  },
  {
    key: "nsf",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>(?:nsf|non[\\s-]?sufficient[\\s-]+funds|insufficient[\\s-]+funds)\\s+(?:returns?|items?|checks?))${ENDING}`, "i"),
    name: "NSF fee",
  },
  {
    key: "overdraft",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>overdrafts|overdraft\\s+(?:items|transactions))${ENDING}`, "i"),
    name: "Overdraft fee",
  },
];

function tidyName(printed: string, key: NoChargeCategory, fixed: string | null): string {
  const words = printed.replace(/\s+/g, " ").trim();
  if (fixed) {
    // "an NSF return" → "NSF return fee"; "NSF items" → "NSF item fee".
    if (key === "nsf") return capitalise(`${words.replace(/\b(return|item|check)s$/i, "$1")} fee`);
    return fixed;
  }
  return capitalise(words.replace(/\b(fee|charge)s$/i, "$1"));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One sentence's statement, or null when the sentence is not exactly one of the shapes. */
export function noChargeStatement(sentence: string): NoChargeStatement | null {
  const text = sentence.replace(/^[\s•·▪◦‣*–—-]+/, "").replace(/\s+/g, " ").trim();
  // A figure anywhere is a band, a cap or a count; never an unconditional $0.
  if (!text || text.length > 200 || /\d|\$/.test(text)) return null;
  for (const shape of SHAPES) {
    const match = shape.pattern.exec(text);
    if (!match) continue;
    const printed = match.groups?.name ?? "";
    if (shape.key === "nsf" && !NSF_CORE.test(printed)) return null;
    return { canonicalKey: shape.key, feeName: tidyName(printed, shape.key, shape.name), sentence: text, namePrinted: shape.name === null };
  }
  return null;
}

const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * Every statement on one line of prose, read by the sentence alone: the line is cut at sentence ends
 * ("." "!" "?" and a space). A colon or a semicolon does not end a sentence, so "We do not charge an
 * overdraft item fee: ..." (a list of conditions follows) is never read. A table row is never read: its
 * label cell says whose terms the sentence states ("BILL PAY SERVICES NSF | We do not charge a fee when
 * we return an item unpaid ...", Fidelity Bank doc 23446, whose account NSF is $35 two rows up).
 * Callers that read a document use `noChargeStatementsInText`, which also reads its headings and prices.
 */
export function noChargeStatementsIn(line: string): NoChargeStatement[] {
  if (line.includes("|") || !/\b(?:do|does|don['’]t|doesn['’]t|never)\b/i.test(line)) return [];
  return line.split(SENTENCE_END).map(noChargeStatement).filter((statement): statement is NoChargeStatement => statement != null);
}

// The words that name each category's own topic, in a heading or on a priced line.
const TOPIC: Record<NoChargeCategory, RegExp> = {
  nsf: /\b(?:nsf|non[\s-]?sufficient|insufficient|returned?|bounced?|overdrafts?|overdrawn|od)\b/i,
  overdraft: /\b(?:overdrafts?|overdrawn|od|o\/d|nsf|non[\s-]?sufficient|insufficient|courtesy\s+pay|bounce)\b/i,
  od_protection_transfer: /\b(?:overdrafts?|overdrawn|od|transfers?)\b/i,
};
// A priced line names the category by these (narrower than a heading's topic: an overdraft price is
// not an NSF price).
const PRICED_TOPIC: Record<NoChargeCategory, RegExp> = {
  nsf: /\b(?:nsf|non[\s-]?sufficient|insufficient\s+funds?|returned[\s-]+(?:items?|checks?)|bounced?\s+checks?)\b/i,
  overdraft: /\b(?:overdrafts?|od|o\/d|courtesy\s+pay|bounce\s+protection|paid\s+items?)\b/i,
  od_protection_transfer: /\b(?:overdraft|od)\s+(?:protection\s+)?transfers?\b|\btransfers?\b[^.$]{0,40}\boverdraft\b|\boverdraft\b[^.$]{0,40}\btransfers?\b/i,
};
// A heading that names no product or service: only these words.
const GENERAL_HEADING_WORDS = new Set([
  "fee", "fees", "charge", "charges", "service", "schedule", "of", "and", "the", "your", "our", "other", "general",
  "additional", "miscellaneous", "account", "accounts", "deposit", "deposits", "checking", "consumer", "personal",
  "important", "information", "disclosure", "disclosures", "terms", "conditions", "policy", "policies", "pricing",
  "common", "frequently", "asked", "questions", "faq", "faqs", "notes", "note", "about", "what", "you", "need", "to",
  "know", "agreement", "rules",
]);
const HEADING_LOOKBACK_LINES = 15;

/** A line (or a sentence) that reads as a heading: short, no sentence end, no price, no table cell. */
function headingLike(text: string): boolean {
  const line = text.replace(/^[#\s•·▪◦‣*–—-]+/, "").replace(/[:\s]+$/, "").trim();
  if (!line || line.length > 60 || line.includes("|") || /[.!?,;]$/.test(line) || /\$|\d/.test(line)) return false;
  const words = line.split(/\s+/);
  return words.length <= 6 && /^[A-Z]/.test(line);
}

/** True when a heading over the sentence keeps it the bank's own statement: the fee's topic, or general. */
function headingAllows(heading: string, key: NoChargeCategory): boolean {
  if (TOPIC[key].test(heading)) return true;
  const words = heading.toLowerCase().replace(/[^a-z&\s-]/g, " ").split(/[\s&-]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => GENERAL_HEADING_WORDS.has(word));
}

/** The nearest heading above sentence `at` of line `index`: an earlier heading-like sentence on the line, else a line above. */
function nearestHeading(lines: readonly string[], index: number, sentences: readonly string[], at: number): string | null {
  for (let k = at - 1; k >= 0; k -= 1) if (headingLike(sentences[k].replace(/[.!?]$/, ""))) return sentences[k].replace(/[.!?]$/, "");
  for (let j = index - 1; j >= Math.max(0, index - HEADING_LOOKBACK_LINES); j -= 1) {
    if (headingLike(lines[j])) return lines[j];
  }
  return null;
}

const DOLLARS = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const DECIMAL_PRICE = /\b(\d{1,3}\.\d{2})\b/g;
const TRAILING_FIGURE = /(?:^|[\s:)])(\d{1,3})\s*$/;

/** True when the line prints a figure above $0 that can be a price ("$35", "35.00", a trailing "35"). */
function printsPrice(line: string): boolean {
  const values = [...line.matchAll(DOLLARS), ...line.matchAll(DECIMAL_PRICE)].map((match) => Number(match[1].replace(/,/g, "")));
  const trailing = TRAILING_FIGURE.exec(line);
  if (trailing) values.push(Number(trailing[1]));
  return values.some((value) => value > 0);
}

/** True when some line of the document names the category with a price above $0, read or not. */
export function documentPricesCategory(lines: readonly string[], key: NoChargeCategory): boolean {
  return lines.some((line) => PRICED_TOPIC[key].test(line) && printsPrice(line));
}

/**
 * Every statement in a document that the document lets stand as the fee's $0: the sentence's own
 * grammar (`noChargeStatementsIn`), a heading above that is the fee's topic or general, and no line
 * that prices the category.
 */
export function noChargeStatementsInText(text: string): NoChargeStatement[] {
  const lines = text.split("\n");
  const statements: NoChargeStatement[] = [];
  const priced = new Map<NoChargeCategory, boolean>();
  lines.forEach((line, index) => {
    if (line.includes("|") || !/\b(?:do|does|don['’]t|doesn['’]t|never)\b/i.test(line)) return;
    const sentences = line.split(SENTENCE_END);
    sentences.forEach((sentence, at) => {
      const statement = noChargeStatement(sentence);
      if (!statement) return;
      const heading = nearestHeading(lines, index, sentences, at);
      if (heading != null && !headingAllows(heading, statement.canonicalKey)) return;
      if (!priced.has(statement.canonicalKey)) priced.set(statement.canonicalKey, documentPricesCategory(lines, statement.canonicalKey));
      if (priced.get(statement.canonicalKey)) return;
      statements.push(statement);
    });
  });
  return statements;
}

/**
 * The statement that makes this exact fee name, in this category, $0 in the document, or null. The
 * shared source check's witness for a $0 with no free word.
 */
export function noChargeWitness(text: string, feeName: string, canonicalFeeKey?: string | null): NoChargeStatement | null {
  const name = comparableName(feeName);
  if (!name) return null;
  return noChargeStatementsInText(text).find((statement) =>
    comparableName(statement.feeName) === name && (canonicalFeeKey == null || canonicalFeeKey === statement.canonicalKey)) ?? null;
}

function comparableName(name: string): string {
  return name.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}
